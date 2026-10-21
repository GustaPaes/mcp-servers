import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { atomicWriteJson } from "@gustapaes/mcp-runtime";
import { PassThrough } from "node:stream";
import {
  readRemoteConfig,
  REMOTE_ENV_KEYS,
} from "../src/integrations/remote-config.js";
import {
  createRemoteHttp,
  isPublicAddress,
  publicLookup,
  withRemoteCancellation,
} from "../src/integrations/remote-http.js";
import {
  createIdpProvider,
  canonicalHash,
} from "../src/integrations/idp-provider.js";
import { createRemoteChanges } from "../src/integrations/remote-changes.js";
import {
  createRemoteTools,
  validateRemoteChange,
} from "../src/tools/remote.js";
import { assessAction } from "../src/analytics/action-review.js";

const env = {
  CAREER_REMOTE_PROVIDER: "idp",
  CAREER_REMOTE_API_URL: "https://api.example.com",
  CAREER_REMOTE_ALLOWED_HOSTS: "api.example.com",
  CAREER_REMOTE_AUTH_TOKEN: "fictional-test-token",
};
const config = readRemoteConfig(env);

test("validates configuration, rejects insecure origins/header injection and documents every key", async () => {
  assert.equal(readRemoteConfig({}).provider, "none");
  const credentialed = new URL("https://api.example.com");
  credentialed.username = "example";
  credentialed.password = "fictional";
  for (const url of [
    "http://api.example.com",
    String(credentialed),
    "https://api.example.com/path",
    "https://api.example.com?secret=x",
    "https://api.example.com:444",
  ])
    assert.throws(
      () => readRemoteConfig({ ...env, CAREER_REMOTE_API_URL: url }),
      /HTTPS origin/,
    );
  assert.throws(
    () =>
      readRemoteConfig({
        ...env,
        CAREER_REMOTE_ALLOWED_HOSTS: "other.example.com",
      }),
    /exactly/,
  );
  assert.throws(
    () => readRemoteConfig({ ...env, CAREER_REMOTE_TIMEOUT_MS: "0" }),
    /integer/,
  );
  assert.throws(
    () => readRemoteConfig({ ...env, CAREER_REMOTE_AUTH_COOKIE: "cookie=x" }),
    /exactly one/,
  );
  assert.throws(
    () =>
      readRemoteConfig({ ...env, CAREER_REMOTE_AUTH_TOKEN: "bad\r\nheader" }),
    /invalid/,
  );
  assert.throws(
    () =>
      readRemoteConfig({
        ...env,
        CAREER_REMOTE_ROUTES_JSON: '{"self":"//evil.example.com"}',
      }),
    /safe relative/,
  );
  assert.throws(
    () =>
      readRemoteConfig({
        ...env,
        CAREER_REMOTE_ROUTES_JSON: '{"plan":"/plans/{otherId}"}',
      }),
    /placeholders/,
  );
  assert.throws(
    () =>
      readRemoteConfig({
        ...env,
        CAREER_REMOTE_ROUTES_JSON: '{"unknown":"/me"}',
      }),
    /known route/,
  );
  assert.equal(
    readRemoteConfig({
      ...env,
      CAREER_REMOTE_ROUTES_JSON: '{"self":"/identity"}',
    }).routes.self,
    "/identity",
  );
  assert.deepEqual(
    readRemoteConfig({ ...env, CAREER_REMOTE_TYPO: "private-value" })
      .unknownKeys,
    ["CAREER_REMOTE_TYPO"],
  );
  const example = await fs.readFile(
    new URL("../.env.example", import.meta.url),
    "utf8",
  );
  for (const key of REMOTE_ENV_KEYS)
    assert.ok(example.includes(`${key}=`), `${key} must be documented`);
});

test("blocks private, metadata, rebinding, mapped IPv6 and special addresses", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "100.100.100.200",
    "172.20.0.1",
    "192.168.1.1",
    "::1",
    "::ffff:8.8.8.8",
    "2001:db8::1",
    "2002:7f00:1::",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  await assert.rejects(
    () =>
      new Promise((resolve, reject) =>
        publicLookup(async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ])("api.example.com", {}, (error) =>
          error ? reject(error) : resolve(),
        ),
      ),
    /public addresses/,
  );
});

