import assert from "node:assert/strict";
import test from "node:test";

process.env.TFS_MCP_CONFIG_FILE = "";
process.env.TFS_URL = "https://tfs.example.test";
process.env.TFS_COLLECTION = "Collection";
process.env.TFS_PROJECT = "Project";
process.env.TFS_PAT = "unit-test-pat";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

const wikiTree = {
  id: 1,
  path: "/",
  subPages: [
    {
      id: 10,
      path: "/Engineering",
      subPages: [
        {
          id: 957,
          path: "/Engineering/Code-Review",
          subPages: [
            { id: 969, path: "/Engineering/Code-Review/Evolucao-Contexto-e-Gate", subPages: [] },
          ],
        },
      ],
    },
  ],
};

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/_apis/wiki/wikis")) {
    return jsonResponse({
      value: [
        { id: "wiki-1", name: "Product.wiki", type: "projectWiki" },
        { id: "wiki-2", name: "Architecture.wiki", type: "projectWiki" },
      ],
    });
  }

  const wikiMatch = url.pathname.match(/\/_apis\/wiki\/wikis\/([^/]+)\/pages$/);
  const pageByIdMatch = url.pathname.match(/\/_apis\/wiki\/wikis\/([^/]+)\/pages\/(\d+)$/);
  if (pageByIdMatch) {
    const pageId = Number(pageByIdMatch[2]);
    if (pageId === 957) return jsonResponse({ id: 957, path: "/Engineering/Code-Review", content: "# Code Review\nConteudo completo." });
    return jsonResponse({ message: "page not found" }, 404);
  }
  if (!wikiMatch) return jsonResponse({ message: "not found" }, 404);
  const wikiId = decodeURIComponent(wikiMatch[1]);
  const pagePath = url.searchParams.get("path");
  const recursionLevel = url.searchParams.get("recursionLevel");
  const includeContent = url.searchParams.get("includeContent") === "true";

  if (recursionLevel === "full" && pagePath === "/") {
    return jsonResponse(wikiId === "wiki-1" ? wikiTree : { id: 2, path: "/", subPages: [] });
  }
  if (recursionLevel === "none" && pagePath === "/Engineering/Code-Review") {
    return jsonResponse({ id: 957, path: pagePath, content: includeContent ? "# Code Review\nConteudo completo." : undefined });
  }
  if (recursionLevel === "none" && pagePath === "/Engineering/Code-Review/Evolucao-Contexto-e-Gate") {
    return jsonResponse({ id: 969, path: pagePath, content: includeContent ? "# Evolucao\nGate seguro." : undefined });
  }
  return jsonResponse({ message: "page not found" }, 404);
};

const { cacheClearAll } = await import("../src/tfs-client.js");
const { toolWiki } = await import("../src/tools/infra.js");

test.beforeEach(() => cacheClearAll());

test("lists every configured wiki without requiring a search term", async () => {
  const result = await toolWiki({ action: "list" });
  assert.deepEqual(result.map((wiki) => wiki.name), ["Product.wiki", "Architecture.wiki"]);
});

test("legacy search traverses nested pages in every wiki", async () => {
  const result = await toolWiki({ search: "Code-Review", top: 20 });
  assert.deepEqual(
    result.map((page) => page.path),
    [
      "/Engineering/Code-Review",
      "/Engineering/Code-Review/Evolucao-Contexto-e-Gate",
    ]
  );
});

test("reads the complete content of an exact nested page", async () => {
  const result = await toolWiki({
    action: "read",
    wiki: "Product.wiki",
    path: "/Engineering/Code-Review",
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 957);
  assert.match(result[0].content, /Conteudo completo/);
});

test("resolves browser URLs and hyphenated slugs to the real nested path", async () => {
  const result = await toolWiki({
    action: "read",
    url: "https://tfs.example.test/Collection/Project/_wiki/wikis/Product.wiki/957/Code-Review",
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].path, "/Engineering/Code-Review");
  assert.match(result[0].content, /Conteudo completo/);
});

test("enumerates a full nested tree and reports truncation metadata", async () => {
  const result = await toolWiki({ action: "tree", wiki: "wiki-1", path: "/", top: 2 });
  assert.equal(result.totalPages, 4);
  assert.equal(result.returnedPages, 2);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.pages.map((page) => page.path), ["/", "/Engineering"]);

  const nextPage = await toolWiki({ action: "tree", wiki: "wiki-1", path: "/", skip: 2, top: 2 });
  assert.deepEqual(nextPage.pages.map((page) => page.path), [
    "/Engineering/Code-Review",
    "/Engineering/Code-Review/Evolucao-Contexto-e-Gate",
  ]);
  assert.equal(nextPage.truncated, false);
});

test("validates required fields for explicit actions", async () => {
  await assert.rejects(() => toolWiki({ action: "read" }), /path ou url e obrigatorio/);
  await assert.rejects(() => toolWiki({ action: "search" }), /search e obrigatorio/);
  await assert.rejects(
    () => toolWiki({ action: "tree", include_content: true, top: 201 }),
    /top deve ser no maximo 200/
  );
});
