import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  firstConfigured,
  readVersionedJsonConfigSync,
  toBoolean,
  toBoundedInteger,
  toEnum,
  toStringArray,
} from "../src/index.js";

function configFile(value) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-config-"));
  const file = path.join(directory, "config.json");
  fs.writeFileSync(file, JSON.stringify(value));
  return { directory, file };
}

test("versioned configuration is validated and deeply frozen", () => {
  const { directory, file } = configFile({ schemaVersion: 1, server: { port: 3000 } });
  const value = readVersionedJsonConfigSync(file, {
    allowedKeys: ["server"],
    validate: (configuration) => configuration.server.port === 3000,
  });
  assert.equal(value.server.port, 3000);
  assert.equal(Object.isFrozen(value.server), true);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("unknown configuration keys fail by default", () => {
  const { directory, file } = configFile({ schemaVersion: 1, typo: true });
  assert.throws(
    () => readVersionedJsonConfigSync(file, { allowedKeys: ["server"] }),
    /unknown keys: typo/,
  );
  fs.rmSync(directory, { recursive: true, force: true });
});

test("invalid versions and JSON are actionable", () => {
  const { directory, file } = configFile({ schemaVersion: 2 });
  assert.throws(() => readVersionedJsonConfigSync(file), /schemaVersion must be 1/);
  fs.writeFileSync(file, "{");
  assert.throws(() => readVersionedJsonConfigSync(file), /invalid JSON/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("bounded scalar parsers reject invalid configuration", () => {
  assert.equal(toBoolean("yes"), true);
  assert.equal(toBoolean("off"), false);
  assert.throws(() => toBoolean("sometimes"), /boolean/);
  assert.equal(toBoundedInteger("10", { min: 1, max: 20 }), 10);
  assert.throws(() => toBoundedInteger("21", { min: 1, max: 20 }), /between 1 and 20/);
  assert.equal(toEnum(undefined, ["stdio", "http"], { defaultValue: "stdio" }), "stdio");
  assert.throws(() => toEnum("tcp", ["stdio", "http"]), /stdio, http/);
});

test("list and precedence helpers normalize values", () => {
  assert.equal(firstConfigured("", " value ", "fallback"), "value");
  assert.deepEqual(toStringArray("one, two,,three"), ["one", "two", "three"]);
});
