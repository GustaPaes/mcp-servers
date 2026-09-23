import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tfs-scope-test-"));
const configFile = path.join(directory, "tfs.json");
await fs.writeFile(configFile, JSON.stringify({
  schemaVersion: 1,
  connection: { url: "https://tfs.example.test/tfs", collection: "Alpha", project: "Shared" },
  collections: ["Alpha", "Beta"],
  scopes: [
    { collection: "Alpha", project: "Shared", repositories: ["repo-alpha"], authAlias: "alpha", fields: { issueAnalysis: "Custom.AlphaAnalysis" } },
    { collection: "Beta", project: "Shared", repositories: ["repo-beta"], authAlias: "beta", fields: { issueAnalysis: "Custom.BetaAnalysis" } },
  ],
}), "utf8");
process.env.TFS_MCP_CONFIG_FILE = configFile;
process.env.TFS_URL = "";
process.env.TFS_COLLECTION = "";
process.env.TFS_PROJECT = "";
process.env.TFS_PAT = "";
process.env.TFS_PAT_ALPHA = "synthetic-alpha-token";
process.env.TFS_PAT_BETA = "synthetic-beta-token";

const { runWithRequestContext } = await import("../src/request-context.js");
const { getDefaultRepository, getIssueAnalysisFields, getTfsScope } = await import("../src/config.js");
const { cacheClearAll, tfsGet, tfsGetAbsoluteText } = await import("../src/tfs-client.js");
const { toolListCollections, toolListProjects } = await import("../src/tools/collections.js");
const { buildMutationPlan } = await import("../src/safety.js");

test.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
test.beforeEach(() => cacheClearAll());

test("same project and item IDs stay isolated by collection, PAT and cache", async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), auth: options.headers.Authorization });
    return Response.json({ id: 7, collection: new URL(url).pathname.includes("/Beta/") ? "Beta" : "Alpha" });
  };
  try {
    const alpha = await runWithRequestContext({ collection: "Alpha", project: "Shared" }, async () => {
      assert.equal(getDefaultRepository(), "repo-alpha");
      assert.equal(getIssueAnalysisFields().developmentAnalysis, "Custom.AlphaAnalysis");
      return tfsGet("/wit/workitems/7", {}, { cacheKey: "item:7", cacheTtlMs: 60_000 });
    });
    const beta = await runWithRequestContext({ collection: "Beta", project: "Shared" }, async () => {
      assert.equal(getDefaultRepository(), "repo-beta");
      assert.equal(getIssueAnalysisFields().developmentAnalysis, "Custom.BetaAnalysis");
      return tfsGet("/wit/workitems/7", {}, { cacheKey: "item:7", cacheTtlMs: 60_000 });
    });
    assert.equal(alpha.collection, "Alpha");
    assert.equal(beta.collection, "Beta");
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /\/tfs\/Alpha\/Shared\/_apis\/wit\/workitems\/7/);
    assert.match(requests[1].url, /\/tfs\/Beta\/Shared\/_apis\/wit\/workitems\/7/);
    assert.notEqual(requests[0].auth, requests[1].auth);
  } finally { globalThis.fetch = previousFetch; }
});

test("discovery and project listing expose bounded continuation", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes("projectCollections")) {
      return Response.json({ value: [{ id: "c1", name: "Alpha" }] }, { headers: { "x-ms-continuationtoken": "next" } });
    }
    return Response.json({ value: [{ id: "p1", name: "Shared" }] });
  };
  try {
    const collections = await toolListCollections({ top: 1 });
    const projects = await runWithRequestContext({ collection: "Beta" }, () => toolListProjects({ top: 1, cursor: "next" }));
    assert.equal(collections.nextCursor, "next");
    assert.equal(collections.complete, false);
    assert.equal(projects.collection, "Beta");
    assert.match(requests[0], /\/tfs\/_apis\/projectCollections\?/);
    assert.match(requests[1], /\/tfs\/Beta\/_apis\/projects\?/);
    assert.match(requests[1], /continuationToken=next/);
  } finally { globalThis.fetch = previousFetch; }
});

test("unavailable discovery returns explicitly incomplete local configuration", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ message: "forbidden" }, { status: 403 });
  try {
    const first = await toolListCollections({ top: 1 });
    const second = await toolListCollections({ top: 1, cursor: first.nextCursor });
    assert.equal(first.source, "local-config");
    assert.equal(first.complete, false);
    assert.equal(first.nextCursor, "local:1");
    assert.equal(second.collections[0].name, "Beta");
    assert.equal(second.nextCursor, null);
    assert.match(first.warnings[0], /não comprova todas/);
  } finally { globalThis.fetch = previousFetch; }
});

test("credentials stay within the configured root and selected project; redirects fail closed", async () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(null, { status: 302, headers: { location: "https://attacker.example/" } });
  };
  try {
    await assert.rejects(() => runWithRequestContext({ collection: "Beta", project: "Shared" },
      () => tfsGetAbsoluteText("https://tfs.example.test/other/Beta/Shared/_apis/test")), /origem nao confiavel/);
    await assert.rejects(() => runWithRequestContext({ collection: "Beta", project: "Shared" },
      () => tfsGetAbsoluteText("https://tfs.example.test/tfs/Alpha/Shared/_apis/test")), /projeto selecionados/);
    await assert.rejects(() => runWithRequestContext({ collection: "Beta", project: "Shared" },
      () => tfsGet("/../../../../Alpha/Shared/_apis/wit/fields")), /escapou da API/);
    assert.equal(requests, 0);
    await assert.rejects(() => runWithRequestContext({ collection: "Beta", project: "Shared" },
      () => tfsGet("/wit/fields")), /Redirecionamento TFS recusado/);
    assert.equal(requests, 1);
    assert.equal(getTfsScope().collection, "Alpha");
  } finally { globalThis.fetch = previousFetch; }
});

test("mutation previews and confirmation values identify the selected collection", () => {
  const build = (collection) => runWithRequestContext({ collection, project: "Shared" }, () => buildMutationPlan({
    tool: "tfs_update_work_item", target: { id: 7 }, operation: "update", changes: {},
    controls: { dryRun: true, confirm: false, reason: "", requestedBy: "", confirmHighImpact: "" },
    highImpact: true, highImpactConfirmation: "7",
  }));
  const alpha = build("Alpha");
  const beta = build("Beta");
  assert.deepEqual([alpha.context.collection, alpha.context.project], ["Alpha", "Shared"]);
  assert.deepEqual([beta.context.collection, beta.context.project], ["Beta", "Shared"]);
  assert.equal(alpha.confirmation.highImpactConfirmationRequired, "Alpha/Shared:7");
  assert.equal(beta.confirmation.highImpactConfirmationRequired, "Beta/Shared:7");
});

test("a different collection without a unique project requires explicit context", () => {
  assert.throws(() => runWithRequestContext({ collection: "Third" }, () => getTfsScope()), /Informe project/);
  const scope = runWithRequestContext({ collection: "Third", project: "Named" }, () => getTfsScope());
  assert.equal(scope.project, "Named");
});
