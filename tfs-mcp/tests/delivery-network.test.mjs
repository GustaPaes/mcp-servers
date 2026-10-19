import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
Object.assign(process.env, { TFS_MCP_LOAD_DOTENV: 'false', TFS_MCP_CONFIG_FILE: path.join(os.tmpdir(), 'absent-tfs-config.json'),
  TFS_URL: 'https://tfs.example.com/install', TFS_COLLECTION: 'ExampleCollection', TFS_PROJECT: 'ExampleProject',
  TFS_PAT: 'synthetic-test-pat', TFS_DEFAULT_AUTH_ALIAS: '', TFS_REQUEST_TIMEOUT_MS: '30', TFS_MAX_RETRIES: '3' });
const { tfsUploadAttachment, tfsReadAttachment } = await import('../src/tfs-client.js');
const original = global.fetch;
test.after(() => { global.fetch = original; });
const id = '00000000-0000-4000-8000-000000000002';
const filename = `evidence-${'a'.repeat(64)}.png`;
test('upload refuses redirects, never forwards credentials or retries an uncertain POST', async () => {
  let calls = 0;
  global.fetch = async (url, options) => { calls++; assert.equal(new URL(url).origin, 'https://tfs.example.com');
    assert.equal(options.redirect, 'manual'); return new Response(null, { status: 302, headers: { location: 'https://attacker.example/upload' } }); };
  await assert.rejects(tfsUploadAttachment(Buffer.from('bounded'), filename), /recusado/);
  assert.equal(calls, 1);
  global.fetch = async () => { calls++; throw new Error('request timeout'); };
  await assert.rejects(tfsUploadAttachment(Buffer.from('bounded'), filename), /timeout/);
  assert.equal(calls, 2);
});
test('upload validates exact scoped receipt and accepts collection-level provider URL', async () => {
  for (const url of [`https://attacker.example/wit/attachments/${id}`, `https://tfs.example.com/install/OtherCollection/_apis/wit/attachments/${id}`]) {
    global.fetch = async () => Response.json({ id, url });
    await assert.rejects(tfsUploadAttachment(Buffer.from('bounded'), filename));
  }
  global.fetch = async () => Response.json({ id, url: `https://tfs.example.com/install/ExampleCollection/_apis/wit/attachments/${id}?fileName=capture.png` });
  assert.equal((await tfsUploadAttachment(Buffer.from('bounded'), filename)).url,
    `https://tfs.example.com/install/ExampleCollection/ExampleProject/_apis/wit/attachments/${id}`);
});
test('accepts only the observed current project GUID and normalizes to configured project name', async () => {
  const projectId = '00000000-0000-4000-8000-000000000003';
  const receipt = (project) => ({ id, url: `https://tfs.example.com/install/ExampleCollection/${project}/_apis/wit/attachments/${id}?fileName=capture.png` });
  global.fetch = async () => Response.json(receipt(projectId));
  assert.equal((await tfsUploadAttachment(Buffer.from('bounded'), filename, { projectId })).url,
    `https://tfs.example.com/install/ExampleCollection/ExampleProject/_apis/wit/attachments/${id}`);
  global.fetch = async () => Response.json(receipt('00000000-0000-4000-8000-000000000004'));
  await assert.rejects(tfsUploadAttachment(Buffer.from('bounded'), filename, { projectId }), /receipt path/);
});
test('bounded recovery times out on stalled bodies and rejects oversized responses', async () => {
  global.fetch = async () => new Response(new ReadableStream({ start() {} }));
  await assert.rejects(tfsReadAttachment(id, 10), /timeout/);
  global.fetch = async () => new Response(Buffer.alloc(20));
  await assert.rejects(tfsReadAttachment(id, 10), /size exceeded/);
});
