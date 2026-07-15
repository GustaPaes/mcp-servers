import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIssueAnalysisPatch,
} from "../src/tools/work-item.js";

const testFields = {
  developmentAnalysis: "Custom.Issue.Analysis",
  correctionAndImpacts: "Custom.Issue.CorrectionAndImpacts",
};

test("issue analysis patch always requires and writes development analysis", () => {
  const patch = buildIssueAnalysisPatch({ developmentAnalysis: "Causa confirmada." }, testFields);

  assert.deepEqual(patch, [
    {
      op: "add",
      path: `/fields/${testFields.developmentAnalysis}`,
      value: "Causa confirmada.",
    },
  ]);
});

test("issue analysis patch writes correction and impacts only when informed", () => {
  const patch = buildIssueAnalysisPatch({
    developmentAnalysis: "Causa confirmada.",
    correctionAndImpacts: "Correção validada.",
  }, testFields);

  assert.equal(patch.length, 2);
  assert.equal(patch[1].path, `/fields/${testFields.correctionAndImpacts}`);
  assert.equal(patch[1].value, "Correção validada.");
});

test("issue analysis patch rejects an empty development analysis", () => {
  assert.throws(
    () => buildIssueAnalysisPatch({ developmentAnalysis: "  " }, testFields),
    /development_analysis é obrigatório/
  );
});

test("issue analysis patch requires a configured correction field when correction is informed", () => {
  assert.throws(
    () =>
      buildIssueAnalysisPatch(
        { developmentAnalysis: "Causa confirmada.", correctionAndImpacts: "Correção validada." },
        { developmentAnalysis: testFields.developmentAnalysis, correctionAndImpacts: "" }
      ),
    /TFS_ISSUE_CORRECTION_AND_IMPACTS_FIELD/
  );
});
