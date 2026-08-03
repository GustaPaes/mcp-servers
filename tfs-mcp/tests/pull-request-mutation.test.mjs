import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const auditPath = path.join(os.tmpdir(), `tfs-mcp-pr-audit-${process.pid}.jsonl`);
fs.rmSync(auditPath, { force: true });
process.env.TFS_URL = "https://tfs.example.com";
process.env.TFS_COLLECTION = "ExampleCollection";
process.env.TFS_PROJECT = "ExampleProject";
process.env.TFS_REPO = "example-repo";
process.env.TFS_PAT = "synthetic-test-pat";
process.env.TFS_AUDIT_LOG_PATH = auditPath;

const { toolCreatePR, toolUpdatePR } = await import("../src/tools/pull-request.js");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("confirmed PR creation writes and audits a real work item ArtifactLink", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const request = {
      url: String(url),
      method: options.method ?? "GET",
      body: options.body ? JSON.parse(options.body) : null,
      contentType: options.headers?.["Content-Type"],
    };
    requests.push(request);

    if (request.method === "POST" && request.url.includes("/pullrequests")) {
      return jsonResponse({
        pullRequestId: 42,
        title: "corrige vinculos dos itens relacionados",
        artifactId:
          "vstfs:///Git/PullRequestId/11111111-1111-1111-1111-111111111111%2F22222222-2222-2222-2222-222222222222%2F42",
        repository: {
          id: "22222222-2222-2222-2222-222222222222",
          name: "example-repo",
          project: { id: "11111111-1111-1111-1111-111111111111" },
        },
        // The server may echo this before the relation is actually observable.
        workItemRefs: [{ id: "301" }],
      });
    }
    if (request.method === "GET" && request.url.includes("/wit/workitems/301")) {
      return jsonResponse({ id: 301, rev: 7, relations: [] });
    }
    if (request.method === "PATCH" && request.url.includes("/wit/workitems/301")) {
      return jsonResponse({ id: 301, rev: 8 });
    }
    return jsonResponse({ message: "unexpected synthetic request" }, 500);
  };

  try {
    const result = await toolCreatePR({
      source_branch: "feature/exemplo",
      target_branch: "develop",
      titulo: "corrige vinculos dos itens relacionados",
      resumo: "corrige de forma segura os vinculos dos itens relacionados",
      work_item_ids: [301, "301"],
      dry_run: false,
      confirm: true,
      reason: "validar criacao com vinculo real",
      requestedBy: "teste automatizado",
    });

    assert.equal(result.willMutate, true);
    assert.equal(result.dryRun, false);
    assert.deepEqual(result.workItemLinks, {
      status: "complete",
      requestedIds: [301],
      linkedIds: [301],
      addedIds: [301],
      alreadyLinkedIds: [],
      failed: [],
    });

    const createRequest = requests.find((request) => request.method === "POST");
    assert.equal("workItemRefs" in createRequest.body, false);
    const linkRequests = requests.filter(
      (request) => request.method === "PATCH" && request.url.includes("/wit/workitems/301")
    );
    assert.equal(linkRequests.length, 1, "ArtifactLink reconciliation must be the only writer");
    const [linkRequest] = linkRequests;
    assert.equal(linkRequest.contentType, "application/json-patch+json");
    assert.deepEqual(linkRequest.body[0], { op: "test", path: "/rev", value: 7 });
    assert.deepEqual(linkRequest.body[1], {
      op: "add",
      path: "/relations/-",
      value: {
        rel: "ArtifactLink",
        url: "vstfs:///Git/PullRequestId/11111111-1111-1111-1111-111111111111%2F22222222-2222-2222-2222-222222222222%2F42",
        attributes: { name: "Pull Request" },
      },
    });

    const auditEntries = fs
      .readFileSync(auditPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      auditEntries.map((entry) => entry.status),
      ["applying", "applied"]
    );
    assert.deepEqual(auditEntries[1].result.workItemLinks.linkedIds, [301]);
  } finally {
    globalThis.fetch = previousFetch;
    fs.rmSync(auditPath, { force: true });
  }
});

test("confirmed PR update reconciles requested work item links", async () => {
  fs.rmSync(auditPath, { force: true });
  const previousFetch = globalThis.fetch;
  const requests = [];
  const pullRequest = {
    pullRequestId: 42,
    title: "ajusta metadados dos itens relacionados",
    sourceRefName: "refs/heads/feature/exemplo",
    targetRefName: "refs/heads/develop",
    artifactId:
      "vstfs:///Git/PullRequestId/11111111-1111-1111-1111-111111111111%2F22222222-2222-2222-2222-222222222222%2F42",
    repository: {
      id: "22222222-2222-2222-2222-222222222222",
      name: "example-repo",
      project: { id: "11111111-1111-1111-1111-111111111111" },
    },
  };
  globalThis.fetch = async (url, options = {}) => {
    const request = {
      url: String(url),
      method: options.method ?? "GET",
      body: options.body ? JSON.parse(options.body) : null,
      contentType: options.headers?.["Content-Type"],
    };
    requests.push(request);

    if (request.method === "GET" && request.url.includes("/pullrequests/42")) {
      return jsonResponse(pullRequest);
    }
    if (request.method === "PATCH" && request.url.includes("/pullrequests/42")) {
      return jsonResponse({ ...pullRequest, title: request.body.title, description: request.body.description });
    }
    if (request.method === "GET" && request.url.includes("/wit/workitems/302")) {
      return jsonResponse({ id: 302, rev: 9, relations: [] });
    }
    if (request.method === "PATCH" && request.url.includes("/wit/workitems/302")) {
      return jsonResponse({ id: 302, rev: 10 });
    }
    return jsonResponse({ message: "unexpected synthetic request" }, 500);
  };

  try {
    const result = await toolUpdatePR({
      id: 42,
      repo: "example-repo",
      titulo: "ajusta metadados dos itens relacionados",
      resumo: "ajusta de forma segura os metadados dos itens relacionados",
      work_item_ids: [302],
      dry_run: false,
      confirm: true,
      reason: "validar atualizacao com vinculo real",
      requestedBy: "teste automatizado",
    });

    assert.equal(result.willMutate, true);
    assert.deepEqual(result.workItemLinks.addedIds, [302]);
    const metadataRequest = requests.find(
      (request) => request.method === "PATCH" && request.url.includes("/pullrequests/42")
    );
    assert.equal(metadataRequest.contentType, "application/json");
    assert.equal("workItemRefs" in metadataRequest.body, false);
    const linkRequest = requests.find(
      (request) => request.method === "PATCH" && request.url.includes("/wit/workitems/302")
    );
    assert.equal(linkRequest.contentType, "application/json-patch+json");
    assert.equal(linkRequest.body[1].value.rel, "ArtifactLink");

    const auditEntries = fs
      .readFileSync(auditPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      auditEntries.map((entry) => entry.status),
      ["applying", "applied"]
    );
    assert.deepEqual(auditEntries[1].result.workItemLinks.linkedIds, [302]);
  } finally {
    globalThis.fetch = previousFetch;
    fs.rmSync(auditPath, { force: true });
  }
});