function fakeRequest(
  { status = 200, json = { ok: true }, raw, hang = false } = {},
  seen = [],
) {
  return (url, options, callback) => {
    const req = new EventEmitter();
    req.write = (chunk) => {
      req.body = chunk;
    };
    req.destroy = () => {};
    req.end = () => {
      seen.push({ url, options, body: req.body });
      if (hang) return;
      queueMicrotask(() => {
        const res = new PassThrough();
        res.statusCode = status;
        callback(res);
        res.end(raw ?? JSON.stringify(json));
      });
    };
    return req;
  };
}

test("bounds HTTP, denies redirects/origin escape, redacts errors and never retries", async () => {
  const seen = [];
  const http = createRemoteHttp(config, { request: fakeRequest({}, seen) });
  assert.deepEqual(await http("/me"), { ok: true });
  assert.equal(
    seen[0].options.headers.authorization,
    "Bearer fictional-test-token",
  );
  assert.equal(seen[0].options.agent, false);
  assert.equal(typeof seen[0].options.lookup, "function");
  await assert.rejects(() => http("//evil.example.com/path"), /origin/);
  for (const status of [302, 401, 429, 500]) {
    const calls = [];
    const client = createRemoteHttp(config, {
      request: fakeRequest({ status, raw: "secret=do-not-return" }, calls),
    });
    await assert.rejects(
      () => client("/me"),
      (error) => !error.message.includes("do-not-return"),
    );
    assert.equal(calls.length, 1);
  }
  await assert.rejects(
    () =>
      createRemoteHttp(
        { ...config, maxResponseBytes: 1024 },
        { request: fakeRequest({ raw: "x".repeat(1025) }) },
      )("/me"),
    /byte limit/,
  );
  await assert.rejects(
    () =>
      createRemoteHttp(
        { ...config, timeoutMs: 10 },
        { request: fakeRequest({ hang: true }) },
      )("/me"),
    /timed out/,
  );
});

test("cancels before transmission and aborts an in-flight HTTPS request", async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  const neverSent = [];
  const first = createRemoteHttp(config, {
    request: fakeRequest({}, neverSent),
  });
  await assert.rejects(
    () => withRemoteCancellation(cancelled.signal, () => first("/me")),
    /cancelled before transmission/,
  );
  assert.equal(neverSent.length, 0);
  const controller = new AbortController();
  const sent = [];
  const second = createRemoteHttp(config, {
    request: fakeRequest({ hang: true }, sent),
  });
  const pending = withRemoteCancellation(controller.signal, () =>
    second("/me"),
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await assert.rejects(() => pending, /cancelled/);
  assert.equal(sent.length, 1);
});

test("sends evidence comments as a typed JSON multipart part with correct UTF-8 length", async () => {
  const seen = [];
  const provider = createIdpProvider(
    createRemoteHttp(config, { request: fakeRequest({}, seen) }),
  );
  const text = "Ação: Validar piloto\n\nResultado: https://example.com/pr/1";
  await provider.execute("comment_add", { planId: "1" }, { text });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].options.method, "POST");
  assert.equal(seen[0].url.pathname, "/idp/plans/comments");
  assert.equal(
    seen[0].options.headers["content-length"],
    Buffer.byteLength(seen[0].body),
  );
  const multipart = await new Response(seen[0].body, {
    headers: { "content-type": seen[0].options.headers["content-type"] },
  }).formData();
  assert.deepEqual([...multipart.keys()], ["form"]);
  const part = multipart.get("form");
  assert.equal(part.type, "application/json");
  assert.deepEqual(JSON.parse(await part.text()), { plan: 1, text });
});

test("rejects invalid or oversized multipart fields before transmitting", async () => {
  const seen = [];
  const http = createRemoteHttp(config, { request: fakeRequest({}, seen) });
  for (const body of [
    { "bad\r\nfield": "value" },
    { form: null },
    { form: [] },
    { form: { text: "x".repeat(131072) } },
  ])
    await assert.rejects(() =>
      http("/comments", { method: "POST", form: true, body }),
    );
  assert.equal(seen.length, 0);
});

