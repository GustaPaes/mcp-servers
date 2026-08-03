import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TOOL_RISK,
  annotationsForRisk,
  assertSafeIdentifier,
  assertToolManifest,
  atomicWriteJson,
  createSerialExecutor,
  redactHeaders,
  redactSensitiveValue,
  resolveInside,
  resolveInsideAny,
} from "../src/index.js";

test("canonical risk policies derive annotations and reject manifest drift", () => {
  assert.deepEqual(annotationsForRisk(TOOL_RISK.READ), {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.equal(annotationsForRisk(TOOL_RISK.SECRET_READ).openWorldHint, true);
  const definitions = [{ name: "status" }];
  const handlers = { status: () => ({ ok: true }) };
  const policies = { status: { risk: TOOL_RISK.READ } };
  assert.equal(assertToolManifest({ definitions, handlers, policies }), definitions);
  assert.throws(
    () => assertToolManifest({ definitions, handlers: {}, policies }),
    /missing handlers: status/,
  );
  assert.throws(
    () => assertToolManifest({ definitions, handlers, policies: { status: { risk: "UNKNOWN" } } }),
    /invalid risks: status/,
  );
});

test("safe identifiers reject traversal and separators", () => {
  assert.equal(assertSafeIdentifier("build_123-test"), "build_123-test");
  assert.throws(() => assertSafeIdentifier("../secret"));
  assert.throws(() => assertSafeIdentifier("a/b"));
});

test("path confinement rejects lexical traversal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-runtime-root-"));
  assert.equal(resolveInside(root, "nested", "file.json"), path.join(root, "nested", "file.json"));
  assert.throws(() => resolveInside(root, "..", "outside.json"), /escapes/);
  assert.throws(() => resolveInsideAny([root], path.join(root, "..", "outside.json")), /outside/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("path confinement rejects symbolic-link escapes", (context) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-runtime-links-"));
  const root = path.join(parent, "root");
  const outside = path.join(parent, "outside");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  const link = path.join(root, "escape");
  try {
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    fs.rmSync(parent, { recursive: true, force: true });
    context.skip(`symbolic links are unavailable: ${error.code ?? error.message}`);
    return;
  }
  assert.throws(() => resolveInside(root, "escape", "secret.json"), /symbolic link/);
  assert.throws(() => resolveInsideAny([root], path.join(link, "secret.json")), /outside/);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("path confinement rejects unresolved symbolic links", (context) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-runtime-broken-link-"));
  const root = path.join(parent, "root");
  fs.mkdirSync(root);
  const link = path.join(root, "missing-target");
  try {
    fs.symlinkSync(path.join(parent, "does-not-exist"), link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    fs.rmSync(parent, { recursive: true, force: true });
    context.skip(`symbolic links are unavailable: ${error.code ?? error.message}`);
    return;
  }
  assert.throws(() => resolveInside(root, "missing-target", "secret.json"), /symbolic link/);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("redaction covers headers, camelCase fields and common token forms", () => {
  assert.deepEqual(redactHeaders({ Authorization: "Bearer value", Accept: "json" }), {
    Authorization: "[REDACTED]",
    Accept: "json",
  });
  const redacted = redactSensitiveValue({
    clientSecret: "secret-value",
    accessToken: "token-value",
    nested: { databasePassword: "password-value", label: "safe" },
  });
  assert.deepEqual(redacted, {
    clientSecret: "[REDACTED]",
    accessToken: "[REDACTED]",
    nested: { databasePassword: "[REDACTED]", label: "safe" },
  });
  const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "c2lnbmF0dXJlMQ"].join(".");
  const text = redactSensitiveValue(`Basic dXNlcjpwYXNz accessToken=value ${jwt}`);
  assert.doesNotMatch(text, /dXNlcjpwYXNz|accessToken=value|eyJhbGci/);
  const manyValues = redactSensitiveValue(Array.from({ length: 101 }, (_, index) => index));
  assert.equal(manyValues.length, 101);
  assert.equal(manyValues.at(-1), "[TRUNCATED_1_ITEMS]");
});

test("atomic writes remain valid under concurrent callers", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-runtime-write-"));
  const target = path.join(directory, "state.json");
  await Promise.all(Array.from({ length: 20 }, (_, value) => atomicWriteJson(target, { value })));
  const stored = JSON.parse(fs.readFileSync(target, "utf8"));
  assert.equal(typeof stored.value, "number");
  assert.deepEqual(fs.readdirSync(directory), ["state.json"]);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("serial executor continues after a rejected operation", async () => {
  const executor = createSerialExecutor();
  const order = [];
  await assert.rejects(executor(async () => {
    order.push(1);
    throw new Error("expected");
  }));
  await executor(() => order.push(2));
  assert.deepEqual(order, [1, 2]);
});
