import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPullRequestArtifactId,
  ensurePullRequestWorkItemLinks,
  normalizePRWorkItemIds,
} from "../src/tools/pull-request-links.js";
import {
  classifyPullRequestBuild,
  loadPullRequestPipelines,
} from "../src/tools/pull-request-builds.js";
import { toolCreatePR } from "../src/tools/pull-request.js";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const REPOSITORY_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_REPOSITORY_ID = "33333333-3333-3333-3333-333333333333";
const ARTIFACT_ID = buildPullRequestArtifactId(PROJECT_ID, REPOSITORY_ID, 42);

test("normalizes and de-duplicates PR work item ids", () => {
  assert.deepEqual(normalizePRWorkItemIds([101, "102", 101]), [101, 102]);
  assert.throws(() => normalizePRWorkItemIds([0]), /invalido/i);
  assert.throws(() => normalizePRWorkItemIds(["1.5"]), /invalido/i);
});

test("builds the canonical pull request ArtifactLink", () => {
  assert.equal(
    ARTIFACT_ID,
    `vstfs:///Git/PullRequestId/${PROJECT_ID}%2F${REPOSITORY_ID}%2F42`
  );
});

test("reconciles work item links idempotently", async () => {
  const workItems = new Map([
    [101, { id: 101, rev: 4, relations: [{ rel: "ArtifactLink", url: ARTIFACT_ID }] }],
    [102, { id: 102, rev: 7, relations: [] }],
  ]);
  const patches = [];
  const get = async (endpoint) => {
    const id = Number(endpoint.match(/workitems\/(\d+)/i)?.[1]);
    return structuredClone(workItems.get(id));
  };
  const jsonPatch = async (method, endpoint, operations) => {
    patches.push({ method, endpoint, operations });
    const id = Number(endpoint.match(/workitems\/(\d+)/i)?.[1]);
    const item = workItems.get(id);
    item.rev += 1;
    item.relations.push(operations.find((operation) => operation.path === "/relations/-").value);
    return structuredClone(item);
  };
  const input = {
    pr: { artifactId: ARTIFACT_ID },
    repository: "example-repo",
    pullRequestId: 42,
    workItemIds: [101, 102, 102],
    get,
    jsonPatch,
  };

  const first = await ensurePullRequestWorkItemLinks(input);
  assert.deepEqual(first, {
    status: "complete",
    requestedIds: [101, 102],
    linkedIds: [101, 102],
    addedIds: [102],
    alreadyLinkedIds: [101],
    failed: [],
  });
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].operations[0], { op: "test", path: "/rev", value: 7 });

  const second = await ensurePullRequestWorkItemLinks(input);
  assert.equal(second.status, "complete");
  assert.deepEqual(second.addedIds, []);
  assert.deepEqual(second.alreadyLinkedIds, [101, 102]);
  assert.equal(patches.length, 1, "a retry must not create duplicate ArtifactLinks");
});

test("reports partial work item link failures without hiding successful links", async () => {
  const get = async (endpoint) => ({
    id: Number(endpoint.match(/workitems\/(\d+)/i)?.[1]),
    rev: 1,
    relations: [],
  });
  const jsonPatch = async (_method, endpoint) => {
    if (endpoint.endsWith("/202")) {
      const error = new Error("synthetic permission failure");
      error.status = 403;
      throw error;
    }
    return {};
  };

  const result = await ensurePullRequestWorkItemLinks({
    pr: { artifactId: ARTIFACT_ID },
    repository: "example-repo",
    pullRequestId: 42,
    workItemIds: [201, 202],
    get,
    jsonPatch,
  });

  assert.equal(result.status, "partial");
  assert.deepEqual(result.linkedIds, [201]);
  assert.deepEqual(result.addedIds, [201]);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].id, 202);
  assert.equal(result.failed[0].error, "A solicitação ao TFS falhou com status 403.");
});