test("scopes dedicated session cookies and denies secret files outside their root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "career-auth-"));
  try {
    const file = path.join(root, "session.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        cookies: [
          {
            name: "session",
            value: "fictional",
            domain: "api.example.com",
            path: "/",
            expires: -1,
          },
          {
            name: "wrong",
            value: "secret",
            domain: "other.example.com",
            path: "/",
            expires: -1,
          },
        ],
      }),
    );
    const seen = [];
    const client = createRemoteHttp(
      { ...config, token: "", sessionFile: file, sessionRoot: root },
      { request: fakeRequest({}, seen) },
    );
    await client("/me");
    assert.equal(seen[0].options.headers.cookie, "session=fictional");
    await assert.rejects(
      () =>
        createRemoteHttp(
          {
            ...config,
            token: "",
            sessionFile: file,
            sessionRoot: path.join(root, "sub"),
          },
          { request: fakeRequest() },
        )("/me"),
      /session file/,
    );
    await fs.writeFile(
      file,
      JSON.stringify({
        cookies: [
          {
            name: "session",
            value: "fictional",
            domain: "api.example.com",
            path: "/me-extra",
            expires: -1,
          },
        ],
      }),
    );
    await assert.rejects(() => client("/me"), /session file/);
  } finally {
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

test("normalizes only owned plan data and enforces bounded provider collections", async () => {
  const rawPlan = {
    id: 1,
    employee: 2,
    name: "Example plan",
    description: "Evidence based development",
    status: "PENDING",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  };
  const provider = createIdpProvider(async (route) =>
    route === "/me"
      ? { employee: { id: 2 } }
      : route.includes("/actions/")
        ? [
            {
              action: {
                id: 3,
                plan: 1,
                title: "Example action",
                description: "Show evidence",
                status: "PENDING",
                dueDate: "2026-12-01",
              },
            },
          ]
        : { plan: rawPlan, employee: { password: "must-not-escape" } },
  );
  const result = await provider.get("1");
  assert.equal(result.data.actions[0].id, "3");
  assert.equal(JSON.stringify(result.data).includes("must-not-escape"), false);
  assert.equal(result.data.revision.length, 64);
  rawPlan.employee = 4;
  await assert.rejects(() => provider.get("1"), /authenticated employee/);
});

test("reads wrapped comments and uses configurable routes without exposing employee data", async () => {
  const routes = {
    ...config.routes,
    self: "/identity",
    plan: "/plans/{planId}",
    actions: "/actions",
    comments: "/comments",
  };
  const provider = createIdpProvider(async (route) => {
    if (route === "/identity") return { employee: 2 };
    if (route.startsWith("/plans/"))
      return {
        plan: { id: 1, employee: 2, name: "Example plan", status: "PENDING" },
      };
    if (route.startsWith("/actions")) return [];
    if (route.startsWith("/comments"))
      return [
        {
          comment: {
            id: 4,
            text: "Evidence: https://example.com/pr/1",
            createdAt: "2026-01-01",
          },
          employee: { name: "must be omitted" },
        },
      ];
    throw new Error("Unexpected route");
  }, routes);
  const result = await provider.get("1", { comments: true });
  assert.equal(result.data.comments[0].id, "4");
  assert.equal(JSON.stringify(result.data).includes("must be omitted"), false);
});

function fakeProvider() {
  const state = {
    owner: "2",
    plan: {
      id: "1",
      title: "Example plan",
      description: "Measure improvement",
      status: "PENDING",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    },
    actions: [
      {
        id: "3",
        planId: "1",
        title: "Validate pilot",
        description: "Run pilot and record result",
        status: "PENDING",
        dueDate: "2026-11-01",
      },
    ],
    comments: [
      {
        id: "4",
        text: "Validate pilot: https://example.com/evidence",
        createdAt: null,
      },
    ],
    calls: 0,
  };
  return {
    state,
    self: async () => state.owner,
    get: async () => ({
      employee: state.owner,
      data: {
        plan: state.plan,
        actions: state.actions,
        comments: state.comments,
        revision: canonicalHash({ plan: state.plan, actions: state.actions }),
        capturedAt: "2026-10-01T00:00:00Z",
      },
    }),
    execute: async (op, target, changes) => {
      state.calls++;
      if (op === "action_status") state.actions[0].status = changes.status;
      else if (op === "plan_update") Object.assign(state.plan, changes);
      return { id: 5 };
    },
  };
}

async function withChanges(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "career-remote-"));
  try {
    const provider = fakeProvider();
    let now = 1000000;
    const changes = createRemoteChanges({
      config,
      provider,
      directory: path.join(root, "previews"),
      clock: () => now,
    });
    await run({
      changes,
      provider,
      root,
      advance: (ms) => {
        now += ms;
      },
    });
  } finally {
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
}

