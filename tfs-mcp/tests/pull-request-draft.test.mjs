import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const auditPath = path.join(os.tmpdir(), `tfs-mcp-draft-audit-${process.pid}.jsonl`);
Object.assign(process.env, {
  TFS_URL: "https://tfs.example.com", TFS_COLLECTION: "ExampleCollection",
  TFS_PROJECT: "ExampleProject", TFS_REPO: "example-repo",
  TFS_PAT: "synthetic-test-pat", TFS_AUDIT_LOG_PATH: auditPath,
});
const { toolCreatePR, toolUpdatePR } = await import("../src/tools/pull-request.js");
const metadata = {
  repo: "example-repo",
  titulo: "ajusta estado do pedido de revisao",
  resumo: "ajusta de forma segura o estado do pedido de revisao",
  confirm: true, reason: "validar estado solicitado", requestedBy: "teste automatizado",
};

async function withServer(initialDraft, callback, { ignoreWrite = false, concurrentEdit = false } = {}) {
  const previousFetch = globalThis.fetch;
  const requests = [];
  let pr = { pullRequestId: 42, title: metadata.titulo, description: "Descricao existente",
    sourceRefName: "refs/heads/feature/exemplo", targetRefName: "refs/heads/develop",
    isDraft: initialDraft, repository: { id: "example-repo", name: "example-repo" } };
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method ?? "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ method, body });
    assert(String(url).includes("/pullrequests"));
    if (method === "POST" || method === "PATCH") {
      if (concurrentEdit) pr = { ...pr, title: "Titulo humano concorrente", description: "Texto humano preservado sem padronizacao", workItemRefs: [{ id: "301" }] };
      if (!ignoreWrite) pr = { ...pr, ...body };
    } else assert.equal(method, "GET");
    return new Response(JSON.stringify(pr), { headers: { "Content-Type": "application/json" } });
  };
  try { await callback(requests, () => pr); }
  finally { globalThis.fetch = previousFetch; fs.rmSync(auditPath, { force: true }); }
}

for (const isDraft of [true, false]) {
  test(`state-only update to ${isDraft} preserves concurrent human metadata and links`, async () => {
    await withServer(!isDraft, async (requests, current) => {
      const result = await toolUpdatePR({ id: 42, repo: "example-repo", isDraft });
      assert.deepEqual(requests.map(request => request.method), ["GET", "PATCH", "GET"]);
      assert.deepEqual(requests[1].body, { isDraft });
      assert.equal(result.isDraft, isDraft);
      assert.equal(result.title, "Titulo humano concorrente");
      assert.equal(result.description, "Texto humano preservado sem padronizacao");
      assert.deepEqual(current().workItemRefs, [{ id: "301" }]);
    }, { concurrentEdit: true });
  });
}

for (const invalid of [
  {}, { titulo: metadata.titulo }, { resumo: metadata.resumo },
  { isDraft: true, titulo: metadata.titulo }, { isDraft: false, validacoes: ["valida comportamento"] },
  { isDraft: true, work_item_ids: [301] },
]) {
  test(`rejects empty or incomplete metadata update ${JSON.stringify(invalid)}`, async () => {
    await withServer(false, async requests => {
      await assert.rejects(toolUpdatePR({ id: 42, repo: "example-repo", ...invalid }), /titulo e resumo/);
      assert.equal(requests.length, 0);
    });
  });
}

for (const isDraft of [true, false]) {
  test(`creation sends isDraft=${isDraft} in the initial POST and confirms persisted state`, async () => {
    await withServer(!isDraft, async requests => {
      const result = await toolCreatePR({ ...metadata, source_branch: "feature/exemplo", target_branch: "develop", isDraft });
      assert.equal(result.isDraft, isDraft);
      assert.deepEqual(requests.map(request => request.method), ["POST", "GET"]);
      assert.equal(requests[0].body.isDraft, isDraft);
    });
  });
  test(`update changes ${!isDraft} to ${isDraft} and confirms persisted state`, async () => {
    await withServer(!isDraft, async requests => {
      const result = await toolUpdatePR({ ...metadata, id: 42, isDraft });
      assert.equal(result.isDraft, isDraft);
      assert.deepEqual(requests.map(request => request.method), ["GET", "GET", "PATCH", "GET"]);
      assert.equal(requests[2].body.isDraft, isDraft);
    });
  });
}

test("omitted flag preserves an existing Draft without an extra readback", async () => {
  await withServer(true, async (requests, current) => {
    await toolUpdatePR({ ...metadata, id: 42 });
    assert.equal(current().isDraft, true);
    assert.equal(Object.hasOwn(requests[2].body, "isDraft"), false);
    assert.equal(requests.length, 3);
  });
});

test("unconfirmed readback fails without corrective mutation or repeat", async () => {
  await withServer(false, async requests => {
    await assert.rejects(toolUpdatePR({ ...metadata, id: 42, isDraft: true }), /gravado.*não foi confirmado/);
    assert.equal(requests.filter(request => request.method === "PATCH").length, 1);
    assert.equal(requests.filter(request => request.method === "POST").length, 0);
  }, { ignoreWrite: true });
});

test("unconfirmed creation readback never creates another PR or patches state", async () => {
  await withServer(false, async requests => {
    await assert.rejects(toolCreatePR({ ...metadata, source_branch: "feature/exemplo", target_branch: "develop", isDraft: true }), /gravado.*não foi confirmado/);
    assert.deepEqual(requests.map(request => request.method), ["POST", "GET"]);
  }, { ignoreWrite: true });
});

test("update dry run previews both states without writing", async () => {
  await withServer(true, async requests => {
    const result = await toolUpdatePR({ ...metadata, id: 42, isDraft: false, dry_run: true });
    assert.equal(result.willMutate, false);
    assert.deepEqual(requests.map(request => request.method), ["GET"]);
    assert(JSON.stringify(result).includes('"isDraft":{"before":true,"after":false}'));
  });
});

test("dry run previews the requested state without writing", async () => {
  await withServer(false, async requests => {
    const result = await toolCreatePR({ ...metadata, source_branch: "feature/exemplo", target_branch: "develop", isDraft: true, dry_run: true });
    assert.equal(result.willMutate, false);
    assert.equal(requests.length, 0);
    assert(JSON.stringify(result).includes('"isDraft":true'));
  });
});

test("non-boolean Draft flag is rejected before any request", async () => {
  await withServer(false, async requests => {
    await assert.rejects(toolUpdatePR({ ...metadata, id: 42, isDraft: "true" }));
    assert.equal(requests.length, 0);
  });
});
