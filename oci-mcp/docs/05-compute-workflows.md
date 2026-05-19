# 05 — Compute & Functions Workflows

Compute (VMs, BMs) is delegated to Oracle's official `oci-compute-mcp-server`.
This document covers the patterns we use most and the OCI Functions tools
implemented natively in `oci-extras-mcp`.

## Compute (delegated)

Tools live under the `oci-compute` server (configured automatically by the
client snippets in `config/`).

Common flows:

- `compute_list_instances` → `compute_get_instance` → `compute_instance_action`
  (start/stop/reset).
- For shape changes: stop → `compute_update_instance { shape: ... }` → start.
- Always combine with `oci-networking` for VNIC attachments and subnet lookups.

## Functions (native)

`oci-extras-mcp` exposes the OCI Functions service:

| Tool                   | Purpose                                |
|------------------------|----------------------------------------|
| `fn_list_applications` | List apps in a compartment             |
| `fn_create_application`| Create an app (sets owner tag)         |
| `fn_delete_application`| Delete (destructive)                   |
| `fn_list_functions`    | List functions in an app               |
| `fn_create_function`   | Register a function (image+memory)     |
| `fn_invoke`            | Invoke; returns body + statusCode      |
| `fn_delete_function`   | Delete a single function               |

### Recipe — invoke a function with a JSON payload

```text
fn_invoke {
  functionId,
  payload: { "user": 42 },
  contentType: "application/json"
}
```

Response includes `statusCode`, `headers`, and `body` (UTF-8 if textual,
base64 otherwise).

### Recipe — promote a new image

```text
1. Build & push to OCIR (handled outside this MCP — use docker/oras).
2. fn_update_function { functionId, image: "ocir.../app/fn:v2" }
3. fn_invoke for smoke.
```

(`fn_update_function` is a thin wrapper; falls back to delete+create when the
service rejects in-place change.)

## Tip

Pair `fn_invoke` with `streaming_tail_oci_log` against the function's log
group to watch invocations live.
