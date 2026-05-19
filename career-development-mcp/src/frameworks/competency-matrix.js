import { normalizeRoleKey } from "./career-ladder.js";

export const COMPETENCY_MATRIX = {
  senior: {
    technical_depth: {
      architecture: 4,
      backend_quality: 4,
      testing_strategy: 4,
      code_review: 4,
    },
    technical_breadth: {
      devops: 3,
      observability: 3,
      security: 3,
    },
    leadership: {
      tech_leadership: 4,
      mentoring: 3,
      decision_making: 4,
    },
    business: {
      product_thinking: 3,
      cost_awareness: 4,
      impact_measurement: 4,
    },
  },
  staff: {
    technical_depth: {
      architecture: 5,
      backend_quality: 5,
      testing_strategy: 5,
      code_review: 5,
    },
    technical_breadth: {
      devops: 4,
      observability: 4,
      security: 4,
    },
    leadership: {
      tech_leadership: 5,
      mentoring: 4,
      decision_making: 5,
    },
    business: {
      product_thinking: 4,
      cost_awareness: 5,
      impact_measurement: 5,
    },
  },
};

export function getTargetMatrix(role) {
  return COMPETENCY_MATRIX[normalizeRoleKey(role)] ?? COMPETENCY_MATRIX.senior;
}
