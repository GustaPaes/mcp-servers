import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discussion-delivery-'));
Object.assign(process.env, { TFS_MCP_LOAD_DOTENV: 'false', TFS_MCP_CONFIG_FILE: path.join(root, 'absent.json'),
  TFS_URL: 'https://tfs.example.com', TFS_COLLECTION: 'ExampleCollection', TFS_PROJECT: 'ExampleProject',
  TFS_PAT: 'synthetic-pat', TFS_DEFAULT_AUTH_ALIAS: '', TFS_MAX_RETRIES: '0',
  TFS_DELIVERY_DISCUSSION_ENABLED: 'true', TFS_DELIVERY_LOCALE: 'pt-BR', TFS_DELIVERY_TIME_ZONE: 'UTC',
  TFS_DELIVERY_ROOTS_JSON: JSON.stringify([root]), TFS_DELIVERY_STATE_DIRECTORY: path.join(root, 'state'), TFS_AUDIT_LOG_PATH: path.join(root, 'audit.log') });
const { toolPreparePRDelivery, toolPublishPRDelivery, deliveryChecklist } = await import('../src/tools/pull-request-delivery.js');
const { evidenceAttachmentName, renderDiscussion } = await import('../src/delivery-presentation.js');
const { DELIVERY_TOOLS } = await import('../src/delivery-contract.js');
const { validateToolArguments } = await import('../src/tool-contract.js');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const originalFetch = global.fetch;
test.after(async () => { global.fetch = originalFetch; await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
let sequence = 0;
async function fixture() {
  const id = ++sequence, sha = 'a'.repeat(40), project = '00000000-0000-4000-8000-000000000003';
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const report = Buffer.from(JSON.stringify({ schemaVersion: 1, total: 2, passed: 2, failed: 0, skipped: 0 }));
  await fs.writeFile(path.join(root, `${id}.png`), png); await fs.writeFile(path.join(root, `${id}.json`), report);
  const provenance = { commit: sha, executor: 'node-test', command: 'node --test', started_at: '2026-01-02T00:00:00Z', finished_at: '2026-01-02T00:01:00Z' };
  const input = { repo: 'example-repo', pull_request_id: id, work_item_id: 301, source_sha: sha, summary: 'Cadastro e retomada validados.',
    reports: [{ path: path.join(root, `${id}.json`), sha256: hash(report), format: 'summary-json', label: 'Unit', provenance }],
    media: [{ path: path.join(root, `${id}.png`), sha256: hash(png), scenario: 'Registration', title: 'Cadastro - Retomada completa', kind: 'image', redacted: true, provenance }],
    test_cases: [{ title: 'Retomar cadastro confirmado', result: 'passed', evidence_scenarios: ['Registration'] }] };
  const pr = { repository: { id: '00000000-0000-4000-8000-000000000001', project: { id: project } }, description: 'Human PR',
    sourceRefName: 'refs/heads/feature/evidence', targetRefName: 'refs/heads/develop' };
  const placement = { 'System.State': 'Development', 'System.AreaPath': 'ExampleProject', 'System.IterationPath': 'ExampleProject/Sprint',
    'System.BoardColumn': 'Development', 'Microsoft.VSTS.Common.StackRank': 42 };
  const wi = { rev: 1, fields: { ...placement, 'System.Description': 'Human description' }, relations: [] };
  const comments = [{ id: 10, version: 1, workItemId: 301, createdBy: { id: 'human' }, text: 'Human comment' }];
  const calls = [], control = {};
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  global.fetch = async (url, request = {}) => {
    const target = new URL(url), method = request.method ?? 'GET', pathname = target.pathname;
    calls.push({ method, pathname, body: request.body, url: String(url) });
    if (pathname.endsWith('/refs')) return json({ value: [{ name: `refs/${target.searchParams.get('filter')}`, objectId: sha }] });
    if (pathname.includes('/pullrequests/')) { if (method === 'PATCH') pr.description = JSON.parse(request.body).description; return json(pr); }
    if (pathname.endsWith('/wit/attachments')) return json({ id: project, url: `https://tfs.example.com/ExampleCollection/ExampleProject/_apis/wit/attachments/${project}` });
    if (pathname.endsWith('/workitems/301')) {
      if (method === 'PATCH') {
        const ops = JSON.parse(request.body); assert.equal(ops[0].value, wi.rev);
        for (const op of ops.slice(1)) {
          if (op.path === '/fields/System.Description') wi.fields['System.Description'] = op.value;
          else if (op.op === 'remove') wi.relations.splice(Number(op.path.split('/').at(-1)), 1);
          else if (op.path === '/relations/-') wi.relations.push(op.value);
          else assert.fail('Must not modify board/state fields');
        }
        wi.rev++;
      }
      return json(wi);
    }
    if (pathname.endsWith('/comments')) {
      if (method === 'GET') {
        if (control.unsupported) return json({}, 404);
        return json({ comments, totalCount: control.truncated ? 101 : comments.length });
      }
      const comment = { id: 20, version: 1, workItemId: 301, createdBy: { id: 'publisher' }, text: JSON.parse(request.body).text };
      comments.push(comment);
      if (control.lostPost) { control.lostPost = false; throw new Error('Synthetic lost POST response'); }
      return json(comment);
    }
    const commentId = Number(/\/comments\/(\d+)$/.exec(pathname)?.[1]);
    if (commentId) {
      const comment = comments.find((item) => item.id === commentId);
      if (!comment) return json({}, 404);
      if (method === 'PATCH') {
        comment.text = JSON.parse(request.body).text; comment.version++;
        if (control.moveBoard) wi.fields['System.BoardColumn'] = 'Review';
        if (control.lostPatch) { control.lostPatch = false; throw new Error('Synthetic lost PATCH response'); }
      }
      return json(comment);
    }
    throw new Error(`Unexpected request ${method} ${pathname}`);
  };
  const prepare = () => toolPreparePRDelivery(input);
  const publish = async (extra = {}) => {
    const prepared = await prepare();
    const result = await toolPublishPRDelivery({ ...input, final: true, evidence_level: prepared.data.evidenceLevel, plan_digest: prepared.data.planDigest, ...extra });
    validateToolArguments(DELIVERY_TOOLS[1].outputSchema, result);
    return result.data;
  };
  return { input, calls, comments, control, placement, wi, prepare, publish };
}

test('one final discussion is created and updated in place with cases, inline proof and dated names', async () => {
  const f = await fixture();
  const first = await f.publish(); assert.equal(first.status, 'published'); assert.equal(first.discussionCommentId, 20);
  const comment = f.comments[1];
  assert(comment.text.includes('Entrega validada')); assert(comment.text.includes('Retomar cadastro confirmado'));
  assert(comment.text.includes('Aprovado')); assert(comment.text.includes('<img ')); assert(comment.text.includes('2026-01-02.png'));
  assert(comment.text.includes('PR 1')); assert(!comment.text.includes(root));
  const upload = f.calls.find((call) => call.method === 'POST' && call.pathname.endsWith('/wit/attachments'));
  assert.equal(new URL(upload.url).searchParams.get('fileName'), 'Cadastro - Retomada completa - 2026-01-02.png');
  const writes = f.calls.filter((call) => call.method !== 'GET').length;
  await f.publish(); assert.equal(f.calls.filter((call) => call.method !== 'GET').length, writes);
  f.input.summary = 'Resultado final atualizado.'; await f.publish();
  assert.equal(f.comments.length, 2); assert.equal(f.comments[0].text, 'Human comment');
  assert.equal(f.calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/comments')).length, 1);
  for (const [key, value] of Object.entries(f.placement)) assert.equal(f.wi.fields[key], value);
});
test('legacy hash-named relations are renamed using existing receipts without uploading again', async () => {
  const f = await fixture(); await f.publish();
  const ledgerNames = (await fs.readdir(path.join(root, 'state'))).filter((name) => name.endsWith('.json'));
  let found;
  for (const name of ledgerNames) {
    const state = JSON.parse(await fs.readFile(path.join(root, 'state', name), 'utf8'));
    if (state.lastManifest?.identity.pullRequestId === f.input.pull_request_id) { found = { name, state }; break; }
  }
  assert(found);
  const name = `evidence-${f.input.media[0].sha256}.png`;
  f.wi.relations[0].attributes.name = name;
  for (const entry of [...found.state.managed, ...found.state.pendingAttachments]) {
    entry.name = name; delete entry.title; delete entry.capturedAt; delete entry.timeZone;
  }
  await fs.writeFile(path.join(root, 'state', found.name), JSON.stringify(found.state));
  const uploads = f.calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/wit/attachments')).length;
  assert.equal((await f.publish()).status, 'published');
  assert.equal(f.calls.filter((call) => call.method === 'POST' && call.pathname.endsWith('/wit/attachments')).length, uploads);
  assert.equal(f.wi.relations.length, 1); assert(f.wi.relations[0].attributes.name.endsWith('2026-01-02.png'));
});
test('discussion dry run, unavailable endpoint and truncated discovery never upload or post', async () => {
  for (const mode of ['dry', 'unsupported', 'truncated']) {
    const f = await fixture(); if (mode !== 'dry') f.control[mode] = true;
    const result = await f.publish(mode === 'dry' ? { dry_run: true } : {});
    assert(mode === 'dry' ? result.dryRun : result.status === 'partial');
    assert(f.calls.every((call) => call.method === 'GET'));
  }
});
test('an unknown discussion POST cannot duplicate a comment; explicit matching recovery reuses it', async () => {
  const f = await fixture(); f.control.lostPost = true;
  assert.equal((await f.publish()).status, 'partial');
  assert.equal((await f.publish()).status, 'partial');
  assert.equal(f.comments.length, 2);
  assert.equal((await f.publish({ recovered_discussion_comment_id: 10 })).status, 'partial');
  assert.equal((await f.publish({ recovered_discussion_comment_id: 20 })).status, 'published');
  assert.equal(f.comments.length, 2);
});
test('lost discussion PATCH is reconciled by readback without rewriting or duplicating', async () => {
  const f = await fixture(); await f.publish(); f.input.summary = 'Novo resultado confirmado.'; f.control.lostPatch = true;
  assert.equal((await f.publish()).status, 'partial');
  const writes = f.calls.filter((call) => call.method !== 'GET').length;
  assert.equal((await f.publish()).status, 'published');
  assert.equal(f.calls.filter((call) => call.method !== 'GET').length, writes);
});
test('human edits, deleted comments and foreign ownership stop publication', async () => {
  for (const mutation of ['text', 'author', 'deleted']) {
    const f = await fixture(); await f.publish();
    if (mutation === 'text') f.comments[1].text += ' Human correction';
    if (mutation === 'author') f.comments[1].createdBy.id = 'another-publisher';
    if (mutation === 'deleted') f.comments[1].isDeleted = true;
    const writes = f.calls.filter((call) => call.method !== 'GET').length;
    assert.equal((await f.publish()).status, 'partial');
    assert.equal(f.calls.filter((call) => call.method !== 'GET').length, writes);
  }
});
test('partial cases remain explicitly partial and unknown media references are rejected', async () => {
  const f = await fixture(); f.input.test_cases[0].result = 'blocked';
  assert.equal((await f.publish()).evidenceLevel, 'partial');
  assert(f.comments[1].text.includes('Entrega parcial')); assert(!f.comments[1].text.includes('Entrega validada'));
  f.input.test_cases[0].evidence_scenarios = ['Missing'];
  await assert.rejects(f.prepare(), /missing evidence/);
});
test('a concurrent board move is preserved and reported partial', async () => {
  const f = await fixture(); await f.publish(); f.input.summary = 'Updated evidence'; f.control.moveBoard = true;
  assert.equal((await f.publish()).status, 'partial'); assert.equal(f.wi.fields['System.BoardColumn'], 'Review');
});
test('readable names are safe, bounded, scenario first, capture date last and timezone aware', () => {
  const entry = { title: '../ Cadastro: conta? nova / teste', scenario: 'Registration', extension: '.mp4', provenance: { finishedAt: '2026-01-02T00:30:00Z' } };
  assert.equal(evidenceAttachmentName(entry, 'UTC'), 'Cadastro conta nova teste - 2026-01-02.mp4');
  assert(evidenceAttachmentName(entry, 'Pacific/Honolulu').endsWith('2026-01-01.mp4'));
  assert(evidenceAttachmentName({ ...entry, title: 'Á'.repeat(160) }).length <= 100);
  assert(deliveryChecklist(301).next.some((line) => line.includes('#301: ')));
});
test('discussion escapes caller content and displays at most three inline images', () => {
  const manifest = { sourceSha: 'a'.repeat(40), summary: '<script>alert(1)</script>', reports: [], pending: [], testCases: [] };
  const attachments = Array.from({ length: 5 }, (_, index) => ({ name: `Evidence ${index}`, scenario: 'Scenario', kind: 'image', url: 'https://tfs.example.com/image' }));
  const html = renderDiscussion(manifest, 'partial', attachments);
  assert(!html.includes('<script>')); assert.equal((html.match(/<img /g) ?? []).length, 3);
});
