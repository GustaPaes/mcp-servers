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

function buildWikiPageUrl(wiki, path) {
  const wikiRef = wiki.name ?? wiki.id;
  return `${TFS_URL}/${TFS_COLLECTION}/${TFS_PROJECT}/_wiki/wikis/${encodeURIComponent(wikiRef)}?pagePath=${encodeURIComponent(path ?? "/")}`;
}

function normalizeWikiText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseWikiPageUrl(value) {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const wikiIndex = segments.findIndex((segment) => segment.toLowerCase() === "wikis");
    if (wikiIndex < 0 || !segments[wikiIndex + 1]) return null;
    const wiki = segments[wikiIndex + 1];
    const pagePath = url.searchParams.get("pagePath");
    const slugStart = /^\d+$/.test(segments[wikiIndex + 2] ?? "") ? wikiIndex + 3 : wikiIndex + 2;
    const slug = segments.slice(slugStart).join("/");
    const pageId = /^\d+$/.test(segments[wikiIndex + 2] ?? "") ? Number(segments[wikiIndex + 2]) : null;
    return { wiki, pageId, pagePath, slug };
  } catch {
    return null;
  }
}

function formatWikiPage(wiki, page, includeContent = false) {
  const result = {
    id: page.id ?? null,
    wikiId: wiki.id,
    wikiName: wiki.name,
    path: page.path ?? "/",
    order: page.order ?? null,
    url: buildWikiPageUrl(wiki, page.path),
    remoteUrl: page.remoteUrl ?? null,
  };
  if (includeContent) result.content = page.content ?? "";
  return result;
}

async function selectWikis(wikiSelector) {
  const wikisData = await getWikis();
  const wikis = wikisData.value ?? [];
  if (!wikiSelector?.trim()) return wikis;
  const normalized = wikiSelector.trim().toLowerCase();
  const selected = wikis.filter(
    (wiki) => String(wiki.id).toLowerCase() === normalized || String(wiki.name).toLowerCase() === normalized
  );
  if (!selected.length) throw new Error(`Wiki '${wikiSelector}' nao encontrada.`);
  return selected;
}

async function loadWikiPages({ wikiSelector, path = "/", skip = 0, top = 100, includeContent = false }) {
  const wikis = await selectWikis(wikiSelector);
  const settled = await Promise.allSettled(
    wikis.map(async (wiki) => {
      const tree = await getWikiPageTree(wiki.id, path, "full", false);
      const allPages = flattenWikiPages(tree).filter((page) => page.path);
      return { wiki, allPages };
    })
  );

  const successful = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const failedWikis = settled
    .map((result, index) => result.status === "rejected" ? { id: wikis[index].id, name: wikis[index].name } : null)
    .filter(Boolean);
  const allPages = successful.flatMap(({ wiki, allPages: pages }) => pages.map((page) => ({ wiki, page })));
  const selectedPages = allPages.slice(skip, skip + top);
  let pages = selectedPages.map(({ wiki, page }) => formatWikiPage(wiki, page, false));

  if (includeContent) {
    const contentResults = await Promise.allSettled(
      selectedPages.map(({ wiki, page }) => getWikiPageTree(wiki.id, page.path, "none", true))
    );
    pages = contentResults.map((result, index) => {
      const selected = selectedPages[index];
      return result.status === "fulfilled"
        ? formatWikiPage(selected.wiki, result.value, true)
        : { ...formatWikiPage(selected.wiki, selected.page, false), contentUnavailable: true };
    });
  }

  return {
    wikiCount: successful.length,
    failedWikis,
    totalPages: allPages.length,
    pages,
  };
}

async function readWikiPage(path, wikiSelector) {
  const wikis = await selectWikis(wikiSelector);
  const settled = await Promise.allSettled(
    wikis.map(async (wiki) => formatWikiPage(wiki, await getWikiPageTree(wiki.id, path, "none", true), true))
  );
  const pages = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (!pages.length) throw new Error(`Pagina de Wiki '${path}' nao encontrada.`);
  return pages;
}

