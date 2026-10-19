import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';

Object.assign(process.env, { TFS_MCP_LOAD_DOTENV: 'false', TFS_MCP_CONFIG_FILE: path.join(os.tmpdir(), 'absent-delivery-html-config.json'),
  TFS_URL: 'https://tfs.example.com/install', TFS_COLLECTION: 'ExampleCollection', TFS_PROJECT: 'ExampleProject' });
const { replaceManagedSection, normalizeManagedHtml, managedHtmlHash, guardSectionReplay, beginSectionWrite } = await import('../src/evidence-manifest.js');
const { canonicalAttachmentUrl } = await import('../src/tfs-client.js');
const { deliveryAttachmentMatches } = await import('../src/tools/work-item-attachments.js');
const key = 'a'.repeat(64), other = 'b'.repeat(64);
const projectId = '00000000-0000-4000-8000-000000000003';
const attachmentId = '00000000-0000-4000-8000-000000000002';
const context = { workItemId: 301, projectId };
const url = `https://tfs.example.com/install/ExampleCollection/ExampleProject/_apis/wit/attachments/${attachmentId}`;
const body = `<h3>Evidências</h3><p>Commit atual</p><table><tr><th>Testes</th><td>2</td></tr></table><p><a href="${url}">Vídeo</a></p><p>Origem declarada.</p>`;
const padded = (text) => text.replace(/<\/(p|h3|td|th)>/g, ' </$1>');

test('work item anchors preserve heading/footer text and normalize only the owned HTML span', () => {
  const human = '<p>Human text </p><pre><p>Exact spaces  </p></pre>';
  const marked = replaceManagedSection(human, key, body, context);
  assert(!marked.includes('<!--'));
  assert(marked.includes(`/_workitems/edit/301#tfs-mcp-delivery:${key}:begin`));
  const normalized = human + padded(marked.slice(human.length));
  assert.equal(normalizeManagedHtml(normalized, key, context), marked);
  assert.equal(replaceManagedSection(normalized, key, body, context), marked);
  assert.equal(managedHtmlHash(normalized, key, context), managedHtmlHash(marked, key, context));
  assert.equal(managedHtmlHash(marked.replaceAll('/ExampleProject/_workitems/', `/${projectId}/_workitems/`), key, context), managedHtmlHash(marked, key, context));
  assert.notEqual(managedHtmlHash(padded(human) + marked.slice(human.length), key, context), managedHtmlHash(marked, key, context));
});

test('normalization preserves meaningful text, attributes, pre/code and nonbreaking spaces', () => {
  for (const [original, changed] of [
    ['<p>A  B</p>', '<p>A B</p>'],
    ['<pre><p>A </p></pre>', '<pre><p>A</p></pre>'],
    ['<code><p>A </p></code>', '<code><p>A</p></code>'],
    ['<p>A\u00a0</p>', '<p>A</p>'],
    ['<p class="important">A</p>', '<p>A</p>'],
  ]) {
    const before = replaceManagedSection('', key, body.replace('<p>Commit atual</p>', original), context);
    const after = replaceManagedSection('', key, body.replace('<p>Commit atual</p>', changed), context);
    assert.notEqual(managedHtmlHash(before, key, context), managedHtmlHash(after, key, context));
  }
});

test('canonical attachment identity accepts observed project/collection forms but preserves ownership metadata', () => {
  const entry = { url, marker: `tfs-mcp-delivery:${key}:receipt`, name: 'evidence.png' };
  for (const remote of [url + '?fileName=evidence.png', url.replace('/ExampleProject/', `/${projectId}/`), url.replace('/ExampleProject/', '/')]) {
    assert.equal(canonicalAttachmentUrl(remote, context), url);
    assert(deliveryAttachmentMatches({ rel: 'AttachedFile', url: remote, attributes: { comment: entry.marker, name: entry.name } }, entry, context));
    const marked = replaceManagedSection('', key, body, context);
    assert.equal(managedHtmlHash(marked.replace(url, remote), key, context), managedHtmlHash(marked, key, context));
  }
  for (const remote of [url.replace('tfs.example.com', 'attacker.example'), url.replace('/ExampleProject/', '/OtherProject/'),
    url.replace('/ExampleProject/', '/00000000-0000-4000-8000-000000000004/'), url.replace('/ExampleCollection/', '/OtherCollection/')]) {
    assert.throws(() => canonicalAttachmentUrl(remote, context));
    assert(!deliveryAttachmentMatches({ rel: 'AttachedFile', url: remote, attributes: { comment: entry.marker, name: entry.name } }, entry, context));
    const marked = replaceManagedSection('', key, body, context);
    assert.notEqual(managedHtmlHash(marked.replace(url, remote), key, context), managedHtmlHash(marked, key, context));
  }
  for (const attributes of [{ comment: 'Human attachment', name: entry.name }, { comment: entry.marker, name: 'Human name' }]) {
    assert(!deliveryAttachmentMatches({ rel: 'AttachedFile', url, attributes }, entry, context));
  }
});

test('partial, duplicate, misplaced and foreign marker targets fail closed', () => {
  const marked = replaceManagedSection('', key, body, context);
  for (const malformed of [marked.replace(`:${key}:end`, `:${other}:end`), marked + marked,
    marked.replace('/_workitems/edit/301#', '/_workitems/edit/302#'), marked.replace('https://tfs.example.com', 'https://attacker.example')]) {
    assert.throws(() => replaceManagedSection(malformed, key, body, context));
  }
  assert(replaceManagedSection('', key, body).includes(`<!-- tfs-mcp-delivery:${key}:begin -->`));
});

test('new normalized writes recover benign HTML formatting; old ambiguous writes require exact repair', async () => {
  const marked = replaceManagedSection('', key, body, context), state = { key };
  const save = async () => {};
  await beginSectionWrite('Human', marked, 'workItem', state, save, context);
  assert.equal(state.sectionWrites.workItem.normalization, 'work-item-html-v1');
  state.sectionWrites.workItem.ambiguous = true;
  await guardSectionReplay(padded(marked), key, 'workItem', state, save, context);
  assert.equal(state.sectionWrites.workItem.ambiguous, false);
  state.sectionWrites.workItem.ambiguous = true;
  await assert.rejects(guardSectionReplay(marked.replace('Commit atual', 'Human edit'), key, 'workItem', state, save, context), /ambiguous/);
  const legacy = replaceManagedSection('', key, body), old = { key };
  await beginSectionWrite('', legacy, 'workItem', old, save);
  old.sectionWrites.workItem.ambiguous = true;
  await assert.rejects(guardSectionReplay(padded(legacy), key, 'workItem', old, save, context), /ambiguous/);
});
