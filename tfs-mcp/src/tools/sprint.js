/**
 * tools/sprint.js — Ferramentas de sprint: info, release readiness, team focus, delivery risk.
 */
import { z } from "zod";
import { tfsGet, tfsPost } from "../tfs-client.js";
import { TFS_PROJECT } from "../config.js";
import { formatWorkItem } from "../formatters.js";
import { buildSpecialistReview } from "../specialists.js";
import {
  buildReleaseSignals,
  isCompletedState,
  isActiveState,
  identifyReleaseRisks,
  rankOwnerLoad,
  toPipelineArray,
  summarizePipelineHealth,
  scoreDeliveryRisk,
  normalizeWorkflowState,
} from "../analytics.js";
import { toolQueryWorkItems, WI_FIELDS } from "./work-item.js";
import { toolListPRs } from "./pull-request.js";
import { toolPipelineStatus } from "./infra.js";

// ─── Sprint info ────────────────────────────────────────────────────────────

export async function toolSprintInfo(args) {
  const { iteration_path } = z
    .strictObject({ iteration_path: z.string().optional() })
    .parse(args ?? {});

  // Determine current iteration if not specified
  let iterPath = iteration_path;
  if (!iterPath) {
    const iterData = await tfsGet("/work/teamsettings/iterations", { "$timeframe": "current" }).catch(() => ({ value: [] }));
    iterPath = (iterData.value ?? [])[0]?.path ?? TFS_PROJECT;
  }

  // WIQL queries must use POST
  const wiql = `SELECT [System.Id] FROM WorkItems
    WHERE [System.TeamProject] = '${TFS_PROJECT}'
    AND [System.IterationPath] = '${iterPath}'
    AND [System.State] <> 'Removed'
    ORDER BY [System.WorkItemType],[System.State]`;

  const wiqlData = await tfsPost("/wit/wiql", { query: wiql }, { "$top": 200 });
  const itemRefs = wiqlData.workItems ?? [];

  if (!itemRefs.length) {
    return { iterationPath: iterPath, items: [], summary: { total: 0, done: 0, inProgress: 0, todo: 0 } };
  }

  const ids = itemRefs.slice(0, 200).map((r) => r.id).join(",");
  const data = await tfsGet("/wit/workitems", { ids, fields: WI_FIELDS });
  const items = (data.value ?? []).map(formatWorkItem);

  const done = items.filter((i) => isCompletedState(i.state));
  const inProgress = items.filter((i) => isActiveState(i.state));
  const todo = items.filter((i) => !isCompletedState(i.state) && !isActiveState(i.state));
  const totalSP = items.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
  const doneSP = done.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);

  const byType = items.reduce((acc, i) => {
    acc[i.type] = (acc[i.type] ?? 0) + 1;
    return acc;
  }, {});

  return {
    iterationPath: iterPath,
    summary: {
      total: items.length,
      done: done.length,
      inProgress: inProgress.length,
      todo: todo.length,
      totalStoryPoints: totalSP,
      completedStoryPoints: doneSP,
      velocity: totalSP > 0 ? Math.round((doneSP / totalSP) * 100) : 0,
    },
    byType,
    items,
  };
}

// ─── Release readiness ──────────────────────────────────────────────────────