async function resolveAndReadWikiPage({ path, url, wiki }) {
  const reference = url ? parseWikiPageUrl(url) : null;
  const wikiSelector = wiki ?? reference?.wiki;
  if (reference?.pageId) {
    const wikis = await selectWikis(wikiSelector);
    const settled = await Promise.allSettled(
      wikis.map(async (selectedWiki) => {
        const page = await tfsGet(
          `/wiki/wikis/${selectedWiki.id}/pages/${reference.pageId}`,
          { includeContent: "true" },
          { cacheKey: `wiki:page-id:${selectedWiki.id}:${reference.pageId}`, cacheTtlMs: 5 * 60_000 }
        );
        return formatWikiPage(selectedWiki, page, true);
      })
    );
    const pages = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
    if (pages.length) return pages;
  }
  const exactPath = path ?? reference?.pagePath;
  if (exactPath?.startsWith("/")) {
    try {
      return await readWikiPage(exactPath, wikiSelector);
    } catch {
      // Fall back to recursive normalized search for web URLs/slugs whose page
      // path is not exposed directly by the browser URL.
    }
  }

  const search = reference?.slug ?? exactPath;
  if (!search?.trim()) throw new Error("Informe path ou url para ler a pagina de Wiki.");
  const matches = await findWikiMatchesDeep(search, 20, wikiSelector);
  if (!matches.length) throw new Error(`Pagina de Wiki '${search}' nao encontrada.`);
  const normalizedSearch = normalizeWikiText(search);
  const preferred = matches.find((match) => normalizeWikiText(match.path).endsWith(normalizedSearch)) ?? matches[0];
  return readWikiPage(preferred.path, preferred.wikiId);
}

export async function getWikiPageWithChildren(path, top = 50) {
  const result = await loadWikiPages({ path, top, includeContent: false });
  return result.pages;
}

export async function findWikiMatches(search, top = 10) {
  return findWikiMatchesDeep(search, top);
}

export async function findWikiMatchesDeep(search, top = 20, wikiSelector, skip = 0) {
  if (!search?.trim()) return [];
  const wikis = await selectWikis(wikiSelector);

  if (!wikis.length) return [];

  const results = await Promise.all(
    wikis.map(async (wiki) => {
      const data = await getWikiPageTree(wiki.id, "/", "full", false);
      return flattenWikiPages(data)
        .filter((p) => normalizeWikiText(p.path).includes(normalizeWikiText(search)))
        .map((p) => ({
          ...formatWikiPage(wiki, p, false),
          title: p.path ?? "/",
        }));
    })
  );

  return results
    .flat()
    .slice(skip, skip + top);
}

export async function toolWiki(args) {
  const parsed = z
    .object({
      action: z.enum(["list", "search", "read", "tree"]).optional(),
      search: z.string().min(1).optional(),
      wiki: z.string().min(1).optional(),
      path: z.string().min(1).optional(),
      url: z.string().url().optional(),
      include_content: z.boolean().optional(),
      skip: z.number().int().min(0).default(0),
      top: z.number().int().min(1).max(1000).default(50),
    })
    .superRefine((value, context) => {
      const action = value.action ?? (value.path || value.url ? "read" : value.search ? "search" : "list");
      if (action === "search" && !value.search) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["search"], message: "search e obrigatorio para action=search" });
      }
      if (action === "read" && !value.path && !value.url) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["path"], message: "path ou url e obrigatorio para action=read" });
      }
      if (value.include_content && value.top > 200) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["top"], message: "top deve ser no maximo 200 quando include_content=true" });
      }
    })
    .parse(args);

  const action = parsed.action ?? (parsed.path || parsed.url ? "read" : parsed.search ? "search" : "list");
  if (action === "list") {
    const wikis = await selectWikis(parsed.wiki);
    return wikis.map((wiki) => ({
      id: wiki.id,
      name: wiki.name,
      type: wiki.type ?? null,
      repositoryId: wiki.repositoryId ?? null,
      mappedPath: wiki.mappedPath ?? null,
      url: buildWikiPageUrl(wiki, "/"),
    }));
  }
  if (action === "read") return resolveAndReadWikiPage({ path: parsed.path, url: parsed.url, wiki: parsed.wiki });
  if (action === "tree") {
    const result = await loadWikiPages({
      wikiSelector: parsed.wiki,
      path: parsed.path ?? "/",
      skip: parsed.skip,
      top: parsed.top,
      includeContent: parsed.include_content ?? false,
    });
    return {
      rootPath: parsed.path ?? "/",
      skip: parsed.skip,
      includeContent: parsed.include_content ?? false,
      totalPages: result.totalPages,
      returnedPages: result.pages.length,
      truncated: parsed.skip + result.pages.length < result.totalPages,
      partial: result.failedWikis.length > 0,
      failedWikis: result.failedWikis,
      pages: result.pages,
    };
  }

  const matches = await findWikiMatchesDeep(parsed.search, parsed.top, parsed.wiki, parsed.skip);
  if (!(parsed.include_content ?? false)) return matches;
  const withContent = await Promise.allSettled(
    matches.map(async (match) => (await readWikiPage(match.path, match.wikiId))[0])
  );
  return withContent
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
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
