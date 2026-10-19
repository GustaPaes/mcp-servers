import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tfs-delivery-'));
Object.assign(process.env, { TFS_MCP_LOAD_DOTENV: 'false', TFS_MCP_CONFIG_FILE: path.join(directory, 'absent.json'),
  TFS_URL: 'https://tfs.example.com', TFS_COLLECTION: 'ExampleCollection', TFS_PROJECT: 'ExampleProject',
  TFS_PAT: 'synthetic-test-pat', TFS_DEFAULT_AUTH_ALIAS: '', TFS_DELIVERY_ROOTS_JSON: JSON.stringify([directory]),
  TFS_DELIVERY_STATE_DIRECTORY: path.join(directory, 'state'), TFS_AUDIT_LOG_PATH: path.join(directory, 'audit.log'), TFS_MAX_RETRIES: '0' });
const { toolPreparePRDelivery, toolPublishPRDelivery } = await import('../src/tools/pull-request-delivery.js');
const { DeliveryInput, DELIVERY_TOOLS } = await import('../src/delivery-contract.js');
const { validateToolArguments } = await import('../src/tool-contract.js');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const base = 'https://tfs.example.com/ExampleCollection/ExampleProject/_apis';
const repoId = '00000000-0000-4000-8000-000000000001';
const attachmentId = '00000000-0000-4000-8000-000000000002';
const originalFetch = global.fetch;
test.after(async () => { global.fetch = originalFetch; await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
let fixtureSequence = 0;

async function fixture(options = {}) {
  const tag = options.tag ?? (++fixtureSequence).toString(16).padStart(5, '0');
  const sha = 'a'.repeat(40), mergeSha = 'c'.repeat(40);
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, total: options.zero ? 0 : 2, passed: options.zero ? 0 : options.failed ? 1 : 2, failed: options.failed ? 1 : 0, skipped: 0 }));
  const reportPath = path.join(directory, `report-${tag}.json`), mediaPath = path.join(directory, `capture-${tag}.png`);
  await fs.writeFile(reportPath, bytes); await fs.writeFile(mediaPath, png);
  const provenance = { commit: sha, executor: 'node-test', command: 'node --test', started_at: '2026-01-01T00:00:00Z', finished_at: '2026-01-01T00:01:00Z' };
  const input = { repo: 'example-repo', pull_request_id: Number.parseInt(tag.slice(0, 5), 16) + 1 || 42, work_item_id: 301, source_sha: sha,
    reports: [{ path: reportPath, sha256: hash(bytes), format: 'summary-json', label: 'Unit tests', provenance }],
    media: [{ path: mediaPath, sha256: hash(png), scenario: 'Scenario A', kind: 'image', redacted: true, provenance }], required_scenarios: ['Scenario A'] };
  const pr = { repository: { id: repoId, project: { id: '00000000-0000-4000-8000-000000000003' } }, sourceRefName: 'refs/heads/feature/evidence', targetRefName: options.highImpact ? 'refs/heads/main' : 'refs/heads/develop',
    lastMergeSourceCommit: { commitId: sha }, lastMergeTargetCommit: { commitId: 'e'.repeat(40) }, lastMergeCommit: { commitId: mergeSha }, description: 'Human PR text' };
  const wi = { rev: 1, fields: { 'System.Description': 'Human item text' }, relations: [
    { rel: 'AttachedFile', url: `${base}/wit/attachments/human`, attributes: { comment: 'Human attachment' } },
    { rel: 'AttachedFile', url: `${base}/wit/attachments/other`, attributes: { comment: `tfs-mcp-delivery:${'b'.repeat(64)}:other-pr` } },
  ] };
  const calls = [], state = { uploadFailure: options.uploadFailure, conflict: options.conflict, ref: sha, targetRef: 'e'.repeat(40), stripMarkers: false };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  global.fetch = async (url, request = {}) => {
    const target = new URL(url), method = request.method ?? 'GET';
    calls.push({ method, path: target.pathname, body: Buffer.isBuffer(request.body) ? 'binary' : request.body });
    if (target.pathname.endsWith('/refs')) return json({ value: target.searchParams.get('filter') === pr.sourceRefName.slice(5)
      ? [{ name: pr.sourceRefName, objectId: state.ref }] : [{ name: pr.targetRefName, objectId: state.targetRef }] });
    if (/\/build\/builds\//.test(target.pathname)) return json({ id: 9, repository: { id: options.wrongRepository ? attachmentId : repoId }, sourceVersion: options.oldBuild ? 'b'.repeat(40) : options.sourceBuild ? sha : mergeSha, status: 'completed', result: 'succeeded' });
    if (/\/pullrequests\//.test(target.pathname)) {
      if (method === 'PATCH') {
        pr.description = JSON.parse(request.body).description;
        if (state.stripPrMarkers) pr.description = pr.description.replace(/<!--[\s\S]*?-->/g, '');
        if (state.losePrResponse) { state.losePrResponse = false; throw new Error('Synthetic lost PATCH response'); }
      }
      return json(pr);
    }
    if (target.pathname.endsWith('/wit/attachments') && method === 'POST') {
      if (state.uploadFailure) throw new Error('Simulated unknown upload timeout');
      if (state.changeTargetOnUpload) pr.targetRefName = 'refs/heads/main';
      return json({ id: attachmentId, url: `${base}/wit/attachments/${attachmentId}` }, 201);
    }
    if (target.pathname.endsWith(`/wit/attachments/${attachmentId}`)) return new Response(png);
    if (/\/wit\/workitems\/301$/.test(target.pathname)) {
      if (method === 'PATCH') {
        const patch = JSON.parse(request.body);
        assert.equal(patch[0].path, '/rev'); assert.equal(patch[0].value, wi.rev);
        if (state.conflict) { state.conflict = false; wi.rev++; wi.fields['System.Description'] += '\nConcurrent human edit'; return json({}, 412); }
        for (const op of patch.slice(1)) {
          if (op.path === '/fields/System.Description') wi.fields['System.Description'] = state.stripMarkers ? 'Provider stripped markers' : op.value;
          else if (op.op === 'remove') wi.relations.splice(Number(op.path.split('/').at(-1)), 1);
          else if (op.path === '/relations/-') wi.relations.push(op.value);
        }
        wi.rev++;
        if (state.loseWiResponse) { state.loseWiResponse = false; throw new Error('Synthetic lost PATCH response'); }
      }
      return json(wi);
    }
    throw new Error(`Unexpected synthetic request ${method} ${target.pathname}`);
  };
  const prepare = async () => {
    const result = await toolPreparePRDelivery(input);
    validateToolArguments(DELIVERY_TOOLS[0].outputSchema, result);
    return result;
  };
  const publish = async (extra = {}) => {
    const prepared = await prepare();
    const result = await toolPublishPRDelivery({ ...input, plan_digest: prepared.data.planDigest, evidence_level: prepared.data.evidenceLevel, final: true, ...extra });
    validateToolArguments(DELIVERY_TOOLS[1].outputSchema, result);
    return result;
  };
  return { input, calls, pr, wi, state, prepare, publish };
}

