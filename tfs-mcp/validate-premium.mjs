import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const cwd = process.cwd();
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["index.js"],
  cwd,
  stderr: "pipe",
  env: { ...process.env },
});

if (transport.stderr) {
  transport.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
}

const client = new Client(
  { name: "tfs-mcp-validator", version: "1.0.0" },
  { capabilities: {} }
);

async function main() {
  await client.connect(transport);

  const tools = await client.listTools();
  const premiumNames = [
    "tfs_prepare_pr_review",
    "tfs_release_readiness",
    "tfs_team_focus_report",
    "tfs_work_item_handoff",
    "tfs_delivery_risk_report",
  ];

  const premium = tools.tools.filter((tool) => premiumNames.includes(tool.name));
  const summary = premium.map((tool) => ({
    name: tool.name,
    hasOutputSchema: Boolean(tool.outputSchema),
    hasAnnotations: Boolean(tool.annotations),
  }));

  const workItems = await client.callTool({
    name: "tfs_query_work_items",
    arguments: { top: 5 },
  });

  const workItemId = workItems.structuredContent?.items?.[0]?.id
    ?? workItems.structuredContent?.[0]?.id
    ?? JSON.parse(workItems.content?.[0]?.text ?? "[]")?.[0]?.id;

  const prs = await client.callTool({
    name: "tfs_list_prs",
    arguments: { status: "active", top: 5 },
  });

  const prId = prs.structuredContent?.items?.[0]?.id
    ?? prs.structuredContent?.[0]?.id
    ?? JSON.parse(prs.content?.[0]?.text ?? "[]")?.[0]?.id;

  const executions = [];

  if (prId != null) {
    executions.push({
      name: "tfs_prepare_pr_review",
      result: await client.callTool({
        name: "tfs_prepare_pr_review",
        arguments: { id: prId, include_code_review: false, include_pipeline: false },
      }),
    });
  }

  executions.push({
    name: "tfs_release_readiness",
    result: await client.callTool({
      name: "tfs_release_readiness",
      arguments: { top: 30, include_pull_requests: false, include_pipeline: false },
    }),
  });

  executions.push({
    name: "tfs_team_focus_report",
    result: await client.callTool({
      name: "tfs_team_focus_report",
      arguments: { top: 30 },
    }),
  });

  if (workItemId != null) {
    executions.push({
      name: "tfs_work_item_handoff",
      result: await client.callTool({
        name: "tfs_work_item_handoff",
        arguments: { id: workItemId, include_related: true, include_pull_requests: true, include_wiki: false },
      }),
    });
  }

  executions.push({
    name: "tfs_delivery_risk_report",
    result: await client.callTool({
      name: "tfs_delivery_risk_report",
      arguments: { top: 30, include_pull_requests: false, include_pipeline: false },
    }),
  });

  const output = {
    premiumTools: summary,
    sampledIds: { workItemId: workItemId ?? null, prId: prId ?? null },
    executions: executions.map(({ name, result }) => ({
      name,
      hasStructuredContent: Boolean(result.structuredContent),
      textPreview: result.content?.[0]?.text?.slice(0, 220) ?? "",
      structuredKeys: result.structuredContent && typeof result.structuredContent === "object"
        ? Object.keys(result.structuredContent)
        : [],
      isError: result.isError ?? false,
    })),
  };

  console.log(JSON.stringify(output, null, 2));
  await client.close();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  try {
    await client.close();
  } catch {}
  process.exitCode = 1;
});