export async function toolReleaseReadiness(args) {
  const {
    branch = "master",
    pipeline_name,
    include_pull_requests = true,
    include_pipeline = true,
    top = 100,
  } = z
    .strictObject({
      branch: z.string().default("master"),
      pipeline_name: z.string().optional(),
      include_pull_requests: z.boolean().default(true),
      include_pipeline: z.boolean().default(true),
      top: z.number().int().min(1).max(500).default(100),
    })
    .parse(args ?? {});

  // Get current iteration metadata
  const iterData = await tfsGet("/work/teamsettings/iterations", { "$timeframe": "current" }).catch(() => ({ value: [] }));
  const currentIter = (iterData.value ?? [])[0] ?? {};
  const iteration = {
    path: currentIter.path ?? null,
    sprintName: currentIter.name ?? null,
    startDate: currentIter.attributes?.startDate ?? null,
    finishDate: currentIter.attributes?.finishDate ?? null,
  };

  const [openPRs, pipelines] = await Promise.all([
    include_pull_requests ? toolListPRs({ status: "active", target_branch: branch, top: 20 }) : Promise.resolve([]),
    include_pipeline ? toolPipelineStatus({ name: pipeline_name, branch, top: 5 }) : Promise.resolve([]),
  ]);

  // Work items in current sprint
  const sprintItems = await toolQueryWorkItems({ preset: "sprint", top });

  // buildReleaseSignals takes a flat items array → returns { total, byState, byType, unassigned, withStoryPoints, donePoints, totalPoints, completionPct }
  const signals = buildReleaseSignals(sprintItems);

  // risks = array of strings
  const risks = identifyReleaseRisks(sprintItems, openPRs);

  // blockers = blocked/impeded items
  const blockers = sprintItems.filter((i) =>
    ["blocked", "impeded"].includes(i.state?.toLowerCase() ?? "")
  );

  // pipeline as nullable object or null
  const pipelineArr = toPipelineArray(pipelines);
  const pipelineResult = pipelineArr.length > 0 ? pipelineArr : null;
  const specialistReview = buildSpecialistReview({
    title: `Release readiness ${branch}`,
    description: `Análise de release readiness para branch ${branch}${pipeline_name ? ` e pipeline ${pipeline_name}` : ""}`,
    affectedLocations: [
      branch,
      pipeline_name,
      ...pipelineArr.map((pipeline) => pipeline.name).filter(Boolean),
      ...openPRs.map((pr) => pr.targetBranch).filter(Boolean),
    ].filter(Boolean),
    focus: ["pipeline", "release"],
  });

  // recommended actions from risks
  const recommendedActions = risks.length > 0
    ? risks.map((r) => typeof r === "string" ? r : r.description ?? String(r))
    : ["Sprint está dentro do esperado. Continue monitorando o progresso diário."];
  recommendedActions.push(...specialistReview.recommendedNextActions.slice(0, 3));
  recommendedActions.push(...specialistReview.pipelineRecommendations.slice(0, 2));

  return {
    iteration,
    signals,
    risks: risks.map((r) => typeof r === "string" ? r : r.description ?? String(r)),
    blockers,
    linkedPullRequests: openPRs,
    pipeline: pipelineResult,
    specialistReview,
    recommendedActions,
  };
}

// ─── Team focus report ──────────────────────────────────────────────────────

export async function toolTeamFocusReport(args) {
  z.strictObject({ top: z.number().int().min(1).max(500).default(150) }).parse(args ?? {});
  const { top = 150 } = args ?? {};

  // Get current iteration metadata
  const iterData = await tfsGet("/work/teamsettings/iterations", { "$timeframe": "current" }).catch(() => ({ value: [] }));
  const currentIter = (iterData.value ?? [])[0] ?? {};
  const iteration = {
    path: currentIter.path ?? null,
    sprintName: currentIter.name ?? null,
    finishDate: currentIter.attributes?.finishDate ?? null,
  };

  const sprintItems = await toolQueryWorkItems({ preset: "sprint", top });
  const activePRs = await toolListPRs({ status: "active", top: 30 });

  const ownerLoad = rankOwnerLoad(sprintItems);
  const inProgress = sprintItems.filter((i) => isActiveState(i.state));
  const blockedItems = sprintItems.filter((i) =>
    ["Impeded", "Blocked"].includes(i.state)
  );
  const activeOwners = new Set(sprintItems.map((i) => i.assignedTo).filter(Boolean));
  const unassignedItems = sprintItems.filter((i) => !i.assignedTo || i.assignedTo === "Unassigned");

  const summary = {
    totalItems: sprintItems.length,
    activeItems: inProgress.length,
    owners: activeOwners.size,
    unassignedItems: unassignedItems.length,
  };

  // bottlenecks = owners with > 5 active items
  const bottlenecks = ownerLoad.filter((o) => o.active > 5);

  // wipItems = items in active state
  const wipItems = inProgress.slice(0, 50);

  const recommendations = [
    ...ownerLoad
      .filter((o) => o.active > 5)
      .map((o) => `${o.owner} tem ${o.active} itens ativos — possível sobrecarga`),
    ...(blockedItems.length > 0
      ? [`${blockedItems.length} item(ns) bloqueado(s) — ação necessária`]
      : []),
    ...(unassignedItems.length > 0
      ? [`${unassignedItems.length} item(ns) sem responsável atribuído`]
      : []),
  ];

  if (recommendations.length === 0) {
    recommendations.push("Time está operando normalmente. Continue o acompanhamento.");
  }

  return {
    iteration,
    summary,
    ownerLoad,
    bottlenecks,
    wipItems,
    recommendations,
  };
}

// ─── Delivery risk report ───────────────────────────────────────────────────

