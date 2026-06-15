import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSpecialistReview,
  enrichActivityInputWithSpecialists,
} from "../src/specialists.js";

test("specialist review routes pipeline, security and database signals", () => {
  const review = buildSpecialistReview({
    title: "Ajustar pipeline com secret e migration SQL",
    affectedLocations: [
      "azure-pipelines.yml",
      "src/Infra/AuthTokenProvider.cs",
      "db/migrations/20260615-add-index.sql",
    ],
  });

  const ids = review.specialistsUsed.map((specialist) => specialist.id);

  assert.ok(ids.includes("business_analyst"));
  assert.ok(ids.includes("tech_lead"));
  assert.ok(ids.includes("qa"));
  assert.ok(ids.includes("devops"));
  assert.ok(ids.includes("security"));
  assert.ok(ids.includes("database"));
  assert.ok(review.pipelineRecommendations.length > 0);
  assert.ok(review.risks.some((risk) => /seguran|persist/i.test(risk)));
});

test("specialist review routes frontend and backend changed files", () => {
  const review = buildSpecialistReview({
    changedFiles: [
      { path: "/client/src/pages/orders.tsx" },
      { path: "/server/api/OrdersController.cs" },
    ],
  });

  const ids = review.specialistsUsed.map((specialist) => specialist.id);

  assert.ok(ids.includes("frontend"));
  assert.ok(ids.includes("backend"));
  assert.ok(review.suggestedTechnicalCriteria.some((item) => /loading|contratos de API/i.test(item)));
});

test("activity enrichment appends specialist criteria", () => {
  const enriched = enrichActivityInputWithSpecialists({
    title: "Criar endpoint com logs e rollback",
    technicalAcceptanceCriteria: ["Deve manter contrato atual"],
    affectedLocations: ["src/api/OrdersController.cs"],
  });

  assert.ok(enriched.businessAcceptanceCriteria.length > 0);
  assert.ok(enriched.technicalAcceptanceCriteria.includes("Deve manter contrato atual"));
  assert.ok(enriched.technicalAcceptanceCriteria.some((item) => /logs/i.test(item)));
  assert.ok(enriched.review.specialistsUsed.length >= 3);
});
