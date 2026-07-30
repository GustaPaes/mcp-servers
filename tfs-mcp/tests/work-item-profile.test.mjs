import test from "node:test";
import assert from "node:assert/strict";

import {
  getProfileFieldNames,
  getWorkItemProfile,
  parseWorkItemProfiles,
  validateCustomFields,
  validateFieldReferenceName,
} from "../src/work-item-profile.js";

test("work item profiles resolve fields, defaults and template variables", () => {
  const profiles = parseWorkItemProfiles(
    JSON.stringify({
      "Continuous Improvement": {
        businessField: "Custom.BusinessContext",
        technicalField: "Custom.TechnicalDetails",
        defaults: {
          "Custom.Priority": "High",
          "Custom.Quarter": "{{currentQuarter}}",
        },
      },
    }),
    { variables: { currentQuarter: "2026 Q3" } }
  );

  const profile = getWorkItemProfile(profiles, "continuous improvement");

  assert.equal(profile.businessField, "Custom.BusinessContext");
  assert.equal(profile.technicalField, "Custom.TechnicalDetails");
  assert.deepEqual(profile.defaults, {
    "Custom.Priority": "High",
    "Custom.Quarter": "2026 Q3",
  });
  assert.deepEqual(
    getProfileFieldNames(profiles).sort(),
    [
      "Custom.BusinessContext",
      "Custom.Priority",
      "Custom.Quarter",
      "Custom.TechnicalDetails",
    ].sort()
  );
});

test("unknown work item types use Azure DevOps standard rich-text fields", () => {
  const profile = getWorkItemProfile({}, "Bug");

  assert.equal(profile.businessField, "System.Description");
  assert.equal(
    profile.technicalField,
    "Microsoft.VSTS.Common.AcceptanceCriteria"
  );
  assert.deepEqual(profile.defaults, {});
});

test("custom fields accept valid reference names and preserve typed values", () => {
  const fields = validateCustomFields({
    "Custom.BusinessValue": "<div>Value</div>",
    "Custom.RiskScore": 3,
    "Custom.Enabled": true,
  });

  assert.deepEqual(fields, {
    "Custom.BusinessValue": "<div>Value</div>",
    "Custom.RiskScore": 3,
    "Custom.Enabled": true,
  });
});

test("invalid profile JSON and field reference names fail fast", () => {
  assert.throws(
    () => parseWorkItemProfiles("{"),
    /TFS_WORK_ITEM_PROFILES_JSON contém JSON inválido/
  );
  assert.throws(
    () => validateFieldReferenceName("/fields/System.Title"),
    /reference name/
  );
  assert.throws(
    () =>
      parseWorkItemProfiles({
        Example: { defaults: { "invalid field": "value" } },
      }),
    /reference name/
  );
});