test("redacts remote failure details from partial link reports", async () => {
  const error = new Error(
    "TFS 403 PATCH /wit/workitems/205: accessToken=secret-value https://tfs.example.com/private",
  );
  error.status = 403;
  const result = await ensurePullRequestWorkItemLinks({
    pr: { artifactId: ARTIFACT_ID },
    repository: "example-repo",
    pullRequestId: 42,
    workItemIds: [205],
    get: async () => ({ id: 205, rev: 1, relations: [] }),
    jsonPatch: async () => { throw error; },
  });

  assert.equal(result.status, "failed");
  assert.deepEqual(result.failed, [
    { id: 205, error: "A solicitação ao TFS falhou com status 403." },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /secret-value|\/private/);
});

test("fails closed when a work item response has no revision", async () => {
  let patchCalled = false;
  const result = await ensurePullRequestWorkItemLinks({
    pr: { artifactId: ARTIFACT_ID },
    repository: "example-repo",
    pullRequestId: 42,
    workItemIds: [206],
    get: async () => ({ id: 206, relations: [] }),
    jsonPatch: async () => { patchCalled = true; },
  });

  assert.equal(result.status, "failed");
  assert.equal(patchCalled, false);
  assert.match(result.failed[0].error, /não informou uma revisão/i);
});

test("re-checks the relation after an optimistic concurrency conflict", async () => {
  const item = { id: 203, rev: 1, relations: [] };
  let patchAttempts = 0;
  const get = async () => structuredClone(item);
  const jsonPatch = async () => {
    patchAttempts += 1;
    item.rev += 1;
    item.relations.push({ rel: "ArtifactLink", url: ARTIFACT_ID });
    const error = new Error("synthetic revision conflict");
    error.status = 412;
    throw error;
  };

  const result = await ensurePullRequestWorkItemLinks({
    pr: { artifactId: ARTIFACT_ID },
    repository: "example-repo",
    pullRequestId: 42,
    workItemIds: [203],
    get,
    jsonPatch,
  });

  assert.equal(result.status, "complete");
  assert.deepEqual(result.addedIds, []);
  assert.deepEqual(result.alreadyLinkedIds, [203]);
  assert.equal(patchAttempts, 1);
});

test("does not treat echoed workItemRefs as proof of an ArtifactLink", async () => {
  let patchAttempts = 0;
  const result = await ensurePullRequestWorkItemLinks({
    pr: {
      artifactId: ARTIFACT_ID,
      workItemRefs: [{ id: "204" }],
    },
    repository: "example-repo",
    pullRequestId: 42,
    workItemIds: [204],
    get: async () => ({ id: 204, rev: 1, relations: [] }),
    jsonPatch: async () => {
      patchAttempts += 1;
      return {};
    },
  });

  assert.equal(result.status, "complete");
  assert.deepEqual(result.addedIds, [204]);
  assert.equal(patchAttempts, 1);
});

test("matches builds only with repository plus PR id or source SHA", () => {
  const identity = {
    pullRequestId: 42,
    repositoryId: REPOSITORY_ID,
    repositoryName: "example-repo",
    commitIds: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  };
  const baseBuild = {
    repository: { id: REPOSITORY_ID, name: "example-repo" },
  };

  assert.equal(
    classifyPullRequestBuild(
      { ...baseBuild, sourceBranch: "refs/pull/42/merge" },
      identity
    ).matches,
    true
  );
  assert.deepEqual(
    classifyPullRequestBuild(
      {
        ...baseBuild,
        sourceBranch: "refs/heads/feature/example",
        triggerInfo: { "pr.number": "42" },
      },
      identity
    ).matchedBy,
    ["pull-request-id"]
  );
  assert.deepEqual(
    classifyPullRequestBuild(
      {
        ...baseBuild,
        sourceBranch: "refs/heads/feature/example",
        sourceVersion: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      identity
    ).matchedBy,
    ["source-version"]
  );
  assert.equal(
    classifyPullRequestBuild(
      {
        repository: { id: OTHER_REPOSITORY_ID, name: "other-repo" },
        sourceBranch: "refs/pull/42/merge",
        sourceVersion: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      identity
    ).matches,
    false,
    "PR id and SHA are insufficient when the repository differs"
  );
  assert.equal(
    classifyPullRequestBuild(
      {
        ...baseBuild,
        sourceBranch: "refs/heads/main",
        sourceVersion: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      identity
    ).matches,
    false,
    "sharing only the target branch is not evidence of a PR build"
  );
});

test("loads PR pipelines from exact and recent queries without false negatives or duplicates", async () => {
  const observedRequests = [];
  const exactBuilds = [
    {
      id: 501,
      definition: { id: 10, name: "PR validation" },
      repository: { id: REPOSITORY_ID, name: "example-repo" },
      sourceBranch: "refs/pull/42/merge",
      sourceVersion: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      queueTime: "2026-08-03T12:00:00Z",
      status: "completed",
      result: "succeeded",
    },
  ];
  const recentBuilds = [
    exactBuilds[0],
    {
      id: 504,
      definition: { id: 40, name: "Manual source validation" },
      repository: { id: REPOSITORY_ID, name: "example-repo" },
      sourceBranch: "refs/heads/feature/example",
      sourceVersion: "cccccccccccccccccccccccccccccccccccccccc",
      queueTime: "2026-08-03T15:00:00Z",
      status: "completed",
      result: "succeeded",
    },
    {
      id: 502,
      definition: { id: 20, name: "Unrelated repository" },
      repository: { id: OTHER_REPOSITORY_ID, name: "other-repo" },
      sourceBranch: "refs/pull/42/merge",
      queueTime: "2026-08-03T13:00:00Z",
      status: "completed",
      result: "failed",
    },
    {
      id: 503,
      definition: { id: 30, name: "Same branch only" },
      repository: { id: REPOSITORY_ID, name: "example-repo" },
      sourceBranch: "refs/heads/main",
      sourceVersion: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      queueTime: "2026-08-03T14:00:00Z",
      status: "completed",
      result: "succeeded",
    },
  ];
  const get = async (endpoint, params) => {
    observedRequests.push({ endpoint, params });
    return {
      value: params.branchName ? exactBuilds : recentBuilds,
    };
  };

  const result = await loadPullRequestPipelines({
    pr: {
      repository: { id: REPOSITORY_ID, name: "example-repo" },
      lastMergeCommit: { commitId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      lastMergeSourceCommit: { commitId: "cccccccccccccccccccccccccccccccccccccccc" },
    },
    repository: "example-repo",
    pullRequestId: 42,
    get,
  });

  assert.equal(observedRequests.length, 2);
  for (const request of observedRequests) {
    assert.equal(request.endpoint, "/build/builds");
    assert.equal(request.params.repositoryId, REPOSITORY_ID);
    assert.equal(request.params.repositoryType, "TfsGit");
    assert.equal(request.params.$top, 100);
  }
  const exactRequest = observedRequests.find((request) => request.params.branchName);
  const recentRequest = observedRequests.find((request) => !request.params.branchName);
  assert.equal(exactRequest.params.reasonFilter, "pullRequest");
  assert.equal(exactRequest.params.branchName, "refs/pull/42/merge");
  assert.equal(recentRequest.params.reasonFilter, undefined);
  assert.equal(recentRequest.params.branchName, undefined);
  assert.deepEqual(result.map((pipeline) => pipeline.buildId), [504, 501]);
  assert.deepEqual(result[0].matchedBy, ["source-version"]);
  assert.deepEqual(result[1].matchedBy, ["pull-request-id", "source-version"]);
});

test("keeps the available PR build query when the complementary query fails", async () => {
  const result = await loadPullRequestPipelines({
    pr: {
      repository: { id: REPOSITORY_ID, name: "example-repo" },
    },
    repository: "example-repo",
    pullRequestId: 42,
    get: async (_endpoint, params) => {
      if (!params.branchName) throw new Error("synthetic recent query failure");
      return {
        value: [{
          id: 505,
          definition: { id: 50, name: "PR fallback validation" },
          repository: { id: REPOSITORY_ID, name: "example-repo" },
          sourceBranch: "refs/pull/42/merge",
          queueTime: "2026-08-03T16:00:00Z",
          status: "completed",
          result: "succeeded",
        }],
      };
    },
  });

  assert.deepEqual(result.map((pipeline) => pipeline.buildId), [505]);
});

test("create PR dry-run exposes normalized work item links without network mutation", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network must not be called in dry-run");
  };
  try {
    const result = await toolCreatePR({
      source_branch: "feature/exemplo",
      target_branch: "develop",
      titulo: "corrige vinculos dos itens relacionados",
      resumo: "corrige de forma segura os vinculos dos itens relacionados",
      work_item_ids: [301, "302", 301],
      dry_run: true,
    });

    assert.equal(result.willMutate, false);
    assert.deepEqual(result.mutationPlan.changes.workItemIds, [301, 302]);
    assert.match(result.blockReasons.join("\n"), /dry_run/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
