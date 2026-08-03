import assert from "node:assert/strict";
import test from "node:test";
import { buildYamlDefinitionPayload } from "../src/tools/pipeline.js";

test("builds a generic YAML definition without organization defaults", () => {
  const payload = buildYamlDefinitionPayload({
    name: "Mobile Delivery",
    yamlPath: "\\pipelines\\mobile.yml",
    repository: { id: "repo-id", name: "mobile-app", type: "TfsGit" },
    defaultBranch: "feature/release-automation",
    queue: { id: 10, name: "Linux", pool: { id: 20, name: "Linux" } },
    folder: "\\Mobile",
    variables: { NODE_VERSION: "20.18.0", ENABLED: true },
  });

  assert.equal(payload.process.type, 2);
  assert.equal(payload.process.yamlFilename, "pipelines/mobile.yml");
  assert.equal(payload.repository.defaultBranch, "refs/heads/feature/release-automation");
  assert.deepEqual(payload.variables, {
    NODE_VERSION: { value: "20.18.0", isSecret: false },
    ENABLED: { value: "true", isSecret: false },
  });
  assert.equal(JSON.stringify(payload).toLowerCase().includes("organization"), false);
});

test("preserves an existing definition while replacing YAML-specific fields", () => {
  const payload = buildYamlDefinitionPayload({
    existing: {
      id: 42,
      revision: 7,
      url: "private-url",
      triggers: [{ triggerType: "continuousIntegration" }],
      variables: { EXISTING: { value: "kept" } },
      repository: { properties: { cloneUrl: "private-url" } },
    },
    name: "Delivery",
    yamlPath: "pipelines/delivery.yml",
    repository: { id: "repo-id", name: "app" },
    defaultBranch: "refs/heads/main",
    queue: { id: 10, name: "macOS" },
    folder: "\\",
    variables: {},
  });

  assert.equal(payload.id, 42);
  assert.equal(payload.revision, 7);
  assert.equal(payload.url, undefined);
  assert.deepEqual(payload.triggers, [{ triggerType: "continuousIntegration" }]);
  assert.deepEqual(payload.variables.EXISTING, { value: "kept" });
});

test("delegates CI trigger settings to YAML without removing other trigger types", () => {
  const schedule = { triggerType: "schedule", schedules: [{ branchFilters: ["+refs/heads/main"] }] };
  const payload = buildYamlDefinitionPayload({
    existing: {
      triggers: [
        schedule,
        {
          triggerType: "continuousIntegration",
          settingsSourceType: 1,
          branchFilters: ["+refs/heads/main"],
        },
      ],
    },
    name: "Delivery",
    yamlPath: "pipelines/delivery.yml",
    repository: { id: "repo-id", name: "app" },
    defaultBranch: "refs/heads/main",
    queue: { id: 10, name: "Linux" },
    folder: "\\",
    variables: {},
    ciTriggerMode: "yaml",
  });

  assert.deepEqual(payload.triggers, [
    schedule,
    {
      branchFilters: [],
      pathFilters: [],
      settingsSourceType: 2,
      batchChanges: false,
      maxConcurrentBuildsPerBranch: 1,
      triggerType: "continuousIntegration",
    },
  ]);
});

test("disables only CI triggers and preserves other trigger types", () => {
  const schedule = { triggerType: "schedule", schedules: [] };
  const payload = buildYamlDefinitionPayload({
    existing: {
      triggers: [
        { triggerType: "continuousIntegration", settingsSourceType: 2 },
        { triggerType: "batchedContinuousIntegration", settingsSourceType: 1 },
        schedule,
      ],
    },
    name: "Delivery",
    yamlPath: "pipelines/delivery.yml",
    repository: { id: "repo-id", name: "app" },
    defaultBranch: "refs/heads/main",
    queue: { id: 10, name: "Linux" },
    folder: "\\",
    variables: {},
    ciTriggerMode: "disabled",
  });

  assert.deepEqual(payload.triggers, [schedule]);
});

test("represents a disabled CI override with an empty trigger list", () => {
  const payload = buildYamlDefinitionPayload({
    existing: {
      triggers: [{ triggerType: "continuousIntegration", settingsSourceType: 2 }],
    },
    name: "Delivery",
    yamlPath: "pipelines/delivery.yml",
    repository: { id: "repo-id", name: "app" },
    defaultBranch: "refs/heads/main",
    queue: { id: 10, name: "Linux" },
    folder: "\\",
    variables: {},
    ciTriggerMode: "disabled",
  });

  assert.deepEqual(payload.triggers, []);
});

test("rejects unsupported CI trigger modes in direct payload construction", () => {
  assert.throws(
    () => buildYamlDefinitionPayload({
      name: "Delivery",
      yamlPath: "pipelines/delivery.yml",
      repository: { id: "repo-id", name: "app" },
      defaultBranch: "refs/heads/main",
      queue: { id: 10, name: "Linux" },
      folder: "\\",
      variables: {},
      ciTriggerMode: "unexpected",
    }),
    /não suportado/,
  );
});

test("rejects YAML paths outside the repository", () => {
  assert.throws(
    () => buildYamlDefinitionPayload({
      name: "Delivery",
      yamlPath: "../private/pipeline.yml",
      repository: { id: "repo-id", name: "app" },
      defaultBranch: "refs/heads/main",
      queue: { id: 10, name: "Linux" },
      folder: "\\",
      variables: {},
    }),
    /dentro do repositório/,
  );
});

test("requires a YAML file extension", () => {
  assert.throws(
    () => buildYamlDefinitionPayload({
      name: "Delivery",
      yamlPath: "pipelines/delivery.json",
      repository: { id: "repo-id", name: "app" },
      defaultBranch: "refs/heads/main",
      queue: { id: 10, name: "Linux" },
      folder: "\\",
      variables: {},
    }),
    /\.yml ou \.yaml/,
  );
});
