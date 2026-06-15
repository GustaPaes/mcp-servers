/**
 * tools/infra.js — Ferramentas de infraestrutura: wikis, pipelines, repositórios.
 */
import { z } from "zod";
import { tfsGet } from "../tfs-client.js";
import { TFS_COLLECTION, TFS_PROJECT, TFS_URL } from "../config.js";
import { buildSpecialistReview } from "../specialists.js";

// ─── Wiki ──────────────────────────────────────────────────────────────────

async function getWikis() {
  return tfsGet("/wiki/wikis", {}, { cacheKey: "wikis:list", cacheTtlMs: 5 * 60_000 });
}

export async function getWikiPageTree(wikiId, path = "/", recursionLevel = "full", includeContent = false) {
  return tfsGet(
    `/wiki/wikis/${wikiId}/pages`,
    {
      path,
      recursionLevel,
      includeContent: includeContent ? "true" : "false",
    },
    { cacheKey: `wiki:tree:${wikiId}:${path}:${recursionLevel}:${includeContent}`, cacheTtlMs: 5 * 60_000 }
  );
}

function flattenWikiPages(page, bucket = []) {
  if (!page) return bucket;
  bucket.push(page);
  for (const child of page.subPages ?? []) flattenWikiPages(child, bucket);
  return bucket;
}

export async function getWikiPageWithChildren(path, top = 50) {
  const wikisData = await getWikis().catch(() => ({ value: [] }));
  const wikis = wikisData.value ?? [];
  if (!wikis.length) return [];

  const settled = await Promise.allSettled(
    wikis.map(async (wiki) => {
      const tree = await getWikiPageTree(wiki.id, path, "full", false);
      const pages = flattenWikiPages(tree)
        .filter((page) => page.path)
        .slice(0, top)
        .map((page) => ({
          wikiId: wiki.id,
          wikiName: wiki.name,
          path: page.path,
          order: page.order,
          url: `${TFS_URL}/${TFS_COLLECTION}/${TFS_PROJECT}/_wiki/wikis/${wiki.id}?pagePath=${encodeURIComponent(page.path ?? "/")}`,
          remoteUrl: page.remoteUrl ?? null,
        }));
      return pages;
    })
  );

  return settled
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);
}

export async function findWikiMatches(search, top = 10) {
  if (!search?.trim()) return [];
  const wikisData = await getWikis().catch(() => ({ value: [] }));
  const wikis = wikisData.value ?? [];

  if (!wikis.length) return [];

  const results = await Promise.allSettled(
    wikis.slice(0, 3).map(async (wiki) => {
      const data = await tfsGet(
        "/wiki/wikis/" + wiki.id + "/pages",
        {
          path: "/",
          recursionLevel: "oneLevel",
          includeContent: "false",
        },
        { cacheKey: `wiki:pages:${wiki.id}`, cacheTtlMs: 5 * 60_000 }
      );
      return (data.value ?? data.subPages ?? []).filter((p) =>
        p.path?.toLowerCase().includes(search.toLowerCase())
      ).map((p) => ({
        title: p.path ?? "/",
        wikiName: wiki.name,
        url: `${TFS_URL}/${TFS_COLLECTION}/${TFS_PROJECT}/_wiki/wikis/${wiki.id}?pagePath=${encodeURIComponent(p.path ?? "/")}`,
        remoteUrl: p.remoteUrl ?? null,
      }));
    })
  );

  return results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value)
    .slice(0, top);
}

export async function findWikiMatchesDeep(search, top = 20) {
  if (!search?.trim()) return [];
  const wikisData = await getWikis().catch(() => ({ value: [] }));
  const wikis = wikisData.value ?? [];

  if (!wikis.length) return [];

  const results = await Promise.allSettled(
    wikis.slice(0, 5).map(async (wiki) => {
      const data = await getWikiPageTree(wiki.id, "/", "full", false);
      return flattenWikiPages(data)
        .filter((p) => p.path?.toLowerCase().includes(search.toLowerCase()))
        .map((p) => ({
          title: p.path ?? "/",
          path: p.path ?? "/",
          wikiName: wiki.name,
          url: `${TFS_URL}/${TFS_COLLECTION}/${TFS_PROJECT}/_wiki/wikis/${wiki.id}?pagePath=${encodeURIComponent(p.path ?? "/")}`,
          remoteUrl: p.remoteUrl ?? null,
        }));
    })
  );

  return results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value)
    .slice(0, top);
}

export async function toolWiki(args) {
  const { search, top = 10 } = z
    .object({ search: z.string().min(1), top: z.number().int().min(1).max(50).default(10) })
    .parse(args);
  return findWikiMatches(search, top);
}

// ─── Pipelines ─────────────────────────────────────────────────────────────

export async function toolPipelineStatus(args) {
  const {
    name,
    branch = "master",
    top = 3,
  } = z
    .object({
      name: z.string().optional(),
      branch: z.string().default("master"),
      top: z.number().int().min(1).max(10).default(3),
    })
    .parse(args);

  const buildsData = await tfsGet("/build/builds", {
    "$top": 50,
    branchName: `refs/heads/${branch}`,
  });

  const allBuilds = buildsData.value ?? [];
  const builds = name
    ? allBuilds.filter((b) =>
        b.definition?.name?.toLowerCase().includes(name.toLowerCase())
      )
    : allBuilds;

  // Group by definition, pick latest per def
  const defsMap = new Map();
  for (const b of builds) {
    const defId = b.definition?.id;
    if (!defId) continue;
    if (!defsMap.has(defId)) defsMap.set(defId, []);
    defsMap.get(defId).push(b);
  }

  return [...defsMap.values()].slice(0, top).map((defBuilds) => {
    const latest = defBuilds[0];
    const history = defBuilds.slice(0, 3);
    const successRate =
      history.length > 0
        ? Math.round(
            (history.filter((b) => b.result === "succeeded").length / history.length) * 100
          )
        : null;
    const pipelineName = latest.definition?.name ?? "unknown";
    return {
      id: latest.definition?.id,
      name: pipelineName,
      branch: latest.sourceBranch?.replace("refs/heads/", "") ?? branch,
      status: latest.status,
      result: latest.result,
      startTime: latest.startTime,
      finishTime: latest.finishTime,
      requestedBy: latest.requestedBy?.displayName,
      url: latest._links?.web?.href,
      successRate,
      specialistReview: buildSpecialistReview({
        title: pipelineName,
        description: `Pipeline ${pipelineName} branch ${branch}`,
        affectedLocations: [pipelineName, branch, latest.sourceBranch].filter(Boolean),
        focus: ["pipeline", "release"],
      }),
    };
  });
}

// ─── Repos ─────────────────────────────────────────────────────────────────

export async function toolListRepos(args) {
  z.object({}).parse(args ?? {});
  const data = await tfsGet("/git/repositories", {}, { cacheKey: "repos:list", cacheTtlMs: 2 * 60_000 });
  return (data.value ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    defaultBranch: r.defaultBranch?.replace("refs/heads/", "") ?? "master",
    url: r.remoteUrl ?? r.sshUrl,
    webUrl: r._links?.web?.href,
  }));
}
