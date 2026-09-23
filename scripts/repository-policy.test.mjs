import assert from "node:assert/strict";
import test from "node:test";

import { inspectPublishableText, isPrivatePublishablePath } from "./repository-policy.mjs";

test("accepts neutral relative examples", () => {
  assert.deepEqual(
    inspectPublishableText("server/README.md", "cd ./server\ncontact user@example.com"),
    [],
  );
});

test("rejects environment-specific absolute paths", () => {
  assert.match(
    inspectPublishableText("server/README.md", String.raw`cd C:\Workspace\server`)[0],
    /absolute path/,
  );
  assert.match(
    inspectPublishableText("server/README.md", "cd /home/operator/server/")[0],
    /absolute path/,
  );
});

test("rejects private identities and credential-like values", () => {
  const corporateEmail = ["person", "corp.test"].join("@");
  const token = ["ghp", "123456789012345678901234567890"].join("_");
  assert.match(inspectPublishableText("fixture.json", corporateEmail)[0], /email/);
  assert.match(
    inspectPublishableText("fixture.json", token)[0],
    /credential/,
  );
});

test("rejects private and credentialed endpoints without flagging examples", () => {
  assert.match(inspectPublishableText("README.md", "https://intranet.corp/api")[0], /private or credentialed URL/);
  assert.match(inspectPublishableText("README.md", "http://10.20.30.40/api")[0], /private or credentialed URL/);
  assert.match(inspectPublishableText("README.md", "https://operator:token@example.com/api")[0], /private or credentialed URL/);
  assert.deepEqual(inspectPublishableText("README.md", "https://tfs.example.com/api"), []);
});

test("supports private organization terms without hardcoding them", () => {
  const findings = inspectPublishableText("README.md", "ExampleOrganization internal flow", {
    forbiddenTerms: ["ExampleOrganization"],
  });
  assert.match(findings[0], /organization-specific marker/);
  assert.deepEqual(
    inspectPublishableText("README.md", "forge reusable tools", { forbiddenTerms: ["org"] }),
    [],
  );
});

test("detects private and generated publishable paths", () => {
  assert.equal(isPrivatePublishablePath("server/local-private/config.json"), true);
  assert.equal(isPrivatePublishablePath("server/data/state.json"), true);
  assert.equal(isPrivatePublishablePath("server/output/.gitkeep"), false);
  assert.equal(isPrivatePublishablePath("server/.env.example"), false);
});
