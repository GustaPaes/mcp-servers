export const NULLABLE_STRING_SCHEMA = { type: ["string", "null"] };
export const NULLABLE_NUMBER_SCHEMA = { type: ["number", "null"] };
export const NULLABLE_OBJECT_SCHEMA = { type: ["object", "null"] };
export const NULLABLE_OBJECT_OR_ARRAY_SCHEMA = {
  anyOf: [
    { type: "null" },
    { type: "object" },
    { type: "array", items: { type: "object" } },
  ],
};

export const WORK_ITEM_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "number" },
    url: { type: "string" },
    type: { type: "string" },
    state: { type: "string" },
    title: { type: "string" },
    assignedTo: { type: "string" },
    iteration: { type: "string" },
    area: { type: "string" },
    storyPoints: NULLABLE_NUMBER_SCHEMA,
    priority: NULLABLE_NUMBER_SCHEMA,
    tags: { type: "string" },
    description: { type: "string" },
    acceptanceCriteria: { type: "string" },
    parent: { type: ["string", "number", "null"] },
    children: {
      type: "array",
      items: { type: ["string", "number"] },
    },
    linkType: NULLABLE_STRING_SCHEMA,
  },
  required: ["id", "title", "type", "state", "assignedTo"],
};

export const PR_REVIEWER_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    vote: { type: "number" },
  },
  required: ["name", "vote"],
};

export const PR_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "number" },
    title: { type: "string" },
    status: { type: "string" },
    repository: NULLABLE_STRING_SCHEMA,
    repo: NULLABLE_STRING_SCHEMA,
    isDraft: { type: "boolean" },
    author: { type: "string" },
    createdDate: NULLABLE_STRING_SCHEMA,
    sourceBranch: { type: "string" },
    targetBranch: { type: "string" },
    reviewers: {
      type: "array",
      items: PR_REVIEWER_SCHEMA,
    },
    votes: {
      type: "object",
      properties: {
        approved: { type: "number" },
        waiting: { type: "number" },
        rejected: { type: "number" },
      },
      required: ["approved", "waiting", "rejected"],
    },
    description: { type: "string" },
    mergeStatus: NULLABLE_STRING_SCHEMA,
    url: { type: "string" },
    artifactUrl: NULLABLE_STRING_SCHEMA,
    unavailable: { type: "boolean" },
  },
  required: ["id", "title", "status"],
};

export const FILE_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    total: { type: "number" },
    cs: { type: "number" },
    tests: { type: "number" },
    configs: { type: "number" },
    docs: { type: "number" },
  },
  required: ["total", "cs", "tests", "configs", "docs"],
};

export const CRITICAL_AREAS_SCHEMA = {
  type: "object",
  properties: {
    areas: { type: "array", items: { type: "string" } },
    criticalFiles: { type: "array", items: { type: "string" } },
  },
  required: ["areas", "criticalFiles"],
};

export const ITERATION_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    path: NULLABLE_STRING_SCHEMA,
    sprintName: NULLABLE_STRING_SCHEMA,
    startDate: NULLABLE_STRING_SCHEMA,
    finishDate: NULLABLE_STRING_SCHEMA,
  },
  required: ["path", "sprintName", "startDate", "finishDate"],
};

export const PREPARE_PR_REVIEW_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    pullRequest: PR_SUMMARY_SCHEMA,
    linkedWorkItems: {
      type: "array",
      items: WORK_ITEM_SUMMARY_SCHEMA,
    },
    signals: {
      type: "object",
      properties: {
        reviewerCount: { type: "number" },
        threadCount: { type: "number" },
        workItemCount: { type: "number" },
        fileSummary: FILE_SUMMARY_SCHEMA,
        criticalAreas: CRITICAL_AREAS_SCHEMA,
        codeReviewScore: NULLABLE_NUMBER_SCHEMA,
      },
      required: ["reviewerCount", "threadCount", "workItemCount", "fileSummary", "criticalAreas", "codeReviewScore"],
    },
    risks: { type: "array", items: { type: "string" } },
    checklist: { type: "array", items: { type: "string" } },
    suggestedFocus: { type: "array", items: { type: "string" } },
    codeReview: NULLABLE_OBJECT_SCHEMA,
    pipeline: NULLABLE_OBJECT_OR_ARRAY_SCHEMA,
  },
  required: ["pullRequest", "linkedWorkItems", "signals", "risks", "checklist", "suggestedFocus", "codeReview", "pipeline"],
};

export const RELEASE_READINESS_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    iteration: ITERATION_SUMMARY_SCHEMA,
    signals: {
      type: "object",
      properties: {
        total: { type: "number" },
        byState: { type: "object" },
        byType: { type: "object" },
        unassigned: { type: "number" },
        withStoryPoints: { type: "number" },
        donePoints: { type: "number" },
        totalPoints: { type: "number" },
        completionPct: { type: "number" },
      },
      required: ["total", "byState", "byType", "unassigned", "withStoryPoints", "donePoints", "totalPoints", "completionPct"],
    },
    risks: { type: "array", items: { type: "string" } },
    blockers: {
      type: "array",
      items: WORK_ITEM_SUMMARY_SCHEMA,
    },
    linkedPullRequests: {
      type: "array",
      items: PR_SUMMARY_SCHEMA,
    },
    pipeline: NULLABLE_OBJECT_OR_ARRAY_SCHEMA,
    recommendedActions: { type: "array", items: { type: "string" } },
  },
  required: ["iteration", "signals", "risks", "blockers", "linkedPullRequests", "pipeline", "recommendedActions"],
};

