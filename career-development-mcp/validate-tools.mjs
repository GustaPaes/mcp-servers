import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["index.js"],
  cwd: process.cwd(),
  stderr: "pipe",
  env: { ...process.env },
});

if (transport.stderr) {
  transport.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
}

const client = new Client({ name: "career-development-mcp-validator", version: "1.0.0" }, { capabilities: {} });

async function main() {
  await client.connect(transport);

  const tools = await client.listTools();
  const requiredTools = [
    "guide_pdi_get",
    "guide_pdi_analyze",
    "guide_goal_progress",
    "guide_career_readiness",
    "guide_review_prepare",
  ];

  const available = new Set(tools.tools.map((tool) => tool.name));
  for (const toolName of requiredTools) {
    if (!available.has(toolName)) throw new Error(`Tool obrigatoria ausente: ${toolName}`);
  }

  const pdis = await client.callTool({ name: "guide_pdi_list", arguments: {} });
  const firstPdi = pdis.structuredContent?.items?.[0] ?? pdis.structuredContent?.[0];
  if (!firstPdi?.id) throw new Error("Nenhum PDI inicial encontrado para validacao.");

  const pdiDetail = await client.callTool({ name: "guide_pdi_get", arguments: { id: firstPdi.id } });
  const pdiAnalysis = await client.callTool({ name: "guide_pdi_analyze", arguments: { id: firstPdi.id } });
  const goalList = await client.callTool({ name: "guide_goal_list", arguments: { pdiId: firstPdi.id } });
  const firstGoal = goalList.structuredContent?.items?.[0] ?? goalList.structuredContent?.[0];
  const goalProgress = firstGoal?.id
    ? await client.callTool({ name: "guide_goal_progress", arguments: { id: firstGoal.id } })
    : null;
  const readiness = await client.callTool({ name: "guide_career_readiness", arguments: {} });
  const review = await client.callTool({ name: "guide_review_prepare", arguments: {} });

  console.log(JSON.stringify({
    toolCount: tools.tools.length,
    sampledPdi: firstPdi.id,
    hasPdiStructured: Boolean(pdiDetail.structuredContent),
    hasAnalysisStructured: Boolean(pdiAnalysis.structuredContent),
    hasGoalStructured: Boolean(goalProgress?.structuredContent),
    hasReadinessStructured: Boolean(readiness.structuredContent),
    hasReviewStructured: Boolean(review.structuredContent),
  }, null, 2));

  await client.close();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  try {
    await client.close();
  } catch {}
  process.exitCode = 1;
});
