import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
    assert.equal(tools.length, 33);
    const names = new Set(tools.map((tool) => tool.name));
    assert(names.has("tfs_doctor"));
    assert(names.has("tfs_saved_queries"));
    assert(names.has("tfs_pipeline_upsert"));
    assert(names.has("tfs_pipeline_queue"));
    const pipelineUpsert = tools.find(tool => tool.name === "tfs_pipeline_upsert");
    assert.deepEqual(
      pipelineUpsert.inputSchema.properties.ci_trigger_mode.enum,
      ["preserve", "yaml", "disabled"],
    );
    assert.equal(pipelineUpsert.inputSchema.properties.ci_trigger_mode.default, "preserve");
    assert.equal(pipelineUpsert.inputSchema.properties.dry_run.default, true);
    assert(pipelineUpsert.inputSchema.properties.confirm);

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
    for (const tool of tools) {
      assert.equal(tool.inputSchema?.additionalProperties, false, `${tool.name} input must be strict`);
      assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", `${tool.name} readOnlyHint`);
      assert.equal(typeof tool.annotations?.destructiveHint, "boolean", `${tool.name} destructiveHint`);
      assert.equal(typeof tool.annotations?.idempotentHint, "boolean", `${tool.name} idempotentHint`);
    }
  } finally {
    await client.close().catch(() => {});
  }
});
