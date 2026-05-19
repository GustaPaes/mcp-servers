/**
 * smoke.test.ts — minimal end-to-end check.
 *
 * Runs without going through the MCP protocol — calls the tool handlers
 * directly. Validates: launch chromium headless, goto example.com,
 * take screenshot, and close. Requires browsers installed (chromium).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { browserTools } from "../src/tools/browser.js";
import { pageTools } from "../src/tools/page.js";
import { visualTools } from "../src/tools/visual.js";
import { sessionManager } from "../src/session-manager.js";

test("launch -> goto -> screenshot -> close", async () => {
  const launched = (await browserTools.handlers.browser_launch({
    browser: "chromium",
    headless: true,
  })) as { session_id: string };
  assert.ok(launched.session_id, "session_id must be set");

  const opened = (await pageTools.handlers.page_new({ target_id: launched.session_id })) as {
    page_id: string;
  };
  assert.ok(opened.page_id, "page_id must be set");

  const goto = (await pageTools.handlers.page_goto({
    page_id: opened.page_id,
    url: "https://example.com",
    wait_until: "domcontentloaded",
  })) as { url: string; status: number | null };
  assert.match(goto.url, /example\.com/);
  assert.equal(goto.status, 200);

  const shot = (await visualTools.handlers.page_screenshot({
    page_id: opened.page_id,
    full_page: true,
  })) as { path: string; bytes: number };
  assert.ok(shot.path, "screenshot path returned");
  assert.ok(fs.existsSync(shot.path), "screenshot file exists on disk");
  assert.ok(shot.bytes > 1000, "screenshot has content");

  await browserTools.handlers.browser_close({ session_id: launched.session_id });
  await sessionManager.stop();
});