test('prepare returns current parsed evidence without writes, executor or raw local paths', async () => {
  const f = await fixture(); const result = await f.prepare();
  assert.equal(result.data.evidenceLevel, 'verified'); assert.equal(result.meta.testsExecutedByServer, false);
  assert(f.calls.every((entry) => entry.method === 'GET'));
  assert(!JSON.stringify(result).includes(directory)); assert(!JSON.stringify(result).includes('node --test'));
  assert.throws(() => DeliveryInput.parse({ ...f.input, arbitrary: true }));
});
test('publishes once, revision guards work item and leaves human content and attachments intact', async () => {
  const f = await fixture();
  assert.equal((await f.publish()).data.status, 'published');
  assert.equal((await f.publish()).data.status, 'published');
  assert.equal(f.calls.filter((entry) => entry.method === 'POST').length, 1);
  assert.equal(f.calls.filter((entry) => entry.method === 'PATCH' && /pullrequests/.test(entry.path)).length, 1);
  assert.equal(f.wi.relations.length, 3); assert(f.wi.fields['System.Description'].startsWith('Human item text'));
  assert(f.pr.description.startsWith('Human PR text'));
  assert(!f.calls.some((entry) => /threads|comments|history/i.test(entry.path)));
});
test('dry run and high-impact guard do not upload or write', async () => {
  const f = await fixture({ highImpact: true });
  const result = await f.publish({ dry_run: true });
  assert.equal(result.data.willMutate, false);
  assert.equal((await f.publish()).data.willMutate, false);
  assert(f.calls.every((entry) => entry.method === 'GET'));
});
test('stale commit, changed file and wrong provenance stop before any remote mutation', async () => {
  const f = await fixture(); const prepared = await f.prepare();
  f.state.ref = 'b'.repeat(40); await assert.rejects(f.publish(), /source changed/);
  f.state.ref = f.input.source_sha;
  await fs.writeFile(f.input.media[0].path, Buffer.concat([png, Buffer.from('changed')]));
  await assert.rejects(toolPublishPRDelivery({ ...f.input, plan_digest: prepared.data.planDigest, final: true, evidence_level: 'verified' }), /hash/);
  assert(f.calls.every((entry) => entry.method === 'GET'));
});
test('failed and zero tests are honest partial evidence; cannot publish as verified', async () => {
  for (const options of [{ failed: true }, { zero: true }]) {
    const f = await fixture(options); const prepared = await f.prepare();
    assert.equal(prepared.data.evidenceLevel, 'partial');
    await assert.rejects(f.publish({ evidence_level: 'verified' }), /unresolved/);
    assert.equal((await f.publish({ evidence_level: 'partial' })).data.status, 'published');
    assert(f.pr.description.includes('partial'));
  }
});
test('same-PR old build is not final evidence; observed current merge tip is accepted', async () => {
  const stale = await fixture({ oldBuild: true }); stale.input.build_ids = [9];
  assert.equal((await stale.prepare()).data.evidenceLevel, 'partial');
  const fresh = await fixture(); fresh.input.build_ids = [9];
  assert.equal((await fresh.prepare()).data.evidenceLevel, 'verified');
});

