import { buildSpecialistReview } from "../specialists.js";
import { tfsGet } from "../tfs-client.js";

function normalizeBuildToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

function extractBuildPullRequestIds(build) {
  const ids = new Set();
  const branchMatch = String(build?.sourceBranch ?? "").match(/^refs\/pull\/(\d+)(?:\/|$)/i);
  if (branchMatch) ids.add(Number(branchMatch[1]));

  const supportedTriggerKeys = new Set([
    "prnumber",
    "prid",
    "pullrequestid",
    "systempullrequestid",
    "systempullrequestpullrequestid",
  ]);
  for (const [key, value] of Object.entries(build?.triggerInfo ?? {})) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!supportedTriggerKeys.has(normalizedKey)) continue;
    const id = Number(value);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

function pullRequestBuildIdentity(pr, repository, pullRequestId) {
  return {
    pullRequestId: Number(pullRequestId),
    repositoryId: pr?.repository?.id ?? null,
    repositoryName: pr?.repository?.name ?? repository ?? null,
    commitIds: [
      pr?.lastMergeCommit?.commitId,
      pr?.lastMergeSourceCommit?.commitId,
      ...(pr?.commits ?? []).map((commit) => commit?.commitId),
    ].filter(Boolean),
  };
}

/**
 * A build belongs to a PR only when the repository matches and the build has
 * direct PR identity (trigger/source ref) or one of the PR's source/merge SHAs.
 * Target branch equality is intentionally not considered evidence.
 */
export function classifyPullRequestBuild(build, identity) {
  const expectedRepositoryTokens = new Set(
    [identity?.repositoryId, identity?.repositoryName]
      .map(normalizeBuildToken)
      .filter(Boolean)
  );
  const actualRepositoryTokens = new Set(
    [build?.repository?.id, build?.repository?.name]
      .map(normalizeBuildToken)
      .filter(Boolean)
  );
  const repositoryMatched =
    expectedRepositoryTokens.size > 0 &&
    [...expectedRepositoryTokens].some((token) => actualRepositoryTokens.has(token));

  const buildPullRequestIds = extractBuildPullRequestIds(build);
  const pullRequestId = Number(identity?.pullRequestId);
  const pullRequestMatched =
    Number.isSafeInteger(pullRequestId) && buildPullRequestIds.has(pullRequestId);

  const expectedCommitIds = new Set(
    (identity?.commitIds ?? []).map(normalizeBuildToken).filter(Boolean)
  );
  const sourceVersion = normalizeBuildToken(build?.sourceVersion);
  const sourceVersionMatched = Boolean(
    sourceVersion && expectedCommitIds.has(sourceVersion)
  );
  const matchedBy = [
    ...(pullRequestMatched ? ["pull-request-id"] : []),
    ...(sourceVersionMatched ? ["source-version"] : []),
  ];

  return {
    matches: repositoryMatched && matchedBy.length > 0,
    repositoryMatched,
    pullRequestMatched,
    sourceVersionMatched,
    matchedBy,
  };
}

function buildTime(build) {
  return new Date(
    build?.queueTime ?? build?.startTime ?? build?.finishTime ?? 0
  ).getTime();
}

export async function loadPullRequestPipelines({
  pr,
  repository,
  pullRequestId,
  top = 3,
  get = tfsGet,
}) {
  const identity = pullRequestBuildIdentity(pr, repository, pullRequestId);
  const repositoryFilter = identity.repositoryId ?? identity.repositoryName;
  if (!repositoryFilter || !Number.isSafeInteger(identity.pullRequestId)) return [];

  const commonQuery = {
    "$top": 100,
    repositoryId: repositoryFilter,
    repositoryType: "TfsGit",
    queryOrder: "queueTimeDescending",
  };
  const queries = await Promise.allSettled([
    get("/build/builds", {
      ...commonQuery,
      reasonFilter: "pullRequest",
      // This is the synthetic ref for this PR, not its shared target branch.
      branchName: `refs/pull/${identity.pullRequestId}/merge`,
    }),
    // A bounded repository window covers providers/reruns that expose the PR
    // only through triggerInfo or a source/merge SHA instead of the merge ref.
    get("/build/builds", commonQuery),
  ]);
  const successfulQueries = queries.filter((query) => query.status === "fulfilled");
  if (!successfulQueries.length) throw queries[0].reason;

  const buildsById = new Map();
  for (const query of successfulQueries) {
    for (const build of query.value.value ?? []) {
      const key = build?.id == null
        ? `unknown:${buildsById.size}`
        : String(build.id);
      if (!buildsById.has(key)) buildsById.set(key, build);
    }
  }

  const matchingBuilds = [...buildsById.values()]
    .map((build) => ({
      build,
      match: classifyPullRequestBuild(build, identity),
    }))
    .filter((entry) => entry.match.matches)
    .sort((left, right) => buildTime(right.build) - buildTime(left.build));

  const byDefinition = new Map();
  for (const entry of matchingBuilds) {
    const definitionKey = entry.build.definition?.id ?? `build:${entry.build.id}`;
    if (!byDefinition.has(definitionKey)) byDefinition.set(definitionKey, []);
    byDefinition.get(definitionKey).push(entry);
  }

  return [...byDefinition.values()].slice(0, top).map((entries) => {
    const { build: latest, match } = entries[0];
    const history = entries.slice(0, 3).map((entry) => entry.build);
    const successRate = history.length
      ? Math.round(
          (history.filter((build) => build.result === "succeeded").length /
            history.length) *
            100
        )
      : null;
    const pipelineName = latest.definition?.name ?? "unknown";
    return {
      buildId: latest.id,
      id: latest.definition?.id ?? null,
      name: pipelineName,
      branch: latest.sourceBranch?.replace(/^refs\/heads\//, "") ?? null,
      sourceVersion: latest.sourceVersion ?? null,
      status: latest.status,
      result: latest.result,
      startTime: latest.startTime,
      finishTime: latest.finishTime,
      requestedBy: latest.requestedBy?.displayName,
      url: latest._links?.web?.href,
      successRate,
      matchedBy: match.matchedBy,
      specialistReview: buildSpecialistReview({
        title: pipelineName,
        description: `Pipeline ${pipelineName} associada ao PR ${pullRequestId}`,
        affectedLocations: [
          pipelineName,
          identity.repositoryName,
          latest.sourceBranch,
          latest.sourceVersion,
        ].filter(Boolean),
        focus: ["pipeline", "pull-request"],
      }),
    };
  });
}
