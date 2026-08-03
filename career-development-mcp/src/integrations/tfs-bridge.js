import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CAREER_MCP_TFS_TIMEOUT_MS, TFS_MCP_SERVER_DIR } from "../config.js";

export function normalizeWorkItemId(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,15}$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} excedeu o timeout de ${timeoutMs} ms.`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function withTfsClient(run) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["index.js"],
    cwd: path.resolve(TFS_MCP_SERVER_DIR),
    stderr: "pipe",
    env: { ...process.env },
  });
  const client = new Client({ name: "career-development-tfs-bridge", version: "1.1.0" }, { capabilities: {} });
  try {
    await withTimeout(client.connect(transport), CAREER_MCP_TFS_TIMEOUT_MS, "Conexão com tfs-mcp");
    return await withTimeout(run(client), CAREER_MCP_TFS_TIMEOUT_MS, "Importação de evidência do tfs-mcp");
  } finally {
    await client.close().catch(() => {});
  }
}

export async function importEvidenceFromWorkItem(workItemReference) {
  const id = normalizeWorkItemId(workItemReference);
  if (!id) throw new Error("Work item invalido para importacao de evidencia.");

  return withTfsClient(async (client) => {
    const result = await client.callTool({
      name: "tfs_work_item_context",
      arguments: { id, include_pull_requests: true, include_related: true, include_wiki: false },
    });
    const context = result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? "{}");
    const workItem = context.workItem ?? context.item ?? context;
    const prs = (context.pullRequests ?? context.linkedPullRequests ?? []).slice(0, 100);
    const title = String(workItem.title ?? `Work item ${id}`).slice(0, 512);

    return {
      workItemId: String(workItem.id ?? id),
      title,
      state: workItem.state ?? "",
      prIds: prs.map((pr) => String(pr.id)),
      summary: [
        `Work item ${workItem.id ?? id}: ${title || "Sem titulo"}`,
        prs.length ? `${prs.length} PR(s) vinculados` : "Sem PRs vinculados encontrados",
      ].join(" | "),
    };
  });
}
