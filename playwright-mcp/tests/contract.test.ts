import assert from "node:assert/strict";
import test from "node:test";
import { PUBLISHED_TOOL_DEFS, TOOL_NAMES } from "../src/server.js";
import { TOOL_NAMES_BY_RISK, TOOL_POLICY } from "../src/tool-policy.js";
import { validateToolArguments } from "../src/tool-contract.js";
import {
  assertUrlAllowed,
  isHostExplicitlyAllowed,
  isPrivateAddress,
  shouldBlockResolvedAddress,
} from "../src/safety/selectors.js";
import { config } from "../src/config.js";

test("publishes a complete, bounded and explicitly classified contract", () => {
  assert.equal(TOOL_NAMES.length, Object.keys(TOOL_POLICY).length);
  assert.equal(new Set(TOOL_NAMES).size, TOOL_NAMES.length);
  assert(TOOL_NAMES.includes("context_recording_status"));
  assert(TOOL_NAMES.includes("network_log_status"));
  for (const tool of PUBLISHED_TOOL_DEFS) {
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} strict input`);
    assert.equal(tool.outputSchema?.type, "object", `${tool.name} output schema`);
    assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", `${tool.name} readOnlyHint`);
    assert.equal(typeof tool.annotations?.destructiveHint, "boolean", `${tool.name} destructiveHint`);
    assert.equal(typeof tool.annotations?.idempotentHint, "boolean", `${tool.name} idempotentHint`);
    assert.equal(typeof tool.annotations?.openWorldHint, "boolean", `${tool.name} openWorldHint`);
  }
  assert(TOOL_NAMES_BY_RISK.DESTRUCTIVE.includes("network_log_stop"));
  assert(TOOL_NAMES_BY_RISK.READ.includes("network_log_status"));
  assert(TOOL_NAMES_BY_RISK.SECRET_READ.includes("page_get_cookies"));
});

test("runtime argument validation rejects unknown fields and excessive bounds", () => {
  const goto = PUBLISHED_TOOL_DEFS.find((tool) => tool.name === "page_goto")!;
  assert.throws(
    () => validateToolArguments(goto.inputSchema, { url: "https://example.com", unknown: true }),
    /not allowed/,
  );
  assert.throws(
    () => validateToolArguments(goto.inputSchema, { url: "https://example.com", timeout_ms: config.maxToolTimeoutMs + 1 }),
    /at most/,
  );
  const query = PUBLISHED_TOOL_DEFS.find((tool) => tool.name === "page_query_selector_all")!;
  assert.throws(() => validateToolArguments(query.inputSchema, { selector: "body", limit: 0 }), /at least/);
});

test("private, loopback and link-local addresses are recognized", async () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "fd00::1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  if (config.strict && config.blockPrivateNetworks) {
    await assert.rejects(() => assertUrlAllowed("http://127.0.0.1/resource"), /blocked address/);
    assert.equal(shouldBlockResolvedAddress("internal.example", "10.0.0.5", []), true);
    assert.equal(shouldBlockResolvedAddress("internal.example", "10.0.0.5", ["internal.example"]), false);
    assert.equal(isHostExplicitlyAllowed("api.internal.example", ["*.internal.example"]), true);
  }
});