export const OWNER_LOAD_SCHEMA = {
  type: "object",
  properties: {
    owner: { type: "string" },
    total: { type: "number" },
    active: { type: "number" },
    done: { type: "number" },
    bugs: { type: "number" },
    storyPoints: { type: "number" },
  },
  required: ["owner", "total", "active", "done", "bugs", "storyPoints"],
};

export const TEAM_FOCUS_REPORT_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    iteration: {
      type: "object",
      properties: {
        path: NULLABLE_STRING_SCHEMA,
        sprintName: NULLABLE_STRING_SCHEMA,
        finishDate: NULLABLE_STRING_SCHEMA,
      },
      required: ["path", "sprintName", "finishDate"],
    },
    summary: {
      type: "object",
      properties: {
        totalItems: { type: "number" },
        activeItems: { type: "number" },
        owners: { type: "number" },
        unassignedItems: { type: "number" },
      },
      required: ["totalItems", "activeItems", "owners", "unassignedItems"],
    },
    ownerLoad: { type: "array", items: OWNER_LOAD_SCHEMA },
    bottlenecks: { type: "array", items: OWNER_LOAD_SCHEMA },
    wipItems: { type: "array", items: WORK_ITEM_SUMMARY_SCHEMA },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: ["iteration", "summary", "ownerLoad", "bottlenecks", "wipItems", "recommendations"],
};

export const WIKI_MATCH_SCHEMA = {
  type: "object",
  properties: {
    wiki: { type: "string" },
    path: { type: "string" },
  },
  required: ["wiki", "path"],
};

export const ROLE_CHECKLIST_SCHEMA = {
  type: "object",
  properties: {
    po: { type: "array", items: { type: "string" } },
    dev: { type: "array", items: { type: "string" } },
    qa: { type: "array", items: { type: "string" } },
    support: { type: "array", items: { type: "string" } },
  },
  required: ["po", "dev", "qa", "support"],
};

export const WORK_ITEM_HANDOFF_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    workItem: WORK_ITEM_SUMMARY_SCHEMA,
    handoff: {
      type: "object",
      properties: {
        currentStage: { type: "string" },
        recommendedOwnerRole: { type: "string" },
        destination: { type: "string" },
        readinessScore: { type: "number" },
      },
      required: ["currentStage", "recommendedOwnerRole", "destination", "readinessScore"],
    },
    summary: {
      type: "object",
      properties: {
        objective: { type: "string" },
        acceptanceCriteria: { type: "string" },
        businessContext: { type: "string" },
      },
      required: ["objective", "acceptanceCriteria", "businessContext"],
    },
    dependencies: {
      type: "object",
      properties: {
        openItems: { type: "array", items: WORK_ITEM_SUMMARY_SCHEMA },
        linkedPullRequests: { type: "array", items: PR_SUMMARY_SCHEMA },
        wikiMatches: { type: "array", items: WIKI_MATCH_SCHEMA },
      },
      required: ["openItems", "linkedPullRequests", "wikiMatches"],
    },
    risks: { type: "array", items: { type: "string" } },
    openQuestions: { type: "array", items: { type: "string" } },
    checklistByRole: ROLE_CHECKLIST_SCHEMA,
    suggestedComment: { type: "string" },
  },
  required: ["workItem", "handoff", "summary", "dependencies", "risks", "openQuestions", "checklistByRole", "suggestedComment"],
};

export const DELIVERY_RISK_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    iteration: ITERATION_SUMMARY_SCHEMA,
    executive: {
      type: "object",
      properties: {
        deliveryRiskScore: { type: "number" },
        readinessScore: { type: "number" },
        status: { type: "string" },
      },
      required: ["deliveryRiskScore", "readinessScore", "status"],
    },
    signals: {
      type: "object",
      properties: {
        totalItems: { type: "number" },
        completionPct: { type: "number" },
        openItems: { type: "number" },
        openBugs: { type: "number" },
        unestimatedItems: { type: "number" },
        activePullRequests: { type: "number" },
        bottlenecks: { type: "number" },
        unassignedItems: { type: "number" },
        pipelineFailures: { type: "number" },
        pipelineWarnings: { type: "number" },
      },
      required: ["totalItems", "completionPct", "openItems", "openBugs", "unestimatedItems", "activePullRequests", "bottlenecks", "unassignedItems", "pipelineFailures", "pipelineWarnings"],
    },
    risks: { type: "array", items: { type: "string" } },
    recommendedActions: { type: "array", items: { type: "string" } },
    supportingData: {
      type: "object",
      properties: {
        releaseReadiness: { type: "object" },
        teamFocus: { type: "object" },
        pipelines: { type: "array", items: { type: "object" } },
      },
      required: ["releaseReadiness", "teamFocus", "pipelines"],
    },
  },
  required: ["iteration", "executive", "signals", "risks", "recommendedActions", "supportingData"],
};
