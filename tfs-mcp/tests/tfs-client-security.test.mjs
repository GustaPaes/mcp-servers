import assert from "node:assert/strict";
import test from "node:test";
import { assertTrustedTfsUrl } from "../src/tfs-client.js";
import { TFS_URL } from "../src/config.js";

test("absolute TFS requests never forward PAT credentials to another origin", () => {
  const trusted = new URL("/_apis/wit/fields", TFS_URL).toString();
  assert.equal(assertTrustedTfsUrl(trusted).origin, new URL(TFS_URL).origin);
  assert.throws(
    () => assertTrustedTfsUrl("https://attacker.example/api"),
    /origem nao confiavel/,
  );
  const configured = new URL(TFS_URL);
  configured.username = "embedded";
  assert.throws(() => assertTrustedTfsUrl(configured), /Credenciais embutidas/);
});