test('current pipeline merge provenance is preserved rather than relabeled as the source', async () => {
  const f = await fixture(); f.input.build_ids = [9];
  for (const entry of [...f.input.reports, ...f.input.media]) entry.provenance = { ...entry.provenance, commit: 'c'.repeat(40) };
  const prepared = await f.prepare();
  assert.equal(prepared.data.sourceSha, 'a'.repeat(40));
  assert.equal(prepared.data.reports[0].provenance.commit, 'c'.repeat(40));
  assert.equal(prepared.data.media[0].provenance.commit, 'c'.repeat(40));
  assert.equal(prepared.data.evidenceLevel, 'verified');
  assert.equal((await f.publish()).data.status, 'published');
});

for (const [name, options, mutate] of [
  ['without a supplied build', {}, f => { f.input.build_ids = []; }],
  ['from another repository', { wrongRepository: true }, () => {}],
  ['from a historical build', { oldBuild: true }, () => {}],
  ['with a stale merge source', {}, f => { f.pr.lastMergeSourceCommit.commitId = 'b'.repeat(40); }],
  ['after the target advances', {}, f => { f.state.targetRef = 'f'.repeat(40); }],
]) test(`pipeline merge provenance is rejected ${name}`, async () => {
  const f = await fixture(options); f.input.build_ids = [9]; mutate(f);
  f.input.reports[0].provenance = { ...f.input.reports[0].provenance, commit: 'c'.repeat(40) };
  await assert.rejects(f.prepare(), /provenance/);
  assert(f.calls.every(entry => entry.method === 'GET'));
});
test('requires distinct final video for each configured scenario', async () => {
  const f = await fixture(); f.input.require_video_per_scenario = true;
  assert.equal((await f.prepare()).data.evidenceLevel, 'partial');
  const videoPath = path.join(directory, 'scenario.mp4'), bytes = Buffer.from('000000186674797069736f6d00000000', 'hex');
  await fs.writeFile(videoPath, bytes);
  f.input.media = ['Scenario A', 'Scenario B'].map((scenario) => ({ ...f.input.media[0],
    scenario, path: videoPath, sha256: hash(bytes), kind: 'video' }));
  f.input.required_scenarios = ['Scenario A', 'Scenario B'];
  assert((await f.prepare()).data.pending.some((entry) => entry.includes('distinct video')));
});
test('retries revision conflicts by rereading and preserves concurrent human edits', async () => {
  const f = await fixture({ conflict: true });
  assert.equal((await f.publish()).data.status, 'published');
  assert(f.wi.fields['System.Description'].includes('Concurrent human edit'));
});
test('unknown upload is not retried, known attachment can be recovered by bytes hash', async () => {
  const f = await fixture({ uploadFailure: true });
  assert.equal((await f.publish()).data.status, 'partial');
  f.state.uploadFailure = false;
  assert.equal((await f.publish()).data.status, 'partial');
  assert.equal(f.calls.filter((entry) => entry.method === 'POST').length, 1);
  assert.equal((await f.publish({ recovered_uploads: [{ sha256: hash(png), attachment_id: attachmentId }] })).data.status, 'published');
  assert.equal(f.calls.filter((entry) => entry.method === 'POST').length, 1);
});
test('provider marker stripping is partial and never deletes human attachments', async () => {
  const f = await fixture(); f.state.stripMarkers = true;
  assert.equal((await f.publish()).data.status, 'partial');
  const writes = f.calls.filter((entry) => entry.method !== 'GET').length;
  assert.equal((await f.publish()).data.status, 'partial');
  assert.equal(f.calls.filter((entry) => entry.method !== 'GET').length, writes);
  assert(f.wi.relations.some((entry) => entry.attributes.comment === 'Human attachment'));
});
test('target/status changes invalidate the digest and a high-impact change during upload stops linking', async () => {
  const f = await fixture(); const prepared = await f.prepare();
  f.pr.status = 'completed';
  await assert.rejects(toolPublishPRDelivery({ ...f.input, plan_digest: prepared.data.planDigest, evidence_level: 'verified', final: true }), /stale/);
  f.pr.status = 'active'; f.state.changeTargetOnUpload = true;
  assert.equal((await f.publish()).data.status, 'partial');
  assert.equal(f.calls.filter((entry) => entry.method === 'PATCH').length, 0);
  assert.equal((await f.publish()).data.willMutate, false);
});
test('lost PATCH replies recover existing sections rather than duplicate publication', async () => {
  for (const side of ['loseWiResponse', 'losePrResponse']) {
    const f = await fixture(); f.state[side] = true;
    assert.equal((await f.publish()).data.status, 'partial');
    assert.equal((await f.publish()).data.status, 'published');
    assert.equal(f.calls.filter((entry) => entry.method === 'POST').length, 1);
    assert.equal((f.wi.fields['System.Description'].match(/:begin -->/g) ?? []).length, 1);
    assert.equal((f.pr.description.match(/:begin -->/g) ?? []).length, 1);
  }
});
test('PR marker stripping blocks automatic reappend until remote reconciliation', async () => {
  const f = await fixture(); f.state.stripPrMarkers = true;
  assert.equal((await f.publish()).data.status, 'partial');
  const writes = f.calls.filter((entry) => entry.method !== 'GET').length;
  assert.equal((await f.publish()).data.status, 'partial');
  assert.equal(f.calls.filter((entry) => entry.method !== 'GET').length, writes);
});
test('new commit replaces only manifest-owned relations and retains another PR attachment', async () => {
  const f = await fixture(); assert.equal((await f.publish()).data.status, 'published');
  const oldMarker = f.wi.relations.find((entry) => entry.attributes.name?.startsWith('evidence-')).attributes.comment;
  f.state.ref = 'd'.repeat(40); f.input.source_sha = f.state.ref;
  for (const entry of [...f.input.reports, ...f.input.media]) entry.provenance.commit = f.state.ref;
  assert.equal((await f.publish()).data.status, 'published');
  assert.equal(f.wi.relations.length, 3);
  assert(!f.wi.relations.some((entry) => entry.attributes.comment === oldMarker));
  assert(f.wi.relations.some((entry) => entry.attributes.comment.endsWith('other-pr')));
  assert(f.wi.relations.some((entry) => entry.attributes.comment === 'Human attachment'));
  assert(!f.calls.some((entry) => entry.method === 'DELETE'));
});
test('stale merge tip and explicit caller limitations remain partial', async () => {
  const f = await fixture(); f.input.build_ids = [9];
  f.pr.lastMergeSourceCommit.commitId = 'b'.repeat(40);
  assert.equal((await f.prepare()).data.evidenceLevel, 'partial');
  f.pr.lastMergeSourceCommit.commitId = f.input.source_sha;
  f.input.limitations = ['Physical device capture not executed'];
  assert.equal((await f.publish()).data.evidenceLevel, 'partial');
  assert(f.pr.description.includes('Physical device capture not executed'));
});
test('a merge build is stale when target advances, while current source build remains identifiable', async () => {
  const f = await fixture(); f.input.build_ids = [9];
  const prepared = await f.prepare();
  f.state.targetRef = 'f'.repeat(40);
  await assert.rejects(toolPublishPRDelivery({ ...f.input, plan_digest: prepared.data.planDigest, evidence_level: 'verified', final: true }), /stale/);
  const changed = await f.prepare();
  assert.equal(changed.data.evidenceLevel, 'partial');
  assert.equal(changed.data.builds[0].matching, false);
  const source = await fixture({ sourceBuild: true }); source.input.build_ids = [9]; source.state.targetRef = 'f'.repeat(40);
  const currentSource = await source.prepare();
  assert.equal(currentSource.data.builds[0].matching, true);
  assert.equal(currentSource.data.evidenceLevel, 'verified');
});
test('no reports or media are unverified; passing pipeline alone does not imply executed tests', async () => {
  const f = await fixture(); f.input.reports = []; f.input.media = []; f.input.required_scenarios = [];
  assert.equal((await f.prepare()).data.evidenceLevel, 'unverified');
  await assert.rejects(f.publish({ evidence_level: 'partial' }), /No evidence/);
  assert.equal((await f.publish()).data.evidenceLevel, 'unverified');
  f.input.build_ids = [9];
  assert.equal((await f.prepare()).data.evidenceLevel, 'partial');
});
test('corrupted receipts and ownership metadata fail closed before reusing links', async () => {
  const f = await fixture(); await f.publish();
  const root = path.join(directory, 'state');
  const files = (await fs.readdir(root)).filter((name) => name.endsWith('.json'));
  let file, original;
  for (const name of files) {
    const value = JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
    if (value.lastManifest?.identity.pullRequestId === f.input.pull_request_id) { file = path.join(root, name); original = value; break; }
  }
  assert(file);
  const writes = f.calls.filter((entry) => entry.method !== 'GET').length;
  for (const corrupt of [
    (value) => { Object.values(value.receipts)[0].url = `https://attacker.example/wit/attachments/${attachmentId}`; },
    (value) => { Object.values(value.receipts)[0].url = `https://tfs.example.com/OtherCollection/ExampleProject/_apis/wit/attachments/${attachmentId}`; },
    (value) => { Object.values(value.receipts)[0].stage = 'unknown-stage'; },
    (value) => { value.managed[0].url = `https://attacker.example/wit/attachments/${attachmentId}`; },
    (value) => { value.managed[0].sha256 = 'b'.repeat(64); },
    (value) => { value.managed = { unexpected: true }; },
  ]) {
    const changed = structuredClone(original); corrupt(changed);
    await fs.writeFile(file, JSON.stringify(changed));
    await assert.rejects(f.publish(), /Invalid delivery ledger/);
    assert.equal(f.calls.filter((entry) => entry.method !== 'GET').length, writes);
  }
  await fs.writeFile(file, JSON.stringify(original));
  assert.equal((await f.publish()).data.status, 'published');
});