export async function toolDeliveryRiskReport(args) {
  const { include_pipelines = true, branch = "master", include_pull_requests = true, top = 100 } = z
    .strictObject({
      include_pipelines: z.boolean().default(true),
      include_pull_requests: z.boolean().default(true),
      branch: z.string().default("master"),
      top: z.number().int().min(1).max(500).default(100),
    })
    .parse(args ?? {});

  // Get current iteration metadata
  const iterData = await tfsGet("/work/teamsettings/iterations", { "$timeframe": "current" }).catch(() => ({ value: [] }));
  const currentIter = (iterData.value ?? [])[0] ?? {};
  const iteration = {
    path: currentIter.path ?? null,
    sprintName: currentIter.name ?? null,
    startDate: currentIter.attributes?.startDate ?? null,
    finishDate: currentIter.attributes?.finishDate ?? null,
  };

  const [sprintItems, openPRs, pipelines] = await Promise.all([
    toolQueryWorkItems({ preset: "sprint", top }),
    include_pull_requests ? toolListPRs({ status: "active", top: 20 }) : Promise.resolve([]),
    include_pipelines ? toolPipelineStatus({ branch, top: 5 }) : Promise.resolve([]),
  ]);

  const risks = identifyReleaseRisks(sprintItems, openPRs);

  // Build the signals object expected by scoreDeliveryRisk AND by DELIVERY_RISK_OUTPUT_SCHEMA
  const completedCount = sprintItems.filter((i) => isCompletedState(i.state)).length;
  const pipelineArr = toPipelineArray(pipelines);
  const specialistReview = buildSpecialistReview({
    title: `Delivery risk ${branch}`,
    description: `Análise executiva de risco de entrega para branch ${branch}`,
    affectedLocations: [
      branch,
      ...pipelineArr.map((pipeline) => pipeline.name).filter(Boolean),
      ...openPRs.map((pr) => pr.targetBranch).filter(Boolean),
    ].filter(Boolean),
    focus: ["pipeline", "release", "architecture"],
  });
  const signals = {
    totalItems: sprintItems.length,
    completionPct: sprintItems.length > 0 ? Math.round((completedCount / sprintItems.length) * 100) : 0,
    openItems: sprintItems.filter((i) => !isCompletedState(i.state)).length,
    openBugs: sprintItems.filter((i) => /bug/i.test(i.type) && !isCompletedState(i.state)).length,
    unestimatedItems: sprintItems.filter(
      (i) => i.storyPoints == null && /User Story|Product Backlog Item/i.test(i.type)
    ).length,
    activePullRequests: openPRs.length,
    bottlenecks: sprintItems.filter((i) =>
      ["blocked", "impeded"].includes(i.state?.toLowerCase() ?? "")
    ).length,
    unassignedItems: sprintItems.filter((i) => !i.assignedTo || i.assignedTo === "Unassigned").length,
    pipelineFailures: pipelineArr.filter((p) => p.result === "failed").length,
    pipelineWarnings: pipelineArr.filter((p) => p.status === "inProgress" || p.result === "partiallySucceeded").length,
  };

  const riskResult = scoreDeliveryRisk({ signals: { ...signals, openItems: signals.openItems, activePullRequests: signals.activePullRequests, bottlenecks: signals.bottlenecks, unassignedItems: signals.unassignedItems, pipelineFailures: signals.pipelineFailures, pipelineWarnings: signals.pipelineWarnings, completionPct: signals.completionPct, openBugs: signals.openBugs, unestimatedItems: signals.unestimatedItems }, risks });
  const { deliveryRiskScore, readinessScore, status } = riskResult;

  const executive = {
    deliveryRiskScore,
    readinessScore,
    status,
  };

  const recommendedActions = risks
    .filter((r) => typeof r !== "string" ? (r.severity === "blocking" || r.severity === "high") : true)
    .map((r) => typeof r === "string" ? r : r.recommendation ?? r.description ?? String(r));

  if (recommendedActions.length === 0) {
    recommendedActions.push("Sprint está dentro do esperado. Continue monitorando o progresso.");
  }
  recommendedActions.push(...specialistReview.recommendedNextActions.slice(0, 3));
  recommendedActions.push(...specialistReview.pipelineRecommendations.slice(0, 2));

  // Build release readiness and team focus inline (lightweight)
  const releaseReadiness = {
    total: sprintItems.length,
    completionPct: signals.completionPct,
    openItems: signals.openItems,
    risks: risks.map((r) => typeof r === "string" ? r : r.description ?? String(r)),
  };

  const teamFocus = {
    totalItems: sprintItems.length,
    activePRs: openPRs.length,
    pipelineHealth: {
      failures: signals.pipelineFailures,
      warnings: signals.pipelineWarnings,
    },
  };

  const supportingData = {
    releaseReadiness,
    teamFocus,
    pipelines: pipelineArr,
  };

  return {
    iteration,
    executive,
    signals,
    risks: risks.map((r) => typeof r === "string" ? r : r.description ?? String(r)),
    recommendedActions,
    specialistReview,
    supportingData,
  };
}
