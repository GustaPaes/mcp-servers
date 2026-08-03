/**
 * tools/specialist.js — Specialist review orchestration.
 */
import { z } from "zod";
import { buildSpecialistReview } from "../specialists.js";
import { formatWorkItem } from "../formatters.js";
import { fetchWorkItemById } from "./work-item.js";
import { toolReviewPR } from "./pull-request.js";

const SpecialistReviewArgs = z.strictObject({
  work_item_id: z.union([z.number(), z.string()]).optional(),
  pr_id: z.union([z.number(), z.string()]).optional(),
  repo: z.string().optional(),
  title: z.string().optional(),
  work_item_type: z.string().optional(),
  description: z.string().optional(),
  acceptance_criteria: z.string().optional(),
  technical_dependencies: z.string().optional(),
  technical_acceptance_criteria: z.array(z.string()).optional(),
  affected_locations: z.array(z.string()).optional(),
  tags: z.string().optional(),
  area_path: z.string().optional(),
  focus: z
    .array(
      z.enum([
        "business_writing",
        "technical_writing",
        "qa",
        "pipeline",
        "security",
        "architecture",
        "release",
      ])
    )
    .optional(),
});

function contextFromWorkItem(workItem) {
  const formatted = formatWorkItem(workItem);
  return {
    title: formatted.title,
    workItemType: formatted.type,
    description: formatted.description,
    acceptanceCriteria: formatted.acceptanceCriteria,
    tags: formatted.tags,
    areaPath: formatted.area,
    iterationPath: formatted.iteration,
    workItem: formatted,
  };
}

export async function toolSpecialistReview(args) {
  const parsed = SpecialistReviewArgs.parse(args ?? {});
  const parts = {
    title: parsed.title,
    workItemType: parsed.work_item_type,
    description: parsed.description,
    acceptanceCriteria: parsed.acceptance_criteria,
    technicalDependencies: parsed.technical_dependencies,
    technicalAcceptanceCriteria: parsed.technical_acceptance_criteria,
    affectedLocations: parsed.affected_locations,
    tags: parsed.tags,
    areaPath: parsed.area_path,
    focus: parsed.focus ?? [],
  };

  let workItemContext = {};
  if (parsed.work_item_id != null) {
    const workItem = await fetchWorkItemById(parsed.work_item_id, "all");
    workItemContext = contextFromWorkItem(workItem);
  }

  let pullRequestContext = {};
  if (parsed.pr_id != null) {
    const review = await toolReviewPR({
      id: parsed.pr_id,
      repo: parsed.repo,
      include_diff: true,
      include_threads: true,
      run_pattern_checks: false,
    });
    pullRequestContext = {
      pullRequest: review.pr,
      changedFiles: review.changedFiles ?? [],
      fileSummary: review.fileSummary,
      criticalAreas: review.criticalAreas,
      title: review.pr?.title,
      repo: parsed.repo,
    };
  }

  return buildSpecialistReview({
    ...parts,
    ...workItemContext,
    ...pullRequestContext,
    affectedLocations: parsed.affected_locations ?? [],
  });
}
