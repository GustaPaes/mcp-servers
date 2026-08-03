import { normalizeWorkItemId } from "../formatters.js";
import { tfsGet, tfsJsonPatch } from "../tfs-client.js";

export function normalizePRWorkItemIds(values = []) {
  const normalized = [];
  for (const value of values ?? []) {
    const raw = typeof value === "string" ? value.trim() : value;
    if (raw === "") throw new Error("work_item_ids nao pode conter valores vazios.");
    if (typeof raw === "string" && /^\d+\.\d+$/.test(raw)) {
      throw new Error(`Work item id invalido: '${raw}'.`);
    }
    const id = normalizeWorkItemId(raw);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`Work item id invalido: '${String(value)}'.`);
    }
    if (!normalized.includes(id)) normalized.push(id);
  }
  return normalized;
}

export function buildPullRequestArtifactId(projectId, repositoryId, pullRequestId) {
  const project = String(projectId ?? "").trim();
  const repository = String(repositoryId ?? "").trim();
  const prId = Number(pullRequestId);
  if (!project || !repository || !Number.isSafeInteger(prId) || prId <= 0) {
    throw new Error(
      "Nao foi possivel construir o ArtifactLink do PR: projectId, repositoryId e pullRequestId sao obrigatorios."
    );
  }
  return `vstfs:///Git/PullRequestId/${encodeURIComponent(project)}%2F${encodeURIComponent(repository)}%2F${prId}`;
}

function canonicalArtifactId(value) {
  return String(value ?? "").trim().replace(/%2f/gi, "/").toLowerCase();
}

function hasPullRequestArtifactLink(workItem, artifactId) {
  const expected = canonicalArtifactId(artifactId);
  return (workItem?.relations ?? []).some(
    (relation) =>
      relation?.rel === "ArtifactLink" && canonicalArtifactId(relation?.url) === expected
  );
}

async function resolvePullRequestArtifactId({ pr, repository, pullRequestId, get }) {
  if (pr?.artifactId) return pr.artifactId;

  let repositoryDetails = pr?.repository ?? {};
  if (!repositoryDetails.id || !repositoryDetails.project?.id) {
    repositoryDetails = await get(
      `/git/repositories/${repositoryDetails.id ?? repository}`
    );
  }

  return buildPullRequestArtifactId(
    repositoryDetails.project?.id,
    repositoryDetails.id,
    pullRequestId
  );
}

function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 300)}...` : message;
}

/**
 * Reconciles direct PR ArtifactLinks on work items. The read-before-write and
 * revision test make retries idempotent while still reporting partial failures.
 */
export async function ensurePullRequestWorkItemLinks({
  pr,
  repository,
  pullRequestId,
  workItemIds,
  get = tfsGet,
  jsonPatch = tfsJsonPatch,
}) {
  const requestedIds = normalizePRWorkItemIds(workItemIds);
  const report = {
    status: requestedIds.length ? "complete" : "not-requested",
    requestedIds,
    linkedIds: [],
    addedIds: [],
    alreadyLinkedIds: [],
    failed: [],
  };
  if (!requestedIds.length) return report;

  let artifactId;
  try {
    artifactId = await resolvePullRequestArtifactId({
      pr,
      repository,
      pullRequestId,
      get,
    });
  } catch (error) {
    report.status = "failed";
    report.failed = requestedIds.map((id) => ({ id, error: errorMessage(error) }));
    return report;
  }

  const settled = await Promise.allSettled(
    requestedIds.map(async (id) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const workItem = await get(`/wit/workitems/${id}`, { "$expand": "Relations" });
        if (hasPullRequestArtifactLink(workItem, artifactId)) {
          return { id, disposition: "already-linked" };
        }

        const operations = [];
        if (Number.isSafeInteger(workItem?.rev)) {
          operations.push({ op: "test", path: "/rev", value: workItem.rev });
        }
        operations.push({
          op: "add",
          path: "/relations/-",
          value: {
            rel: "ArtifactLink",
            url: artifactId,
            attributes: { name: "Pull Request" },
          },
        });

        try {
          await jsonPatch("PATCH", `/wit/workitems/${id}`, operations);
          return { id, disposition: "added" };
        } catch (error) {
          if (attempt === 0 && [409, 412].includes(Number(error?.status))) continue;
          throw error;
        }
      }
      throw new Error(`Nao foi possivel vincular o work item ${id} apos uma atualizacao concorrente.`);
    })
  );

  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const id = requestedIds[index];
    if (result.status === "rejected") {
      report.failed.push({ id, error: errorMessage(result.reason) });
      continue;
    }
    report.linkedIds.push(id);
    if (result.value.disposition === "added") report.addedIds.push(id);
    else report.alreadyLinkedIds.push(id);
  }

  if (report.failed.length) {
    report.status = report.linkedIds.length ? "partial" : "failed";
  }
  return report;
}
