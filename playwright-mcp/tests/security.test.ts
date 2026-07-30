import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { redactHeaders, redactTextPayload } from "@gustapaes/mcp-runtime";
import { config } from "../src/config.js";
import { browserTools, resolveProfilePath } from "../src/tools/browser.js";

test("redacts credentials from captured network data", () => {
  const headers = redactHeaders({
    authorization: "Bearer secret-token",
    cookie: "session=secret",
    accept: "application/json",
  });
  assert.equal(headers.authorization, "[REDACTED]");
  assert.equal(headers.cookie, "[REDACTED]");
  assert.equal(headers.accept, "application/json");
  assert.equal(
    redactTextPayload('{"access_token":"secret","name":"safe"}'),
    '{"access_token":"[REDACTED]","name":"safe"}',
  );
});

test("persistent profiles stay inside configured roots", () => {
  const allowed = path.join(config.allowedProfileRoots[0]!, "test-profile");
  assert.equal(resolveProfilePath(allowed), path.resolve(allowed));
  assert.throws(
    () => resolveProfilePath(path.resolve(config.repoRoot, "..", "outside-profile")),
    /outside the configured allowed roots/,
  );
});

test("browser installation is disabled by default", async () => {
  if (config.allowBrowserInstall) return;
  await assert.rejects(
    () => browserTools.handlers.browser_install({}),
    /PWMCP_ALLOW_BROWSER_INSTALL/,
  );
});
