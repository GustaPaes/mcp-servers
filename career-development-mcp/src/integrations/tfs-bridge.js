import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TFS_MCP_SERVER_DIR } from "../config.js";

function normalizeWorkItemId(value) {
  const text = String(value ?? "").trim();
  const directMatch = text.match(/(\d+)/);
  return directMatch ? Number(directMatch[1]) : null;
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
    await client.connect(transport);
    return await run(client);
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
    const prs = context.pullRequests ?? context.linkedPullRequests ?? [];

    return {
      workItemId: String(workItem.id ?? id),
      title: workItem.title ?? `Work item ${id}`,
      state: workItem.state ?? "",
      prIds: prs.map((pr) => String(pr.id)),
      summary: [
        `Work item ${workItem.id ?? id}: ${workItem.title ?? "Sem titulo"}`,
        prs.length ? `${prs.length} PR(s) vinculados` : "Sem PRs vinculados encontrados",
      ].join(" | "),
      raw: context,
    };
  });
}
