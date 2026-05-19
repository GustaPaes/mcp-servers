export const NULLABLE_STRING_SCHEMA = { type: ["string", "null"] };
export const NULLABLE_NUMBER_SCHEMA = { type: ["number", "null"] };

export const GOAL_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    pdiId: { type: "string" },
    title: { type: "string" },
    category: { type: "string" },
    weight: { type: "number" },
    progress: { type: "number" },
    status: { type: "string" },
    dueDate: NULLABLE_STRING_SCHEMA,
  },
  required: ["id", "pdiId", "title", "category", "weight", "progress", "status", "dueDate"],
};

export const ACTION_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    status: { type: "string" },
    type: { type: "string" },
    dueDate: NULLABLE_STRING_SCHEMA,
    linkedGoalIds: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["id", "title", "description", "status", "type", "dueDate", "linkedGoalIds", "notes"],
};

export const DEVELOPMENT_AREA_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    area: { type: "string" },
    category: { type: "string" },
    currentLevel: { type: "number" },
    targetLevel: { type: "number" },
    rationale: { type: "string" },
    actions: { type: "array", items: ACTION_SCHEMA },
  },
  required: ["id", "area", "category", "currentLevel", "targetLevel", "rationale", "actions"],
};

export const PDI_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    status: { type: "string" },
    currentRole: { type: "string" },
    targetRole: { type: "string" },
    progress: { type: "number" },
    period: {
      type: "object",
      properties: {
        start: { type: "string" },
        end: { type: "string" },
      },
      required: ["start", "end"],
    },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["id", "title", "status", "currentRole", "targetRole", "progress", "period", "tags"],
};

export const PDI_GET_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    pdi: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        status: { type: "string" },
        currentRole: { type: "string" },
        targetRole: { type: "string" },
        vision: { type: "string" },
        period: {
          type: "object",
          properties: {
            start: { type: "string" },
            end: { type: "string" },
          },
          required: ["start", "end"],
        },
        strengths: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        developmentAreas: { type: "array", items: DEVELOPMENT_AREA_SCHEMA },
      },
      required: ["id", "title", "status", "currentRole", "targetRole", "vision", "period", "strengths", "tags", "developmentAreas"],
    },
    progress: {
      type: "object",
      properties: {
        overall: { type: "number" },
        goalsProgress: { type: "number" },
        actionProgress: { type: "number" },
        overdueActions: { type: "number" },
        completedGoals: { type: "number" },
      },
      required: ["overall", "goalsProgress", "actionProgress", "overdueActions", "completedGoals"],
    },
    goals: { type: "array", items: GOAL_SUMMARY_SCHEMA },
    evidenceSummary: {
      type: "object",
      properties: {
        linkedCount: { type: "number" },
        lastEvidenceAt: NULLABLE_STRING_SCHEMA,
      },
      required: ["linkedCount", "lastEvidenceAt"],
    },
  },
  required: ["pdi", "progress", "goals", "evidenceSummary"],
};

export const PDI_ANALYZE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
    smartGoals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          score: { type: "number" },
        },
        required: ["id", "title", "score"],
      },
    },
  },
  required: ["score", "summary", "strengths", "gaps", "recommendations", "smartGoals"],
};

export const CAREER_READINESS_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    currentRole: { type: "string" },
    targetRole: { type: "string" },
    readinessScore: { type: "number" },
    matchedCompetencies: { type: "array", items: { type: "string" } },
    missingCompetencies: { type: "array", items: { type: "string" } },
    priorities: { type: "array", items: { type: "string" } },
  },
  required: ["currentRole", "targetRole", "readinessScore", "matchedCompetencies", "missingCompetencies", "priorities"],
};

export const REVIEW_PREPARE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    activePdi: PDI_SUMMARY_SCHEMA,
    wins: { type: "array", items: { type: "string" } },
    evidenceHighlights: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    asks: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "activePdi", "wins", "evidenceHighlights", "risks", "asks"],
};

export const GOAL_PROGRESS_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    goal: GOAL_SUMMARY_SCHEMA,
    smartAnalysis: {
      type: "object",
      properties: {
        score: { type: "number" },
        strengths: { type: "array", items: { type: "string" } },
        gaps: { type: "array", items: { type: "string" } },
      },
      required: ["score", "strengths", "gaps"],
    },
    milestones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          dueDate: NULLABLE_STRING_SCHEMA,
          completed: { type: "boolean" },
        },
        required: ["title", "dueDate", "completed"],
      },
    },
    evidenceCount: { type: "number" },
    projectedStatus: { type: "string" },
  },
  required: ["goal", "smartAnalysis", "milestones", "evidenceCount", "projectedStatus"],
};
