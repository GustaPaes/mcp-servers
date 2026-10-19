import { tfsGet, tfsPost, tfsPatch } from '../tfs-client.js';
import { managedHtmlHash, replaceManagedSection, sectionMarker } from '../evidence-manifest.js';

const params = { 'api-version': '7.0-preview.3' };
const endpoint = (id) => `/wit/workitems/${id}/comments`;
function inspect(comment, id, expectedId) {
  if (!Number.isSafeInteger(comment.id) || comment.id < 1 || comment.workItemId !== id || comment.isDeleted
    || (expectedId !== undefined && comment.id !== expectedId)
    || !Number.isSafeInteger(comment.version) || !comment.createdBy?.id || typeof comment.text !== 'string'
    || Buffer.byteLength(comment.text) > 262_144) throw new Error('Discussion receipt is missing or invalid.');
  return comment;
}
export async function preflightDiscussion({ id, key, state, save, projectId, recoveredId }) {
  const context = { workItemId: id, projectId }, record = state.discussion;
  if (record?.stage === 'creating') {
    if (!recoveredId) throw new Error('Discussion outcome unknown; supply recovered_discussion_comment_id after inspecting the provider. Never retry POST blindly.');
    const observed = inspect(await tfsGet(`${endpoint(id)}/${recoveredId}`, params), id, recoveredId);
    if (managedHtmlHash(observed.text, key, context) !== record.afterHash) throw new Error('Recovered discussion does not match the intended evidence.');
    state.discussion = { stage: 'ready', id: observed.id, authorId: observed.createdBy.id, afterHash: record.afterHash };
    await save();
  }
  if (!state.discussion?.id) {
    const page = await tfsGet(endpoint(id), { ...params, '$top': 100, order: 'desc' });
    if (!Array.isArray(page.comments) || page.comments.length > 100 || page.continuationToken || page.totalCount > page.comments.length) throw new Error('Discussion listing is unsupported or exceeds its limit; reconcile older comments manually.');
    if (page.comments.some((comment) => String(comment.text).includes(sectionMarker(key)))) throw new Error('Discussion marker has no local ownership receipt; reconcile before publishing.');
    return;
  }
  const current = inspect(await tfsGet(`${endpoint(id)}/${state.discussion.id}`, params), id, state.discussion.id);
  const currentHash = managedHtmlHash(current.text, key, context);
  if (current.createdBy.id !== state.discussion.authorId || ![state.discussion.beforeHash, state.discussion.afterHash].includes(currentHash)) {
    throw new Error('Discussion changed outside this publisher; preserve the human edit and reconcile.');
  }
  if (currentHash === state.discussion.afterHash && state.discussion.stage !== 'ready') {
    state.discussion.stage = 'ready';
    delete state.discussion.beforeHash;
    await save();
  }
  return current;
}
export async function reconcileDeliveryDiscussion({ id, key, body, state, save, projectId, recoveredId }) {
  const context = { workItemId: id, projectId };
  const text = replaceManagedSection('', key, body, context), afterHash = managedHtmlHash(text, key, context);
  const current = await preflightDiscussion({ id, key, state, save, projectId, recoveredId });
  if (current && managedHtmlHash(current.text, key, context) === afterHash) return { id: current.id, unchanged: true };
  if (!current) {
    state.discussion = { stage: 'creating', afterHash };
    await save();
    const created = inspect(await tfsPost(endpoint(id), { text }, { ...params, format: 'html' }), id);
    state.discussion = { stage: 'writing', id: created.id, authorId: created.createdBy.id, afterHash };
    await save();
  } else {
    // Comments have no provider CAS contract; re-read and preserve detected human edits.
    const latest = inspect(await tfsGet(`${endpoint(id)}/${current.id}`, params), id, current.id);
    if (latest.version !== current.version || latest.text !== current.text || latest.createdBy.id !== current.createdBy.id) throw new Error('Discussion changed before update; reconcile without overwriting.');
    state.discussion = { stage: 'writing', id: current.id, authorId: current.createdBy.id,
      beforeHash: managedHtmlHash(current.text, key, context), afterHash };
    await save();
    await tfsPatch(`${endpoint(id)}/${current.id}`, { text }, params);
  }
  const persisted = inspect(await tfsGet(`${endpoint(id)}/${state.discussion.id}`, params), id, state.discussion.id);
  if (persisted.createdBy.id !== state.discussion.authorId || managedHtmlHash(persisted.text, key, context) !== afterHash) {
    throw new Error('Discussion did not preserve its intended evidence; reconcile before retrying.');
  }
  state.discussion.stage = 'ready';
  delete state.discussion.beforeHash;
  await save();
  return { id: persisted.id, unchanged: false };
}
