/**
 * tools/infra.js — Ferramentas de infraestrutura: wikis, pipelines, repositórios.
 */
import { z } from "zod";
import { tfsGet, tfsGetAbsoluteJson } from "../tfs-client.js";
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

function parseContainerResource(resource) {
  const data = String(resource?.data ?? "");
  const match = data.match(/^#\/(\d+)\/(.+)$/);
  if (!match) return null;
  return {
    containerId: match[1],
    rootPath: decodeURIComponent(match[2]),
  };
}

async function getBuildArtifacts(buildId, authAlias) {
  return tfsGet(`/build/builds/${buildId}/artifacts`, {}, {
    cacheKey: `build:${buildId}:artifacts`,
    cacheTtlMs: 60_000,
    authAlias,
  });
}

async function listContainerItems(containerId, rootPath, authAlias) {
  const baseUrl = `${TFS_URL}/${TFS_COLLECTION}/_apis/resources/Containers/${containerId}`;
  const url = new URL(baseUrl);
  url.searchParams.set("itemPath", rootPath);
  url.searchParams.set("isShallow", "false");
  url.searchParams.set("includeDownloadTickets", "false");
  url.searchParams.set("api-version", "7.0-preview.4");

  const data = await tfsGetAbsoluteJson(url.toString(), {
    cacheKey: `container:${containerId}:${rootPath}`,
    cacheTtlMs: 60_000,
    authAlias,
  });

  return (data?.value ?? data?.items ?? [])
    .filter((item) => item?.itemType !== "folder")
    .map((item) => ({
      path: String(item.path ?? item.itemPath ?? ""),
      contentLength: Number(item.contentLength ?? item.fileLength ?? 0),
      lastModified: item.dateLastModified ?? item.lastModified ?? null,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeArtifactPath(path, rootPath) {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  const root = `/${String(rootPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "")}`;
  return normalized.startsWith(root) ? normalized.slice(root.length).replace(/^\//, "") : normalized.replace(/^\//, "");
}

function summarizeInventory(files, rootPath) {
  const normalizedFiles = files.map((file) => ({
    ...file,
    relativePath: normalizeArtifactPath(file.path, rootPath),
  }));
  return {
    totalFiles: normalizedFiles.length,
    totalBytes: normalizedFiles.reduce((sum, file) => sum + (file.contentLength || 0), 0),
    files: normalizedFiles,
  };
}

export async function toolBuildArtifactInventory(args) {
  const { build_id, artifact_name } = z
    .object({
      build_id: z.union([z.number(), z.string()]),
      artifact_name: z.string().optional(),
    })
    .parse(args);

  const authAlias = args?.auth_alias;
  const buildId = Number(build_id);
  const artifactsData = await getBuildArtifacts(buildId, authAlias);
  const artifacts = artifactsData.value ?? [];
  const selected = artifact_name
    ? artifacts.filter((artifact) => artifact.name?.toLowerCase() === artifact_name.toLowerCase())
    : artifacts;

  const inventories = [];
  for (const artifact of selected) {
    const parsed = parseContainerResource(artifact.resource);
    if (!parsed) {
      inventories.push({
        name: artifact.name,
        type: artifact.resource?.type ?? null,
        inventorySupported: false,
      });
      continue;
    }
    const files = await listContainerItems(parsed.containerId, parsed.rootPath, authAlias);
    inventories.push({
      name: artifact.name,
      type: artifact.resource?.type ?? null,
      containerId: parsed.containerId,
      rootPath: parsed.rootPath,
      downloadUrl: artifact.resource?.downloadUrl ?? null,
      inventorySupported: true,
      ...summarizeInventory(files, parsed.rootPath),
    });
  }

  return {
    buildId,
    artifactCount: artifacts.length,
    artifacts: inventories,
  };
}

export async function toolCompareBuildArtifacts(args) {
  const { old_build_id, new_build_id, artifact_name } = z
    .object({
      old_build_id: z.union([z.number(), z.string()]),
      new_build_id: z.union([z.number(), z.string()]),
      artifact_name: z.string().optional(),
    })
    .parse(args);

  const authAlias = args?.auth_alias;
  const [oldInv, newInv] = await Promise.all([
    toolBuildArtifactInventory({ build_id: old_build_id, artifact_name, auth_alias: authAlias }),
    toolBuildArtifactInventory({ build_id: new_build_id, artifact_name, auth_alias: authAlias }),
  ]);

  const oldArtifacts = new Map((oldInv.artifacts ?? []).map((artifact) => [artifact.name, artifact]));
  const newArtifacts = new Map((newInv.artifacts ?? []).map((artifact) => [artifact.name, artifact]));
  const artifactNames = [...new Set([...oldArtifacts.keys(), ...newArtifacts.keys()])].sort();

  const artifacts = artifactNames.map((name) => {
    const before = oldArtifacts.get(name) ?? null;
    const after = newArtifacts.get(name) ?? null;
    const beforeFiles = new Set((before?.files ?? []).map((file) => file.relativePath));
    const afterFiles = new Set((after?.files ?? []).map((file) => file.relativePath));
    const addedFiles = [...afterFiles].filter((file) => !beforeFiles.has(file)).sort();
    const removedFiles = [...beforeFiles].filter((file) => !afterFiles.has(file)).sort();
    return {
      name,
      oldTotalFiles: before?.totalFiles ?? 0,
      newTotalFiles: after?.totalFiles ?? 0,
      oldTotalBytes: before?.totalBytes ?? 0,
      newTotalBytes: after?.totalBytes ?? 0,
      addedFiles,
      removedFiles,
    };
  });

  return {
    oldBuildId: Number(old_build_id),
    newBuildId: Number(new_build_id),
    artifactName: artifact_name ?? null,
    artifacts,
  };
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