test("rejects malformed changes, unknown fields, invalid dates and completion without evidence comment", () => {
  assert.throws(
    () =>
      validateRemoteChange({
        operation: "plan_update",
        planId: "1",
        changes: { unexpected: true },
      }),
    /unrecognized/i,
  );
  assert.throws(
    () =>
      validateRemoteChange({
        operation: "action_create",
        planId: "1",
        changes: {
          title: "Task",
          description: "Result",
          dueDate: "2026-02-31",
        },
      }),
    /calendar/,
  );
  assert.throws(
    () =>
      validateRemoteChange({
        operation: "plan_update",
        planId: "1",
        changes: { text: "not applicable" },
      }),
    /unrecognized/i,
  );
  assert.throws(
    () =>
      validateRemoteChange({
        operation: "action_status",
        planId: "1",
        actionId: "3",
        changes: { status: "COMPLETED" },
      }),
    /commentId/,
  );
  assert.throws(
    () =>
      validateRemoteChange({
        operation: "comment_add",
        planId: "1",
        changes: { text: "Bearer abcdefghijklmnop" },
      }),
    /Credential/,
  );
});

test("binds approval to exact preview, rejects conflicts/expiry, and replays applied receipts without another write", async () =>
  withChanges(async ({ changes, provider, advance }) => {
    const input = {
      operation: "action_status",
      planId: "1",
      actionId: "3",
      changes: { status: "COMPLETED", commentId: "4" },
    };
    const first = await changes.prepare(input);
    await assert.rejects(
      () =>
        changes.apply({
          previewId: first.previewId,
          confirmationDigest: "wrong",
          confirm: true,
        }),
      /match/,
    );
    await assert.rejects(
      () => changes.apply({ ...first, confirm: false }),
      /confirmation/,
    );
    provider.state.actions[0].description = "Changed externally";
    await assert.rejects(
      () => changes.apply({ ...first, confirm: true }),
      /changed/,
    );
    assert.equal(provider.state.calls, 0);
    const second = await changes.prepare(input);
    advance(config.previewTtlMs + 1);
    await assert.rejects(
      () => changes.apply({ ...second, confirm: true }),
      /expired/,
    );
    const fresh = await changes.prepare(input);
    const result = await changes.apply({ ...fresh, confirm: true });
    assert.equal(result.applied, true);
    assert.equal(provider.state.actions[0].status, "COMPLETED");
    assert.equal(
      (await changes.apply({ ...fresh, confirm: true })).replayed,
      true,
    );
    assert.equal(provider.state.calls, 1);
  }));

test("requires matching action ownership and a retained evidence comment", async () =>
  withChanges(async ({ changes, provider }) => {
    await assert.rejects(
      () =>
        changes.prepare({
          operation: "action_update",
          planId: "1",
          actionId: "99",
          changes: { title: "Changed" },
        }),
      /belong/,
    );
    provider.state.comments = [];
    await assert.rejects(
      () =>
        changes.prepare({
          operation: "action_status",
          planId: "1",
          actionId: "3",
          changes: { status: "COMPLETED", commentId: "4" },
        }),
      /evidence comment/,
    );
  }));

