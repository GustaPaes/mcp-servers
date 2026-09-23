import { z } from "zod";
import { TFS_URL, getConfiguredCollections, getTfsScope } from "../config.js";
import { tfsGetPage } from "../tfs-client.js";

const ListArgs = z.strictObject({
  top: z.number().int().min(1).max(100).default(100),
  cursor: z.string().max(512).optional(),
});

function items(page) {
  return Array.isArray(page.data?.value) ? page.data.value : [];
}

export async function toolListCollections(args) {
  const { top, cursor } = ListArgs.parse(args);
  if (cursor?.startsWith("local:")) return configuredCollectionsPage(top, cursor);
  try {
    const page = await tfsGetPage("/projectCollections", {
      "$top": top,
      ...(cursor ? { continuationToken: cursor } : {}),
    }, { baseUrl: `${TFS_URL}/_apis` });
    return {
      collections: items(page).map(({ id, name, url }) => ({ id, name, url })),
      nextCursor: page.continuationToken || page.data?.continuationToken || null,
      source: "discovery",
      complete: !(page.continuationToken || page.data?.continuationToken),
    };
  } catch (error) {
    if (![403, 404, 501].includes(error.status)) throw error;
    return configuredCollectionsPage(top);
  }
}

function configuredCollectionsPage(top, cursor = "local:0") {
  const configured = getConfiguredCollections().filter((name) => name !== "ExampleCollection");
  if (!configured.length) throw new Error("Descoberta de collections indisponível. Configure collections em local-private/config/tfs.json.");
  const offset = Number(cursor.slice("local:".length));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Cursor local inválido.");
  return {
    collections: configured.slice(offset, offset + top).map((name) => ({ name })),
    nextCursor: offset + top < configured.length ? `local:${offset + top}` : null,
    source: "local-config",
    complete: false,
    warnings: ["A descoberta não está disponível para este PAT/servidor. A lista local não comprova todas as collections visíveis."],
  };
}

export async function toolListProjects(args) {
  const { top, cursor } = ListArgs.parse(args);
  const { collection } = getTfsScope({ requireProject: false });
  const page = await tfsGetPage("/projects", {
    "$top": top,
    ...(cursor ? { continuationToken: cursor } : {}),
  }, { baseUrl: `${TFS_URL}/${encodeURIComponent(collection)}/_apis` });
  return {
    collection,
    projects: items(page).map(({ id, name, url, state }) => ({ id, name, url, state })),
    nextCursor: page.continuationToken || page.data?.continuationToken || null,
  };
}
