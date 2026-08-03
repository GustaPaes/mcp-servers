# MCP configuration helpers

Small, dependency-free helpers for deterministic MCP configuration. The package
loads versioned JSON, rejects unknown fields when an allowlist is supplied,
supports custom validation and normalizes bounded environment values.

```js
import {
  readVersionedJsonConfigSync,
  toBoolean,
  toBoundedInteger,
} from "@gustapaes/mcp-config-kit";

const local = readVersionedJsonConfigSync(process.env.MCP_CONFIG_FILE, {
  allowedKeys: ["server", "profiles"],
  validate: (value) => Boolean(value.server),
});

const port = toBoundedInteger(process.env.MCP_PORT, {
  defaultValue: 3000,
  min: 1,
  max: 65_535,
  label: "MCP_PORT",
});
const enabled = toBoolean(process.env.MCP_ENABLED, { defaultValue: false });
```

Configuration objects are deeply frozen after validation. Keep secrets in
ignored `.env` or `local-private/` files rather than versioned JSON.

Run `npm test --workspace @gustapaes/mcp-config-kit` from the repository root.