test("records uncertain writes and refuses resend, including concurrent calls", async () =>
  withChanges(async ({ changes, provider }) => {
    provider.execute = async () => {
      provider.state.calls++;
      throw new Error("provider secret=hidden");
    };
    const preview = await changes.prepare({
      operation: "comment_add",
      planId: "1",
      changes: { text: "Validated the pilot: https://example.com/evidence" },
    });
    const results = await Promise.allSettled([
      changes.apply({ ...preview, confirm: true }),
      changes.apply({ ...preview, confirm: true }),
    ]);
    assert.ok(results.every((r) => r.status === "rejected"));
    assert.equal(provider.state.calls, 1);
    assert.ok(results.every((r) => !r.reason.message.includes("hidden")));
    await assert.rejects(
      () =>
        changes.prepare({
          operation: "comment_add",
          planId: "1",
          changes: { text: "Another attempt: https://example.com/evidence" },
        }),
      /unresolved remote write/,
    );
  }));

test("aborts for another process lock or a tampered preview", async () =>
  withChanges(async ({ changes, provider, root }) => {
    const preview = await changes.prepare({
      operation: "plan_update",
      planId: "1",
      changes: { title: "Reviewed title" },
    });
    const lock = path.join(root, "previews", "apply.lock");
    await fs.writeFile(lock, "another process");
    await assert.rejects(
      () => changes.apply({ ...preview, confirm: true }),
      /active/,
    );
    assert.equal(provider.state.calls, 0);
    await fs.rm(lock);
    const original = path.join(root, "previews", `${preview.previewId}.json`);
    const record = JSON.parse(await fs.readFile(original, "utf8"));
    record.changes.title = "Tampered";
    await fs.writeFile(original, JSON.stringify(record));
    await assert.rejects(
      () => changes.apply({ ...preview, confirm: true }),
      /integrity/,
    );
    assert.equal(provider.state.calls, 0);
  }));

test("aborts before any remote write if the durable audit intent fails", async () =>
  withChanges(async ({ provider, root }) => {
    const guarded = createRemoteChanges({
      config,
      provider,
      directory: path.join(root, "previews"),
      persist: async (file, record) => {
        if (record.state === "attempted")
          throw new Error("simulated audit disk failure");
        return atomicWriteJson(file, record);
      },
    });
    const preview = await guarded.prepare({
      operation: "plan_update",
      planId: "1",
      changes: { title: "Reviewed" },
    });
    await assert.rejects(
      () => guarded.apply({ ...preview, confirm: true }),
      /audit disk failure/,
    );
    assert.equal(provider.state.calls, 0);
  }));

test("distinguishes missing learning criteria from product status and prepares linked comments", () => {
  const result = assessAction({
    actionTitle: "Learn tool",
    actionDescription: "Complete a course",
    criteria: [
      { criterion: "Course certificate", result: "missing", evidence: [] },
    ],
  });
  assert.equal(result.data.recommendation, "keep_open");
  const supported = assessAction({
    actionTitle: "Register evidence",
    actionDescription: "Document a completed validation",
    criteria: [
      {
        criterion: "Pilot recorded",
        result: "evidenced",
        evidence: [
          {
            url: "https://example.com/pr/1",
            contribution: "Built the pilot",
            outcome:
              "Validated the critical flow; product rollout still pending",
          },
        ],
      },
    ],
  });
  assert.equal(supported.data.recommendation, "ready_for_review");
  assert.match(supported.data.suggestedComment, /https:\/\/example.com\/pr\/1/);
  assert.match(supported.warnings[0], /não foram consultados/);
});

test("validates new tool contracts and structured results without live credentials", async () => {
  const tools = createRemoteTools({ config, provider: fakeProvider() });
  for (const tool of tools) {
    assert.equal(tool.definition.inputSchema.additionalProperties, false);
    assert.ok(tool.definition.outputSchema);
    await assert.rejects(
      () => tool.handler({ unexpected: true }),
      /unrecognized/i,
    );
  }
  const result = await tools
    .find((t) => t.name === "guide_remote_plan_analyze")
    .handler({ planId: "1" });
  assert.equal(result.data.total, 1);
  assert.equal(result.data.completed, 0);
  assert.equal(
    tools.find((t) => t.name === "guide_remote_change_apply").policy.risk,
    "REMOTE_WRITE",
  );
});

