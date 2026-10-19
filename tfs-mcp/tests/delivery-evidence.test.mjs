import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.TFS_MCP_LOAD_DOTENV = 'false';
process.env.TFS_MCP_CONFIG_FILE = path.join(os.tmpdir(), 'tfs-absent-config.json');
process.env.TFS_URL = 'https://tfs.example.com';
const { parseTestEvidence } = await import('../src/test-evidence.js');
const { readEvidenceFile, mediaType, replaceManagedSection, preserveDeliverySections } = await import('../src/evidence-manifest.js');
const parse = (text, format) => parseTestEvidence(Buffer.from(text), format);

test('parses bounded summary and Jest counters without publishing raw output', () => {
  assert.equal(parse('{"schemaVersion":1,"total":3,"passed":2,"failed":1,"skipped":0}', 'summary-json').failed, 1);
  assert.throws(() => parse('{"schemaVersion":1,"total":3,"passed":3,"failed":1,"skipped":0}', 'summary-json'), /Inconsistent/);
  assert.throws(() => parse('{"schemaVersion":1,"total":0,"passed":0,"failed":0,"skipped":0,"arbitrary":true}', 'summary-json'));
  assert.equal(parse(JSON.stringify({ numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0,
    numRuntimeErrorTestSuites: 1, success: false, testResults: [{ message: 'private output omitted' }] }), 'jest-json').executionFailed, true);
});

test('parses JUnit cases, skipped and errors and rejects inconsistent totals', () => {
  assert.deepEqual(parse('<testsuites><testsuite tests="3"><testcase name="a"/><testcase name="b"><failure>private</failure></testcase><testcase name="c"><skipped/></testcase></testsuite></testsuites>', 'junit'),
    { schemaVersion: 1, total: 3, passed: 1, failed: 1, skipped: 1 });
  assert.throws(() => parse('<testsuite tests="2"><testcase/></testsuite>', 'junit'), /counters/);
  assert.throws(() => parse('<testsuite tests="1" failures="1"><testcase/></testsuite>', 'junit'), /counters/);
  assert.equal(parse('<testsuite tests="1" failures="0" errors="1"><testcase><error/></testcase></testsuite>', 'junit').failed, 1);
  assert.throws(() => parse('<testsuite><testcase>', 'junit'), /Invalid XML/);
});

test('parses namespaced TRX with concrete results and execution outcome', () => {
  const xml = '<TestRun xmlns="http://example.com/trx"><Results><UnitTestResult outcome="Passed"/></Results><ResultSummary outcome="Completed"><Counters total="1" passed="1" failed="0"/></ResultSummary></TestRun>';
  assert.equal(parse(xml, 'trx').passed, 1);
  assert.throws(() => parse(xml.replace('total="1"', 'total="2"'), 'trx'), /results/);
  assert.throws(() => parse(xml.replace('outcome="Passed"', 'outcome="Failed"'), 'trx'), /outcomes/);
});

test('rejects DTD, entities, unsafe properties and excessive nesting', () => {
  assert.throws(() => parse('<!DOCTYPE x [<!ENTITY ext SYSTEM "file:///etc/passwd">]><testsuite/>', 'junit'), /forbidden/);
  assert.throws(() => parse('<__proto__><x/></__proto__>', 'junit'));
  assert.throws(() => parse('<x>'.repeat(40) + '</x>'.repeat(40), 'junit'));
});

test('confines physical evidence paths, blocks secret files, size and directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tfs-evidence-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'tfs-outside-'));
  try {
    await fs.writeFile(path.join(root, 'report.json'), '{}');
    await fs.writeFile(path.join(root, '.env'), 'not a real credential');
    await fs.writeFile(path.join(outside, 'report.json'), '{}');
    assert.equal((await readEvidenceFile(path.join(root, 'report.json'), 20, [root])).length, 2);
    await assert.rejects(readEvidenceFile(path.join(root, '.env'), 20, [root]), /Secret/);
    await assert.rejects(readEvidenceFile(path.join(root, "'credentials.json'"), 20, [root]), /Secret/);
    await assert.rejects(readEvidenceFile(path.join(root, 'secret-capture.png'), 20, [root]), /Secret/);
    await fs.writeFile(path.join(root, 'report.xml'), '<testsuite>'.repeat(20));
    await assert.rejects(readEvidenceFile(path.join(root, 'report.xml'), 16, [root]), /limits/);
    await assert.rejects(readEvidenceFile(path.join(outside, 'report.json'), 20, [root]), /outside/);
    await assert.rejects(readEvidenceFile(path.join(root, 'report.json'), 1, [root]), /limits/);
    await assert.rejects(readEvidenceFile(root, 20, [root]));
    await fs.symlink(outside, path.join(root, 'escaped'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(readEvidenceFile(path.join(root, 'escaped', 'report.json'), 20, [root]), /outside/);
  } finally { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); }
});

test('requires matching media kind, extension and signature', () => {
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  assert.equal(mediaType(png, 'capture.png', 'image').mime, 'image/png');
  assert.throws(() => mediaType(png, 'capture.mp4', 'video'));
  assert.throws(() => mediaType(Buffer.from('<svg/>'), 'capture.png', 'image'));
});

test('upserts only exact owned sections and preserves human and other automation content', () => {
  const key = 'a'.repeat(64), other = 'b'.repeat(64);
  const original = replaceManagedSection('Human text', other, 'Other delivery');
  const once = replaceManagedSection(original, key, 'First');
  const twice = replaceManagedSection(once, key, 'Final');
  assert(twice.includes('Human text')); assert(twice.includes('Other delivery'));
  assert(!twice.includes('First')); assert(twice.includes('Final'));
  assert(preserveDeliverySections(twice, 'Revised human summary').includes('Final'));
  assert.throws(() => replaceManagedSection(once + `<!-- tfs-mcp-delivery:${key}:begin -->`, key, 'x'), /ambiguous/);
});
