import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { validateToolArguments } from "../src/tool-contract.js";

test("validates anyOf alternatives at the public boundary", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      branch: { type: "string", minLength: 1 },
      build_definition_id: { type: "integer" },
      build_definition_name: { type: "string" },
    },
    required: ["branch"],
    anyOf: [
      { required: ["build_definition_id"] },
      { required: ["build_definition_name"] },
    ],
  };

  assert.throws(
    () => validateToolArguments(schema, { branch: "main" }),
    /formato suportado/,
  );
  assert.throws(
    () => validateToolArguments(schema, { branch: "", build_definition_id: 21 }),
    /no minimo 1 caracteres/,
  );
  assert.doesNotThrow(() => validateToolArguments(schema, {
    branch: "main",
    build_definition_id: 21,
  }));
  assert.doesNotThrow(() => validateToolArguments(schema, {
    branch: "main",
    build_definition_name: "Example PR Validation",
  }));
});

test("publishes the complete safe tool contract", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["index.js"],
    cwd: process.cwd(),
    stderr: "pipe",
    env: {
      ...process.env,
      TFS_MCP_CONFIG_FILE: "",
      TFS_URL: "https://tfs.example.com",
      TFS_COLLECTION: "ExampleCollection",
      TFS_PROJECT: "ExampleProject",
    },
  });
  const client = new Client(
    { name: "tfs-contract-test", version: "1.0.0" },
    { capabilities: {} },
  );
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 34);
    const names = new Set(tools.map((tool) => tool.name));
    assert(names.has("tfs_doctor"));
    assert(names.has("tfs_saved_queries"));
    assert(names.has("tfs_pipeline_upsert"));
    assert(names.has("tfs_branch_policy_upsert"));
    assert(names.has("tfs_pipeline_queue"));
    const pipelineUpsert = tools.find(tool => tool.name === "tfs_pipeline_upsert");
    assert.deepEqual(
      pipelineUpsert.inputSchema.properties.ci_trigger_mode.enum,
      ["preserve", "yaml", "disabled"],
    );
    assert.equal(pipelineUpsert.inputSchema.properties.ci_trigger_mode.default, "preserve");
    assert.equal(pipelineUpsert.inputSchema.properties.dry_run.default, true);
    assert(pipelineUpsert.inputSchema.properties.confirm);

    const branchPolicyUpsert = tools.find(tool => tool.name === "tfs_branch_policy_upsert");
    assert.equal(branchPolicyUpsert.inputSchema.properties.branch_match_kind.default, "exact");
    assert.equal(branchPolicyUpsert.inputSchema.properties.enabled.default, true);
    assert.equal(branchPolicyUpsert.inputSchema.properties.blocking.default, true);
    assert.equal(branchPolicyUpsert.inputSchema.properties.manual_queue_only.default, false);
    assert.equal(branchPolicyUpsert.inputSchema.properties.queue_on_source_update_only.default, false);
    assert.equal(branchPolicyUpsert.inputSchema.properties.allow_cross_repository.default, false);
    for (const property of ["repository", "branch", "build_definition_name", "display_name"]) {
      assert.equal(branchPolicyUpsert.inputSchema.properties[property].minLength, 1);
    }
    assert.equal(branchPolicyUpsert.inputSchema.properties.build_definition_id.type, "integer");
    assert.equal(branchPolicyUpsert.inputSchema.properties.build_definition_id.minimum, 1);
    assert.equal(branchPolicyUpsert.inputSchema.properties.valid_duration.type, "integer");
    assert.equal(branchPolicyUpsert.inputSchema.properties.valid_duration.default, 0);
    assert.equal(branchPolicyUpsert.inputSchema.properties.dry_run.default, true);
    assert(branchPolicyUpsert.inputSchema.properties.confirm);
    assert.equal(branchPolicyUpsert.annotations.readOnlyHint, false);
    assert.equal(branchPolicyUpsert.annotations.idempotentHint, true);

    const pipelineQueue = tools.find(tool => tool.name === "tfs_pipeline_queue");
    assert.equal(pipelineQueue.inputSchema.properties.dry_run.default, false);
    for (const confirmationField of [
      "confirm",
      "reason",
      "requestedBy",
      "requested_by",
      "confirm_high_impact",
    ]) {
      assert.equal(pipelineQueue.inputSchema.properties[confirmationField], undefined);
    }
    assert.equal(pipelineQueue.annotations.readOnlyHint, false);
    assert.equal(pipelineQueue.annotations.idempotentHint, false);
    assert.equal(pipelineQueue.annotations.destructiveHint, false);
    for (const tool of tools) {
      assert.equal(tool.inputSchema?.additionalProperties, false, `${tool.name} input must be strict`);
      assert.equal(tool.outputSchema?.type, "object", `${tool.name} output must be structured`);
      assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", `${tool.name} readOnlyHint`);
      assert.equal(typeof tool.annotations?.destructiveHint, "boolean", `${tool.name} destructiveHint`);
      assert.equal(typeof tool.annotations?.idempotentHint, "boolean", `${tool.name} idempotentHint`);
    }

    const strictResult = await client.callTool({
      name: "tfs_saved_queries",
      arguments: { unexpected: true },
    });
    assert.equal(strictResult.isError, true);
    assert.match(strictResult.content[0].text, /unexpected.*nao e permitido/i);
  } finally {
    await client.close().catch(() => {});
  }
});
