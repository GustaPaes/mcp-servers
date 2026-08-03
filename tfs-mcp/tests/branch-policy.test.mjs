import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const auditPath = path.join(os.tmpdir(), `tfs-mcp-policy-audit-${process.pid}.jsonl`);
fs.rmSync(auditPath, { force: true });
process.env.TFS_URL = "https://tfs.example.com";
process.env.TFS_COLLECTION = "ExampleCollection";
process.env.TFS_PROJECT = "ExampleProject";
process.env.TFS_REPO = "example-repo";
process.env.TFS_PAT = "synthetic-test-pat";
process.env.TFS_AUDIT_LOG_PATH = auditPath;

const {
  BUILD_VALIDATION_POLICY_TYPE_ID,
  buildBranchPolicyChangeSummary,
  buildBuildValidationPolicyPayload,
  normalizeFilenamePatterns,
  normalizePolicyBranch,
  toolUpsertBuildValidationPolicy,
} = await import("../src/tools/branch-policy.js");

const REPOSITORY = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "example-repo",
  defaultBranch: "refs/heads/main",
};
const DEFINITION = {
  id: 21,
  revision: 5,
  name: "Example PR Validation",
  queueStatus: "enabled",
  repository: { id: REPOSITORY.id, name: REPOSITORY.name },
};
const REFS = [
  { name: "refs/heads/main", objectId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  { name: "refs/heads/develop", objectId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
];

after(() => fs.rmSync(auditPath, { force: true }));

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createPolicy(overrides = {}) {
  return {
    id: 77,
    revision: 3,
    isEnabled: true,
    isBlocking: true,
    type: { id: BUILD_VALIDATION_POLICY_TYPE_ID, displayName: "Build" },
    settings: {
      buildDefinitionId: DEFINITION.id,
      displayName: "Required PR validation",
      manualQueueOnly: false,
      queueOnSourceUpdateOnly: false,
      validDuration: 0,
      filenamePatterns: ["/src/*"],
      scope: [{
        repositoryId: REPOSITORY.id,
        refName: "refs/heads/main",
        matchKind: "Exact",
      }],
    },
    ...overrides,
  };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function installFetch({
  policies = [],
  policyDetails,
  mutationResult,
  definition = DEFINITION,
  refs = REFS,
  onRequest,
} = {}) {
  const previousFetch = globalThis.fetch;
  const requests = [];
  const state = {
    policies: clone(policies),
    policyById: new Map(),
    refs: clone(refs),
  };
  for (const policy of state.policies) state.policyById.set(String(policy.id), clone(policy));
  if (policyDetails) state.policyById.set(String(policyDetails.id), clone(policyDetails));

  const persistPolicy = (body, result = {}) => {
    const id = result.id ?? body.id ?? 77;
    const revision = result.revision ?? body.revision ?? 1;
    const persisted = { ...clone(body), id, revision };
    state.policies = state.policies.filter(policy => String(policy.id) !== String(id));
    state.policies.push(persisted);
    state.policyById.set(String(id), persisted);
    return persisted;
  };

  globalThis.fetch = async (url, options = {}) => {
    const request = {
      url: String(url),
      method: options.method ?? "GET",
      body: options.body ? JSON.parse(options.body) : null,
    };
    requests.push(request);

    const customResponse = await onRequest?.({ request, requests, state, persistPolicy });
    if (customResponse !== undefined) return customResponse;

    if (request.method === "GET" && request.url.includes("/git/repositories?")) {
      return jsonResponse({ value: [REPOSITORY] });
    }
    if (
      request.method === "GET"
      && request.url.includes(`/git/repositories/${REPOSITORY.id}/refs?`)
    ) {
      const filter = new URL(request.url).searchParams.get("filter") ?? "";
      const fullFilter = `refs/${filter}`;
      return jsonResponse({
        value: state.refs.filter(ref => ref.name.startsWith(fullFilter)),
      });
    }
    if (request.method === "GET" && request.url.includes(`/build/definitions/${definition.id}?`)) {
      return jsonResponse(definition);
    }
    if (request.method === "GET" && request.url.includes("/git/policy/configurations?")) {
      return jsonResponse({ value: state.policies });
    }
    const detailsMatch = request.url.match(/\/policy\/configurations\/(\d+)\?/);
    if (request.method === "GET" && detailsMatch) {
      return jsonResponse(state.policyById.get(detailsMatch[1]));
    }
    if (request.method === "POST" && request.url.includes("/policy/configurations?")) {
      const result = mutationResult ?? { id: 77, revision: 1 };
      persistPolicy(request.body, result);
      return jsonResponse(result);
    }
    const updateMatch = request.url.match(/\/policy\/configurations\/(\d+)\?/);
    if (request.method === "PUT" && updateMatch) {
      const result = mutationResult ?? {
        id: Number(updateMatch[1]),
        revision: Number(request.body.revision) + 1,
      };
      persistPolicy(request.body, result);
      return jsonResponse(result);
    }
    return jsonResponse({ message: "unexpected synthetic request" }, 500);
  };
  return {
    requests,
    state,
    persistPolicy,
    restore: () => { globalThis.fetch = previousFetch; },
  };
}

test("builds a synthetic Build Validation payload and preserves update revision", () => {
  const existing = createPolicy({
    settings: {
      ...createPolicy().settings,
      syntheticExtension: "preserved",
    },
  });
  const payload = buildBuildValidationPolicyPayload({
    existing,
    repositoryId: REPOSITORY.id,
    branch: "main",
    buildDefinitionId: DEFINITION.id,
    displayName: "Required PR validation",
    filenamePatterns: [" /src/* ", "/src/*", "!/src/generated/*"],
  });

  assert.equal(payload.id, 77);
  assert.equal(payload.revision, 3);
  assert.equal(payload.type.id, BUILD_VALIDATION_POLICY_TYPE_ID);
  assert.equal(payload.settings.syntheticExtension, "preserved");
  assert.deepEqual(payload.settings.filenamePatterns, ["/src/*", "!/src/generated/*"]);
  assert.deepEqual(payload.settings.scope, [{
    repositoryId: REPOSITORY.id,
    refName: "refs/heads/main",
    matchKind: "Exact",
  }]);
});

test("normalizes branch refs and rejects ambiguous path-filter strings", () => {
  assert.equal(normalizePolicyBranch("feature/example"), "refs/heads/feature/example");
  assert.equal(normalizePolicyBranch("refs/heads/main"), "refs/heads/main");
  assert.equal(normalizePolicyBranch("releases/", "prefix"), "refs/heads/releases/");
  assert.throws(() => normalizePolicyBranch("refs/tags/v1"), /refs\/heads/);
  assert.throws(() => normalizePolicyBranch("main..oops"), /ref Git válida/);
  assert.throws(() => normalizePolicyBranch("release candidate"), /ref Git válida/);
  assert.throws(() => normalizePolicyBranch("releases/", "exact"), /ref Git válida/);
  assert.deepEqual(normalizeFilenamePatterns(["*.cs", "/src/*", "*.cs"]), ["*.cs", "/src/*"]);
  assert.throws(() => normalizeFilenamePatterns(["src/*"]), /deve começar/);
  assert.throws(() => normalizeFilenamePatterns(["/src/*;/tests/*"]), /separadamente/);
});

test("summarizes only controlled policy changes", () => {
  const existing = createPolicy({
    settings: {
      ...createPolicy().settings,
      privateSyntheticValue: "must-not-leak",
    },
  });
  const payload = buildBuildValidationPolicyPayload({
    existing,
    repositoryId: REPOSITORY.id,
    branch: "main",
    buildDefinitionId: DEFINITION.id,
    displayName: "Updated validation",
    filenamePatterns: ["/src/*", "/pipelines/*"],
  });
  const summary = buildBranchPolicyChangeSummary(existing, payload);

  assert.equal(summary.action, "update");
  assert.deepEqual(summary.changedFields, ["displayName", "filenamePatterns"]);
  assert.equal(JSON.stringify(summary).includes("must-not-leak"), false);
});

test("dry-run previews a high-impact create without issuing a write", async () => {
  const mock = installFetch();
  try {
    const result = await toolUpsertBuildValidationPolicy({
      auth_alias: "synthetic",
      repository: REPOSITORY.name,
      branch: "main",
      build_definition_id: DEFINITION.id,
      filename_patterns: ["/src/*"],
      dry_run: true,
    });

    assert.equal(result.willMutate, false);
    assert.equal(result.mutationPlan.changes.action, "create");
    assert.equal(result.mutationPlan.confirmation.highImpact, true);
    assert.equal(result.mutationPlan.confirmation.highImpactConfirmationRequired, "main");
    assert.equal(result.mutationPlan.target.exactBranchVerified, true);
    assert.equal(mock.requests.some(request => ["POST", "PUT"].includes(request.method)), false);
    assert.equal(mock.requests.filter(request => request.url.includes("/refs?")).length, 1);
    const policyListRequest = mock.requests.find(
      request => request.method === "GET" && request.url.includes("/git/policy/configurations?"),
    );
    assert.equal(new URL(policyListRequest.url).searchParams.get("$top"), "1000");
  } finally {
    mock.restore();
  }
});

test("confirmed create posts one Build Validation policy", async () => {
  const mock = installFetch({ mutationResult: { id: 78, revision: 1 } });
  try {
    const result = await toolUpsertBuildValidationPolicy({
      repository: REPOSITORY.name,
      branch: "develop",
      build_definition_id: DEFINITION.id,
      display_name: "Required PR validation",
      filename_patterns: ["/src/*"],
      dry_run: false,
      confirm: true,
      reason: "create synthetic validation policy",
      requestedBy: "automated test",
    });

    assert.equal(result.willMutate, true);
    assert.equal(result.created, true);
    const writes = mock.requests.filter(request => ["POST", "PUT"].includes(request.method));
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, "POST");
    assert.equal(writes[0].body.settings.buildDefinitionId, DEFINITION.id);
    assert.equal(writes[0].body.settings.scope[0].refName, "refs/heads/develop");
    assert.equal(mock.requests.filter(request => request.url.includes("/refs?")).length, 2);
  } finally {
    mock.restore();
  }
});

test("confirmed update uses the matched policy id and revision", async () => {
  const existing = createPolicy({ isEnabled: false });
  const mock = installFetch({ policies: [existing], policyDetails: existing });
  try {
    const result = await toolUpsertBuildValidationPolicy({
      repository: REPOSITORY.name,
      branch: "main",
      build_definition_id: DEFINITION.id,
      display_name: "Required PR validation",
      filename_patterns: ["/src/*"],
      enabled: true,
      dry_run: false,
      confirm: true,
      confirm_high_impact: "77",
      reason: "enable synthetic validation policy",
      requestedBy: "automated test",
    });

    assert.equal(result.updated, true);
    const write = mock.requests.find(request => request.method === "PUT");
    assert(write);
    assert.equal(write.body.id, 77);
    assert.equal(write.body.revision, 3);
    assert.equal(write.body.isEnabled, true);
    assert.equal(result.revision, 4);
    assert.equal(
      mock.requests.filter(
        request => request.method === "GET" && request.url.includes("/policy/configurations/77?"),
      ).length,
      3,
    );
  } finally {
    mock.restore();
  }
});

test("an already matching policy is audited as unchanged without PUT", async () => {
  const existing = createPolicy();
  const mock = installFetch({ policies: [existing], policyDetails: existing });
  try {
    const result = await toolUpsertBuildValidationPolicy({
      repository: REPOSITORY.name,
      branch: "main",
      build_definition_id: DEFINITION.id,
      display_name: "Required PR validation",
      filename_patterns: ["/src/*"],
      dry_run: false,
    });

    assert.equal(result.willMutate, false);
    assert.equal(result.unchanged, true);
    assert.equal(result.mutationPlan.changes.action, "none");
    assert.equal(mock.requests.some(request => ["POST", "PUT"].includes(request.method)), false);
    const lastAuditEntry = JSON.parse(
      fs.readFileSync(auditPath, "utf8").trim().split(/\r?\n/).at(-1),
    );
    assert.equal(lastAuditEntry.status, "unchanged");
    assert.equal(lastAuditEntry.tool, "tfs_branch_policy_upsert");
  } finally {
    mock.restore();
  }
});

test("refuses ambiguous duplicate and multi-scope policies", async () => {
  const duplicateA = createPolicy();
  const duplicateB = createPolicy({ id: 78 });
  let mock = installFetch({ policies: [duplicateA, duplicateB] });
  try {
    await assert.rejects(
      toolUpsertBuildValidationPolicy({
        repository: REPOSITORY.name,
        branch: "main",
        build_definition_id: DEFINITION.id,
      }),
      /múltiplas Build Validation policies/,
    );
  } finally {
    mock.restore();
  }

  const multiScope = createPolicy({
    settings: {
      ...createPolicy().settings,
      scope: [
        ...createPolicy().settings.scope,
        {
          repositoryId: REPOSITORY.id,
          refName: "refs/heads/release",
          matchKind: "Exact",
        },
      ],
    },
  });
  mock = installFetch({ policies: [multiScope], policyDetails: multiScope });
  try {
    await assert.rejects(
      toolUpsertBuildValidationPolicy({
        repository: REPOSITORY.name,
        branch: "main",
        build_definition_id: DEFINITION.id,
      }),
      /também cobre outros escopos/,
    );
  } finally {
    mock.restore();
  }
});

test("matches branch refs case-sensitively", async () => {
  const differentlyCased = createPolicy({
    settings: {
      ...createPolicy().settings,
      scope: [{
        repositoryId: REPOSITORY.id,
        refName: "refs/heads/Main",
        matchKind: "Exact",
      }],
    },
  });
  const mock = installFetch({ policies: [differentlyCased] });
  try {
    const result = await toolUpsertBuildValidationPolicy({
      repository: REPOSITORY.name,
      branch: "main",
      build_definition_id: DEFINITION.id,
      filename_patterns: ["/src/*"],
    });

    assert.equal(result.mutationPlan.changes.action, "create");
    assert.equal(
      mock.requests.some(
        request => request.method === "GET" && request.url.includes("/policy/configurations/77?"),
      ),
      false,
    );
  } finally {
    mock.restore();
  }
});

test("requires an existing exact-case branch and rechecks it before writing", async (t) => {
  await t.test("rejects a branch that exists only with different casing", async () => {
    const mock = installFetch({
      refs: [{
        name: "refs/heads/Main",
        objectId: "cccccccccccccccccccccccccccccccccccccccc",
      }],
    });
    try {
      await assert.rejects(
        toolUpsertBuildValidationPolicy({
          repository: REPOSITORY.name,
          branch: "main",
          build_definition_id: DEFINITION.id,
        }),
        /não foi encontrada.*capitalização/,
      );
      assert.equal(
        mock.requests.some(request => request.url.includes("/git/policy/configurations?")),
        false,
      );
    } finally {
      mock.restore();
    }
  });

  await t.test("stops when the branch disappears after the plan read", async () => {
    let refReads = 0;
    const mock = installFetch({
      onRequest: ({ request }) => {
        if (request.method === "GET" && request.url.includes("/refs?")) {
          refReads += 1;
          if (refReads === 2) return jsonResponse({ value: [] });
        }
        return undefined;
      },
    });
    try {
      await assert.rejects(
        toolUpsertBuildValidationPolicy({
          repository: REPOSITORY.name,
          branch: "develop",
          build_definition_id: DEFINITION.id,
          dry_run: false,
          confirm: true,
          reason: "test branch existence revalidation",
          requestedBy: "automated test",
        }),
        /não foi encontrada.*capitalização/,
      );
      assert.equal(refReads, 2);
      assert.equal(mock.requests.some(request => request.method === "POST"), false);
    } finally {
      mock.restore();
    }
  });
});

test("treats every prefix scope and plural releases as high impact", async (t) => {
  for (const [branch, expectedMatch] of [
    ["releases/", "releases"],
    ["features/", "prefix-scope"],
  ]) {
    await t.test(branch, async () => {
      const mock = installFetch();
      try {
        const result = await toolUpsertBuildValidationPolicy({
          repository: REPOSITORY.name,
          branch,
          branch_match_kind: "prefix",
          build_definition_id: DEFINITION.id,
        });

        assert.equal(result.mutationPlan.confirmation.highImpact, true);
        assert.equal(result.mutationPlan.confirmation.highImpactMatch, expectedMatch);
        assert.equal(result.mutationPlan.target.branchMatchKind, "prefix");
        assert.equal(result.mutationPlan.target.exactBranchVerified, false);
        assert.equal(mock.requests.some(request => request.url.includes("/refs?")), false);
      } finally {
        mock.restore();
      }
    });
  }
});

test("requires an enabled same-repository build definition by default", async (t) => {
  await t.test("rejects a paused definition", async () => {
    const mock = installFetch({ definition: { ...DEFINITION, queueStatus: "paused" } });
    try {
      await assert.rejects(
        toolUpsertBuildValidationPolicy({
          repository: REPOSITORY.name,
          branch: "develop",
          build_definition_id: DEFINITION.id,
        }),
        /queueStatus.*paused/,
      );
      assert.equal(
        mock.requests.some(request => request.url.includes("/git/policy/configurations?")),
        false,
      );
    } finally {
      mock.restore();
    }
  });

  await t.test("allows disabling a policy backed by a paused definition", async () => {
    const existing = createPolicy();
    const mock = installFetch({
      policies: [existing],
      definition: { ...DEFINITION, queueStatus: "paused" },
    });
    try {
      const result = await toolUpsertBuildValidationPolicy({
        repository: REPOSITORY.name,
        branch: "main",
        build_definition_id: DEFINITION.id,
        display_name: "Required PR validation",
        filename_patterns: ["/src/*"],
        enabled: false,
        dry_run: false,
        confirm: true,
        confirm_high_impact: "77",
        reason: "disable policy for paused validation pipeline",
        requestedBy: "automated test",
      });

      const write = mock.requests.find(request => request.method === "PUT");
      assert(write);
      assert.equal(write.body.isEnabled, false);
      assert.equal(result.updated, true);
    } finally {
      mock.restore();
    }
  });

  const crossRepositoryDefinition = {
    ...DEFINITION,
    repository: {
      id: "22222222-2222-2222-2222-222222222222",
      name: "central-validator",
      type: "TfsGit",
    },
  };

  await t.test("rejects a cross-repository definition without opt-in", async () => {
    const mock = installFetch({ definition: crossRepositoryDefinition });
    try {
      await assert.rejects(
        toolUpsertBuildValidationPolicy({
          repository: REPOSITORY.name,
          branch: "develop",
          build_definition_id: DEFINITION.id,
        }),
        /allow_cross_repository:true/,
      );
    } finally {
      mock.restore();
    }
  });

  await t.test("exposes an approved cross-repository definition as high impact", async () => {
    const mock = installFetch({ definition: crossRepositoryDefinition });
    try {
      const result = await toolUpsertBuildValidationPolicy({
        repository: REPOSITORY.name,
        branch: "develop",
        build_definition_id: DEFINITION.id,
        allow_cross_repository: true,
      });

      assert.equal(result.mutationPlan.target.crossRepository, true);
      assert.equal(result.mutationPlan.target.crossRepositoryAllowed, true);
      assert.equal(
        result.mutationPlan.target.buildDefinitionRepositoryId,
        crossRepositoryDefinition.repository.id,
      );
      assert.equal(result.mutationPlan.confirmation.highImpact, true);
      assert.equal(result.mutationPlan.confirmation.highImpactMatch, "cross-repository");
      assert.equal(result.mutationPlan.confirmation.highImpactConfirmationRequired, "develop");
    } finally {
      mock.restore();
    }
  });
});

test("fails closed when the build definition changes before a policy write", async (t) => {
  const otherRepository = {
    id: "22222222-2222-2222-2222-222222222222",
    name: "other-repository",
    type: "TfsGit",
  };
  const scenarios = [
    ["revision", { ...DEFINITION, revision: DEFINITION.revision + 1 }, /revision/],
    ["name", { ...DEFINITION, name: "Renamed PR Validation" }, /name/],
    ["queueStatus", { ...DEFINITION, queueStatus: "paused" }, /queueStatus.*paused/],
    ["repository", { ...DEFINITION, repository: otherRepository }, /allow_cross_repository:true/],
  ];

  for (const [label, freshDefinition, expectedError] of scenarios) {
    await t.test(label, async () => {
      let definitionReads = 0;
      const mock = installFetch({
        onRequest: ({ request }) => {
          if (
            request.method === "GET"
            && request.url.includes(`/build/definitions/${DEFINITION.id}?`)
          ) {
            definitionReads += 1;
            if (definitionReads === 2) return jsonResponse(freshDefinition);
          }
          return undefined;
        },
      });
      try {
        await assert.rejects(
          toolUpsertBuildValidationPolicy({
            repository: REPOSITORY.name,
            branch: "develop",
            build_definition_id: DEFINITION.id,
            dry_run: false,
            confirm: true,
            reason: `test definition ${label} drift`,
            requestedBy: "automated test",
          }),
          expectedError,
        );
        assert.equal(definitionReads, 2);
        assert.equal(
          mock.requests.some(request => ["POST", "PUT"].includes(request.method)),
          false,
        );
      } finally {
        mock.restore();
      }
    });
  }
});

test("does not retry an ambiguous policy create and reconciles only persisted desired state", async (t) => {
  const mutationArgs = {
    repository: REPOSITORY.name,
    branch: "develop",
    build_definition_id: DEFINITION.id,
    display_name: "Required PR validation",
    filename_patterns: ["/src/*"],
    dry_run: false,
    confirm: true,
    reason: "test ambiguous create response",
    requestedBy: "automated test",
  };

  await t.test("fails after one POST when no policy was persisted", async () => {
    const mock = installFetch({
      onRequest: ({ request }) => {
        if (request.method === "POST") {
          return jsonResponse({ message: "synthetic transient failure" }, 500);
        }
        return undefined;
      },
    });
    try {
      await assert.rejects(toolUpsertBuildValidationPolicy(mutationArgs), /TFS 500 POST/);
      assert.equal(mock.requests.filter(request => request.method === "POST").length, 1);
    } finally {
      mock.restore();
    }
  });

  await t.test("accepts one POST only when the desired policy is found on read-back", async () => {
    const mock = installFetch({
      onRequest: ({ request, persistPolicy }) => {
        if (request.method === "POST") {
          persistPolicy(request.body, { id: 79, revision: 1 });
          return jsonResponse({ message: "synthetic response lost after commit" }, 500);
        }
        return undefined;
      },
    });
    try {
      const result = await toolUpsertBuildValidationPolicy(mutationArgs);
      assert.equal(result.policyId, 79);
      assert.equal(result.reconciled, true);
      assert.equal(mock.requests.filter(request => request.method === "POST").length, 1);
    } finally {
      mock.restore();
    }
  });
});

test("serializes concurrent creates for the same policy identity in one process", async () => {
  const mock = installFetch({
    onRequest: async ({ request }) => {
      if (request.method === "POST") {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return undefined;
    },
  });
  const mutationArgs = {
    repository: REPOSITORY.name,
    branch: "develop",
    build_definition_id: DEFINITION.id,
    display_name: "Required PR validation",
    filename_patterns: ["/src/*"],
    dry_run: false,
    confirm: true,
    reason: "test concurrent create serialization",
    requestedBy: "automated test",
  };

  try {
    const results = await Promise.all([
      toolUpsertBuildValidationPolicy(mutationArgs),
      toolUpsertBuildValidationPolicy(mutationArgs),
    ]);

    assert.equal(mock.requests.filter(request => request.method === "POST").length, 1);
    assert.equal(results.filter(result => result.created).length, 1);
    assert.equal(results.filter(result => result.unchanged).length, 1);
  } finally {
    mock.restore();
  }
});

test("sends an ambiguous policy update once and reconciles persisted state", async () => {
  const existing = createPolicy({ isEnabled: false });
  const mock = installFetch({
    policies: [existing],
    onRequest: ({ request, persistPolicy }) => {
      if (request.method === "PUT") {
        persistPolicy(request.body, { id: existing.id, revision: existing.revision + 1 });
        return jsonResponse({ message: "synthetic response lost after commit" }, 500);
      }
      return undefined;
    },
  });

  try {
    const result = await toolUpsertBuildValidationPolicy({
      repository: REPOSITORY.name,
      branch: "main",
      build_definition_id: DEFINITION.id,
      display_name: "Required PR validation",
      filename_patterns: ["/src/*"],
      enabled: true,
      dry_run: false,
      confirm: true,
      confirm_high_impact: "77",
      reason: "test ambiguous update response",
      requestedBy: "automated test",
    });

    assert.equal(result.updated, true);
    assert.equal(result.reconciled, true);
    assert.equal(result.revision, 4);
    assert.equal(mock.requests.filter(request => request.method === "PUT").length, 1);
  } finally {
    mock.restore();
  }
});

test("fails closed when the policy revision changes before PUT", async () => {
  const existing = createPolicy({ isEnabled: false });
  let detailReads = 0;
  const mock = installFetch({
    policies: [existing],
    onRequest: ({ request }) => {
      if (request.method === "GET" && request.url.includes("/policy/configurations/77?")) {
        detailReads += 1;
        if (detailReads === 2) return jsonResponse({ ...existing, revision: 4 });
      }
      return undefined;
    },
  });
  try {
    await assert.rejects(
      toolUpsertBuildValidationPolicy({
        repository: REPOSITORY.name,
        branch: "main",
        build_definition_id: DEFINITION.id,
        display_name: "Required PR validation",
        filename_patterns: ["/src/*"],
        enabled: true,
        dry_run: false,
        confirm: true,
        confirm_high_impact: "77",
        reason: "test revision drift handling",
        requestedBy: "automated test",
      }),
      /mudou da revisão 3 para 4/,
    );
    assert.equal(mock.requests.some(request => request.method === "PUT"), false);
  } finally {
    mock.restore();
  }
});

test("surfaces 409 and 412 update conflicts without retry", async (t) => {
  for (const status of [409, 412]) {
    await t.test(String(status), async () => {
      const existing = createPolicy({ isEnabled: false });
      const mock = installFetch({
        policies: [existing],
        onRequest: ({ request }) => {
          if (request.method === "PUT") {
            return jsonResponse({ message: "synthetic revision conflict" }, status);
          }
          return undefined;
        },
      });
      try {
        await assert.rejects(
          toolUpsertBuildValidationPolicy({
            repository: REPOSITORY.name,
            branch: "main",
            build_definition_id: DEFINITION.id,
            display_name: "Required PR validation",
            filename_patterns: ["/src/*"],
            enabled: true,
            dry_run: false,
            confirm: true,
            confirm_high_impact: "77",
            reason: `test ${status} conflict handling`,
            requestedBy: "automated test",
          }),
          new RegExp(`concorrência \\(${status}\\)`),
        );
        assert.equal(mock.requests.filter(request => request.method === "PUT").length, 1);
      } finally {
        mock.restore();
      }
    });
  }
});
