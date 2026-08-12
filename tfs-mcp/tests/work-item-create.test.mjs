import test from "node:test";
import assert from "node:assert/strict";

import { toolCreateWorkItem } from "../src/tools/work-item.js";

test("generic work item creation accepts arbitrary fields by reference name", async () => {
  const result = await toolCreateWorkItem({
    work_item_type: "Continuous Improvement",
    title: "Automate a repetitive workflow",
    description: "&lt;div&gt;Business context&lt;/div&gt;",
    custom_fields: {
      "Custom.Impact": "High",
      "Custom.ExpectedBenefits": "&lt;div&gt;Shorter lead time&lt;/div&gt;",
    },
    dry_run: true,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.willMutate, false);

  const changes = result.mutationPlan.changes;
  assert.equal(
    changes.find((change) => change.field === "Custom.Impact")?.valuePreview,
    "High"
  );
  assert.equal(
    changes.find((change) => change.field === "Custom.ExpectedBenefits")
      ?.valuePreview,
    "<div>Shorter lead time</div>"
  );
});
