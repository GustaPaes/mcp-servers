import { tfsGet, tfsJsonPatch } from "../tfs-client.js";
import { replaceManagedSection, guardSectionReplay, beginSectionWrite } from "../evidence-manifest.js";

export async function reconcileDeliveryWorkItem({ id, key, html, attachments, state, save }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const item = await tfsGet(`/wit/workitems/${id}`, { '$expand': 'relations' });
    if (!Number.isSafeInteger(item.rev)) throw new Error("Work item revision is missing.");
    const before = String(item.fields?.['System.Description'] ?? '');
    await guardSectionReplay(before, key, 'workItem', state, save);
    const after = replaceManagedSection(before, key, html);
    const relations = item.relations ?? [];
    if (relations.length > 1000) throw new Error("Work item relations exceed reconciliation limit.");
    const ops = [{ op: 'test', path: '/rev', value: item.rev }];
    if (before !== after) ops.push({ op: 'add', path: '/fields/System.Description', value: after });
    const desired = new Set(attachments.map((entry) => `${entry.url}|${entry.marker}`));
    const owned = new Set(state.managed.map((entry) => `${entry.url}|${entry.marker}`));
    for (let index = relations.length - 1; index >= 0; index--) {
      const relation = relations[index], identity = `${relation.url}|${relation.attributes?.comment}`;
      if (relation.rel === 'AttachedFile' && owned.has(identity) && !desired.has(identity)) {
        ops.push({ op: 'remove', path: `/relations/${index}` });
      }
    }
    for (const entry of attachments) {
      if (!relations.some((relation) => relation.rel === 'AttachedFile' && relation.url === entry.url && relation.attributes?.comment === entry.marker)) {
        ops.push({ op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url: entry.url, attributes: { comment: entry.marker, name: entry.name } } });
      }
    }
    // Persist ownership before PATCH so a lost response can be reconciled safely.
    state.managed = [...state.managed, ...attachments].filter((entry, index, all) => all.findIndex((other) => other.url === entry.url && other.marker === entry.marker) === index);
    await save();
    const previousWrite = state.sectionWrites?.workItem;
    if (before !== after) await beginSectionWrite(before, after, 'workItem', state, save);
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
    if (persisted.fields?.['System.Description'] !== after
      || attachments.some((entry) => !(persisted.relations ?? []).some((relation) => relation.rel === 'AttachedFile' && relation.url === entry.url && relation.attributes?.comment === entry.marker))) {
      state.sectionWrites ??= {};
      state.sectionWrites.workItem = { ...state.sectionWrites.workItem, ambiguous: true };
      state.ambiguousRelations = attachments.some((entry) => !(persisted.relations ?? []).some((relation) => relation.rel === 'AttachedFile' && relation.url === entry.url && relation.attributes?.comment === entry.marker));
      await save();
      throw new Error("Work item did not preserve the managed section or attachment markers; manual reconciliation required.");
    }
    state.managed = attachments;
    await save();
    return { revision: persisted.rev, attachments: attachments.length };
  }
}
