import { tfsGet, tfsJsonPatch, canonicalAttachmentUrl } from "../tfs-client.js";
import { replaceManagedSection, guardSectionReplay, beginSectionWrite, managedHtmlHash } from "../evidence-manifest.js";

export function deliveryAttachmentMatches(relation, entry, context) {
  if (relation.rel !== 'AttachedFile' || relation.attributes?.comment !== entry.marker || relation.attributes?.name !== entry.name) return false;
  try { return canonicalAttachmentUrl(relation.url, context) === canonicalAttachmentUrl(entry.url, context); }
  catch { return false; }
}

export const deliveryAttachmentCount = (relations, entry, context) => relations.filter((relation) => deliveryAttachmentMatches(relation, entry, context)).length;
function sameAttachmentIdentity(relation, entry, context) {
  if (relation.rel !== 'AttachedFile' || relation.attributes?.comment !== entry.marker) return false;
  try { return canonicalAttachmentUrl(relation.url, context) === canonicalAttachmentUrl(entry.url, context); }
  catch { return false; }
}

export async function reconcileDeliveryWorkItem({ id, key, html, attachments, state, save, projectId }) {
  const context = { workItemId: id, projectId };
  for (let attempt = 0; attempt < 3; attempt++) {
    const item = await tfsGet(`/wit/workitems/${id}`, { '$expand': 'relations' });
    if (!Number.isSafeInteger(item.rev)) throw new Error("Work item revision is missing.");
    const before = String(item.fields?.['System.Description'] ?? '');
    await guardSectionReplay(before, key, 'workItem', state, save, context);
    const after = replaceManagedSection(before, key, html, context);
    const descriptionChanged = managedHtmlHash(before, key, context) !== managedHtmlHash(after, key, context);
    const relations = item.relations ?? [];
    if (relations.length > 1000) throw new Error("Work item relations exceed reconciliation limit.");
    if ([...state.managed, ...attachments].some((entry) => relations.filter((relation) => sameAttachmentIdentity(relation, entry, context)).length > 1)) {
      throw new Error('Attachment markers are ambiguous; duplicate owned relations require manual reconciliation.');
    }
    const ops = [{ op: 'test', path: '/rev', value: item.rev }];
    const renamed = new Set();
    if (descriptionChanged) ops.push({ op: 'add', path: '/fields/System.Description', value: after });
    for (let index = relations.length - 1; index >= 0; index--) {
      const relation = relations[index];
      if (state.managed.some((entry) => deliveryAttachmentMatches(relation, entry, context))
        && !attachments.some((entry) => deliveryAttachmentMatches(relation, entry, context))) {
        const replacement = attachments.find((entry) => sameAttachmentIdentity(relation, entry, context));
        if (replacement) {
          ops.push({ op: 'replace', path: `/relations/${index}/attributes/name`, value: replacement.name });
          renamed.add(replacement);
        } else ops.push({ op: 'remove', path: `/relations/${index}` });
      }
    }
    for (const entry of attachments) {
      if (!renamed.has(entry) && !relations.some((relation) => deliveryAttachmentMatches(relation, entry, context))) {
        ops.push({ op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url: entry.url, attributes: { comment: entry.marker, name: entry.name } } });
      }
    }
    // Persist ownership before PATCH so a lost response can be reconciled safely.
    state.managed = [...state.managed, ...attachments].filter((entry, index, all) => all.findIndex((other) => other.url === entry.url && other.marker === entry.marker) === index);
    await save();
    const previousWrite = state.sectionWrites?.workItem;
    if (descriptionChanged) await beginSectionWrite(before, after, 'workItem', state, save, context);
    state.pendingAttachments = attachments;
    await save();
    try {
      if (ops.length > 1) await tfsJsonPatch('PATCH', `/wit/workitems/${id}`, ops);
    } catch (error) {
      if ([409, 412].includes(error.status) && attempt < 2) {
        if (previousWrite) state.sectionWrites.workItem = previousWrite;
        else if (state.sectionWrites) delete state.sectionWrites.workItem;
        await save();
        continue;
      }
      throw new Error("Work item publication incomplete; rerun to reconcile the revision and known attachments.");
    }
    const persisted = await tfsGet(`/wit/workitems/${id}`, { '$expand': 'relations' });
    if (managedHtmlHash(String(persisted.fields?.['System.Description'] ?? ''), key, context) !== managedHtmlHash(after, key, context)
      || attachments.some((entry) => deliveryAttachmentCount(persisted.relations ?? [], entry, context) !== 1)) {
      state.sectionWrites ??= {};
      state.sectionWrites.workItem = { beforeHash: managedHtmlHash(before, key, context), afterHash: managedHtmlHash(after, key, context), normalization: 'work-item-html-v1', ambiguous: true };
      state.ambiguousRelations = attachments.some((entry) => deliveryAttachmentCount(persisted.relations ?? [], entry, context) !== 1);
      await save();
      throw new Error("Work item did not preserve the managed section or attachment markers; manual reconciliation required.");
    }
    state.managed = attachments;
    await save();
    return { revision: persisted.rev, attachments: attachments.length };
  }
}
