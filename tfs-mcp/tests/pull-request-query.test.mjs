import assert from "node:assert/strict";
import test from "node:test";

process.env.TFS_URL = "https://tfs.example.com";
process.env.TFS_COLLECTION = "ExampleCollection";
process.env.TFS_PROJECT = "ExampleProject";
process.env.TFS_REPO = "example-repo";
process.env.TFS_PAT = "synthetic-test-pat";

const { toolListPRs } = await import("../src/tools/pull-request.js");
const creator = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

test("author queries exclude reviewed-only PRs and explicitly include completed/abandoned PRs for all", async () => {
  const originalFetch = globalThis.fetch;
  const fixture = [
    { pullRequestId: 41, status: "completed", createdBy: { id: creator, displayName: "Example author" }, reviewers: [] },
    { pullRequestId: 42, status: "active", createdBy: { id: other, displayName: "Other author" }, reviewers: [{ id: creator }] },
    { pullRequestId: 43, status: "abandoned", createdBy: { id: creator, displayName: "Example author" }, reviewers: [] },
  ];
  const requests = [];
  globalThis.fetch = async input => {
    const url = new URL(input);
    requests.push(url);
    const status = url.searchParams.get("searchCriteria.status") ?? "active";
    const author = url.searchParams.get("searchCriteria.creatorId");
    const reviewer = url.searchParams.get("searchCriteria.reviewerId");
    const skip = Number(url.searchParams.get("$skip") ?? 0);
    const top = Number(url.searchParams.get("$top") ?? 10);
    const value = fixture.filter(pr => (status === "all" || pr.status === status) && (!author || pr.createdBy.id === author) && (!reviewer || pr.reviewers.some(r => r.id === reviewer))).slice(skip, skip + top);
    return Response.json({ value });
  };
  try {
    const all = await toolListPRs({ repo: "example-repo", status: "all", created_by: creator });
    assert.deepEqual(all.map(pr => pr.id).sort((a,b)=>a-b), [41, 43]);
    assert.equal(requests[0].searchParams.get("searchCriteria.creatorId"), creator);
    assert.equal(requests[0].searchParams.has("searchCriteria.reviewerId"), false);
    const completed = await toolListPRs({ repo: "example-repo", status: "completed", created_by: creator });
    assert.deepEqual(completed.map(pr => pr.id), [41]);
    const unfiltered = await toolListPRs({ repo: "example-repo", status: "all" });
    assert.deepEqual(unfiltered.map(pr => pr.id).sort((a,b)=>a-b), [41, 42, 43]);
    const page = await toolListPRs({ repo: "example-repo", status: "all", created_by: creator, top: 1, skip: 1 });
    assert.deepEqual(page.map(pr=>pr.id), [43]);
    await assert.rejects(() => toolListPRs({ status: "all", skip: 1 }), /Informe repo/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
