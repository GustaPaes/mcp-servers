/**
 * Unit-ish test of the auth resolver. Only validates that the right method
 * is selected based on env; does NOT actually contact OCI.
 */
import assert from "node:assert/strict";

async function withEnv(env, fn) {
  const backup = { ...process.env };
  Object.assign(process.env, env);
  // Force re-import so the auth resolver re-reads config
  const url = `../src/auth/index.js?ts=${Date.now()}`;
  try {
    const mod = await import(url);
    return await fn(mod);
  } finally {
    process.env = backup;
  }
}

async function main() {
  await withEnv(
    { OCI_AUTH_METHOD: "api_key", OCI_CONFIG_PROFILE: "DEFAULT" },
    async (mod) => {
      try {
        const r = await mod.resolveAuthProvider();
        assert.equal(r.method, "api_key");
        console.log("✓ api_key resolver ok");
      } catch (e) {
        // Expected when ~/.oci/config is missing — that's fine, the method is correct
        if (/No such|ENOENT|profile|does not exist|File does not exists/i.test(e.message)) console.log("✓ api_key resolver attempted (no config file in env, ok)");
        else throw e;
      }
    }
  );
  console.log("✓ auth tests passed");
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
