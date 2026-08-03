# MCP runtime helpers

Shared, dependency-free runtime primitives used by the MCP servers in this
workspace. The package is private because the repository consumes it through a
local workspace dependency.

## Capabilities

- Canonical tool risk classes, MCP annotations and manifest drift validation.
- Identifier and symlink-aware filesystem confinement.
- Atomic JSON persistence and serialized read-modify-write execution.
- Header, structured-value and text redaction for common credential formats.

```js
import {
  TOOL_RISK,
  annotationsForRisk,
  assertToolManifest,
  resolveInsideAny,
} from "@gustapaes/mcp-runtime";

const policies = {
  service_status: { risk: TOOL_RISK.READ },
};

assertToolManifest({ definitions, handlers, policies, label: "service-mcp" });
const annotations = annotationsForRisk(policies.service_status.risk);
const safePath = resolveInsideAny(allowedRoots, requestedPath);
```

Filesystem confinement reduces accidental traversal and symlink escapes, but a
caller must still avoid time-of-check/time-of-use races when an untrusted actor
can replace filesystem entries concurrently.

Run `npm test --workspace @gustapaes/mcp-runtime` from the repository root.