test("executes and verifies the complete synthetic plan/action/comment workflow through the adapter", async () =>
  withChanges(async ({ root }) => {
    const plans = new Map();
    const actions = [];
    const comments = [];
    let writes = 0;
    let nextAction = 30;
    const http = async (route, { method = "GET", body, form } = {}) => {
      const url = new URL(route, "https://api.example.com");
      if (method === "GET" && url.pathname === "/me")
        return { employee: { id: 2 } };
      if (method === "GET" && /^\/idp\/plans\/\d+$/.test(url.pathname))
        return { plan: plans.get(Number(url.pathname.split("/").at(-1))) };
      if (method === "GET" && url.pathname === "/idp/actions/with-growth")
        return actions
          .filter((a) => a.plan === Number(url.searchParams.get("plan")))
          .map((action) => ({ action }));
      if (method === "GET" && url.pathname === "/idp/plans/comments")
        return comments
          .filter((c) => c.plan === Number(url.searchParams.get("plan")))
          .map((comment) => ({ comment }));
      writes++;
      if (method === "POST" && url.pathname === "/idp/plans") {
        assert.equal(body.plan.employee, 2);
        const plan = { ...body.plan, id: 10, status: "PENDING" };
        plans.set(10, plan);
        for (const a of body.actions)
          actions.push({ ...a, id: nextAction++, plan: 10, status: "PENDING" });
        return { plan };
      }
      if (method === "POST" && url.pathname === "/idp/actions") {
        const action = { ...body, id: nextAction++ };
        actions.push(action);
        return { action };
      }
      if (
        method === "PUT" &&
        /^\/idp\/actions\/\d+\/status$/.test(url.pathname)
      ) {
        Object.assign(
          actions.find((a) => a.id === Number(url.pathname.split("/").at(-2))),
          body,
        );
        return null;
      }
      if (method === "PUT" && /^\/idp\/actions\/\d+$/.test(url.pathname)) {
        Object.assign(
          actions.find((a) => a.id === body.id),
          body,
        );
        return null;
      }
      if (method === "PUT" && /^\/idp\/plans\/\d+$/.test(url.pathname)) {
        Object.assign(plans.get(10), body);
        return null;
      }
      if (method === "POST" && url.pathname === "/idp/plans/comments") {
        assert.equal(form, true);
        const comment = {
          id: 40,
          plan: body.form.plan,
          text: body.form.text,
          createdAt: "2026-10-01",
        };
        comments.push(comment);
        return { comment };
      }
      throw new Error("Unexpected synthetic API request");
    };
    const provider = createIdpProvider(http);
    const service = createRemoteChanges({
      config,
      provider,
      directory: path.join(root, "adapter-previews"),
    });
    const execute = async (input) => {
      const preview = await service.prepare(validateRemoteChange(input));
      return service.apply({ ...preview, confirm: true });
    };
    const created = await execute({
      operation: "plan_create",
      changes: {
        title: "Example plan",
        description: "Validate a measurable pilot",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        actions: [
          {
            title: "Pilot",
            description: "Record evidence",
            dueDate: "2026-11-01",
          },
        ],
      },
    });
    assert.equal(created.receipt.planId, "10");
    const added = await execute({
      operation: "action_create",
      planId: "10",
      changes: {
        title: "Review",
        description: "Document the result",
        dueDate: "2026-12-01",
      },
    });
    await execute({
      operation: "action_update",
      planId: "10",
      actionId: added.receipt.actionId,
      changes: { title: "Review evidence" },
    });
    await execute({
      operation: "plan_update",
      planId: "10",
      changes: { description: "Validate and document the pilot" },
    });
    const comment = await execute({
      operation: "comment_add",
      planId: "10",
      actionId: added.receipt.actionId,
      changes: {
        text: "Pilot validated with source: https://example.com/pr/1",
      },
    });
    await execute({
      operation: "action_status",
      planId: "10",
      actionId: added.receipt.actionId,
      changes: { status: "COMPLETED", commentId: comment.receipt.commentId },
    });
    assert.equal(
      actions.find((a) => String(a.id) === added.receipt.actionId).status,
      "COMPLETED",
    );
    assert.equal(writes, 6);
  }));
