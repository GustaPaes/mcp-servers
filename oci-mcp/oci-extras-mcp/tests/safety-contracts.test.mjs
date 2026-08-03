import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "oci-mcp-safety-"));
process.env.OCI_MCP_OWNERSHIP_LEDGER = path.join(temporaryDirectory, "ownership.json");
process.env.AUDIT_LOG_FILE = path.join(temporaryDirectory, "audit.jsonl");
process.env.LOG_LEVEL = "fatal";
process.env.LOG_REDACT_SECRETS = "true";

try {
  const [{ ALL_TOOLS, ToolOutputSchema }, manifest, guards, schemas, auditModule] =
    await Promise.all([
      import("../src/server.js"),
      import("../src/tool-manifest.js"),
      import("../src/safety/guards.js"),
      import("../src/schemas.js"),
      import("../src/safety/audit.js"),
    ]);

  assert.deepEqual(Object.keys(manifest.TOOL_POLICIES).sort(), Object.keys(ALL_TOOLS).sort());
  assert.equal(manifest.annotationsFor("oci_ledger_dump").openWorldHint, false);
  assert.equal(manifest.annotationsFor("secret_get").readOnlyHint, true);
  assert.equal(manifest.annotationsFor("fn_invoke").idempotentHint, false);
  assert.equal(manifest.annotationsFor("oke_delete_cluster").destructiveHint, true);
  assert.equal(ToolOutputSchema.safeParse({ ok: true, data: {} }).success, true);
  assert.equal(ToolOutputSchema.safeParse({ ok: true, unexpected: true }).success, false);

  const compartment = ["ocid1", "compartment", "oc1", "", "aaaaaaaaexample12345678"].join(".");
  assert.equal(schemas.CompartmentOcid.safeParse(compartment).success, true);
  assert.equal(schemas.ClusterOcid.safeParse(compartment).success, false);
  assert.equal(schemas.Ocid.safeParse("ocid1.cluster.oc1.. ").success, false);

  assert.equal(guards.effectiveDryRun({}), true);
  assert.equal(guards.effectiveDryRun({ dryRun: false }), false);
  assert.equal(
    guards.guardMutation({
      input: { confirm: compartment },
      action: "delete",
      ocid: compartment,
      resourceType: "compartment",
      destructive: true,
    }).ok,
    false
  );
  assert.equal(
    guards.guardMutation({
      input: { confirm: compartment, humanAck: true },
      action: "update",
      ocid: compartment,
      resourceType: "compartment",
    }).ok,
    false
  );
  assert.deepEqual(guards.guardSecretReveal({}), { ok: true, mask: true });
  assert.equal(guards.guardSecretReveal({ reveal: true }).ok, false);

  const queryCredentialName = ["access", "token"].join("_");
  const redacted = auditModule.redact({
    clientSecret: "do-not-log",
    error: `request failed: ${queryCredentialName}=do-not-log-either`,
  });
  assert.equal(redacted.clientSecret, "***REDACTED***");
  assert.doesNotMatch(JSON.stringify(redacted), /do-not-log/);

  const invalidConfig = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", 'await import("./src/config.js")'],
    {
      cwd: process.cwd(),
      env: { ...process.env, MCP_HTTP_SESSION_TTL_MS: "0" },
      encoding: "utf8",
    }
  );
  assert.notEqual(invalidConfig.status, 0);
  assert.match(invalidConfig.stderr, /MCP_HTTP_SESSION_TTL_MS/);

  const disabledRedaction = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", 'await import("./src/config.js")'],
    {
      cwd: process.cwd(),
      env: { ...process.env, LOG_REDACT_SECRETS: "false" },
      encoding: "utf8",
    }
  );
  assert.notEqual(disabledRedaction.status, 0);
  assert.match(disabledRedaction.stderr, /cannot be disabled/);

  const enabledGuards = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        'const g = await import("./src/safety/guards.js")',
        `const ocid = ${JSON.stringify(compartment)}`,
        'const prompt = g.guardMutation({ input: { confirm: ocid }, action: "update", ocid, resourceType: "compartment" })',
        'const approved = g.guardMutation({ input: { confirm: ocid, humanAck: true }, action: "update", ocid, resourceType: "compartment" })',
        'console.log(JSON.stringify({ prompt, approved, reveal: g.guardSecretReveal({ reveal: true }) }))',
      ].join(";"),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OCI_MCP_ALLOW_THIRD_PARTY_MUTATION: "true",
        OCI_MCP_ALLOW_SECRET_REVEAL: "true",
        OCI_MCP_OWNERSHIP_LEDGER: path.join(temporaryDirectory, "child-ownership.json"),
      },
      encoding: "utf8",
    }
  );
  assert.equal(enabledGuards.status, 0, enabledGuards.stderr);
  const enabledResult = JSON.parse(enabledGuards.stdout.trim());
  assert.equal(enabledResult.prompt.requiresHumanAck, true);
  assert.equal(enabledResult.approved.ok, true);
  assert.deepEqual(enabledResult.reveal, { ok: true, mask: false });

  await auditModule.closeAuditStream();
  console.log("safety and manifest contracts passed");
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
