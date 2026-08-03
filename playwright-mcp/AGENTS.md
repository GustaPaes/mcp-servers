# AGENTS.md — Operating policy for the Playwright MCP

> This file complements the [workspace-wide instructions](../AGENTS.md). Their
> neutrality, reusability and local-content separation rules are mandatory.

> Use this document as the **playbook** an LLM (or human operator) should consult before invoking tools. It defines safety classes, default behaviors, and confirmation templates.

## Tool safety classification

[`src/tool-policy.ts`](./src/tool-policy.ts) is the executable source of truth.
The server refuses to start when a definition, handler or risk policy is missing,
and contract tests verify annotations and schemas. Do not maintain a second
ad-hoc classification in code.

### READ

`browser_list`, `page_list`, `page_wait_for_url`, `page_wait_for_selector`,
`page_wait_for_load_state`, `page_console_messages`, `page_text_content`,
`page_inner_text`, `page_inner_html`, `page_get_attribute`,
`page_query_selector_all`, `page_accessibility_snapshot`, `page_get_url`,
`page_get_title`, `context_recording_status`, `page_video_start`,
`network_log_status`, `network_log_start` (deprecated status alias), `mcp_status`.

### SECRET_READ

`page_get_cookies`, `page_wait_for_request`, `page_wait_for_response`.

Values remain redacted unless both the runtime opt-in and the user's current,
specific intent allow disclosure. Never infer permission from a previous call.

### LOCAL_STATE

`browser_launch`, `context_new`, `context_storage_state`, `browser_install`,
`page_new`, `page_screenshot`, `page_pdf`, `tracing_start`, `tracing_stop`,
`page_unroute`, `browser_stealth`.

These change only the local host/session by design. Routine session and artifact
operations do not need confirmation when explicitly requested. `browser_install`
still requires `PWMCP_ALLOW_BROWSER_INSTALL=true` because it changes the host.

### EXECUTION

`page_goto`, `page_reload`, `page_back`, `page_forward`, `page_hover`,
`page_focus`, `page_blur`, `page_fill`, `page_type`, `page_select_option`,
`page_check`, `page_uncheck`, `page_set_checked`, `page_evaluate`,
`page_eval_in_frame`, `page_handle_dialog`, `page_route`.

Execution does not automatically require a confirmation. Confirm only when the
actual target/action can create an external consequence. Evaluation tools are
disabled by default and require `PWMCP_ALLOW_EVAL=true` for a trusted client.

### REMOTE_WRITE

`page_click`, `page_dblclick`, `page_press`, `page_drag_and_drop`,
`page_set_input_files`.

An ordinary, explicitly requested UI action may run directly. Immediately before
payment, submission, publication, deletion, permission/settings changes or other
consequential actions, show the exact page, selector/control and expected effect.

### DESTRUCTIVE

`browser_close`, `context_close`, `page_close`, `page_video_stop`,
`network_log_stop`.

These discard local runtime state. Confirm only when unsaved session state or an
unfinished artifact could be lost; they do not inherently mutate the remote site.

## Default-deny patterns

The LLM should refuse — or escalate — when:

1. The user asks to **target a financial / banking / government** portal AND the request includes form submissions or transfers without an explicit user confirmation in the same turn.
2. The user requests evaluation while `PWMCP_ALLOW_EVAL` is disabled, or code touches browser credential stores.
3. The user requests `page_set_input_files` outside `PWMCP_ALLOWED_FILE_ROOTS`, which defaults to `local-private/uploads/`, or targets a secret-like file.
4. The user requests a `page_goto` to `file://`, `chrome://`, `about:` or `view-source:` URLs (these are blocked when `PWMCP_STRICT=true`).
5. The user wants to scrape a site whose ToS visibly forbids automation (the LLM should warn, not silently comply).

## Recommended confirmation template

> **About to:** click the "Confirm payment" button on `https://store.example.com/checkout?id=123`.
> **Side effect:** this will submit the order; it will likely charge the saved card and cannot be undone via this MCP.
> **Proceed?** (yes / no / dry-run)

For **dry-run**, prefer:
1. `page_screenshot` first.
2. `page_accessibility_snapshot` to confirm element identity.
3. Ask the user to approve the exact selector before clicking.

## Resource discipline

- Always pair a `browser_launch` with an eventual `browser_close`. Idle TTL (`PWMCP_SESSION_TTL_MINUTES`) is a backstop, not a strategy.
- For batch work, prefer **one session, multiple contexts** (`context_new`) over many sessions.
- HAR / video / tracing files grow fast — sweep `./output/` periodically.
- Respect per-file and total quotas. An artifact exceeding the configured cap is removed instead of being returned as a partial success.
- `page_evaluate` is bounded by `PWMCP_EVAL_TIMEOUT_MS` (default 5 s). For long-running scripts, split into smaller steps that the LLM can supervise.
- Keep `PWMCP_BLOCK_PRIVATE_NETWORKS=true`. A private hostname/IP is usable only when explicitly present in `PWMCP_ALLOWED_HOSTS`. DNS prechecks reduce SSRF exposure but are not a complete DNS-rebinding sandbox, so keep the allowlist narrow and trusted.

## Logging & privacy

- The MCP writes structured logs to stderr (and optionally to `PWMCP_LOG_FILE`). Logs include tool names and elapsed time but **not** tool arguments by default.
- HAR captures **request/response bodies** including auth headers and tokens. Treat HAR files as sensitive; do not commit them.
- `context_storage_state` JSON files contain cookies and localStorage values. Same warning.

## Public/private boundary

- Keep real browser profiles, storage states, HAR files, screenshots, downloads, internal URLs and organization-specific automation under `local-private/` or `output/`; both are ignored by Git.
- Commit only neutral examples and reusable browser behavior. Company portal selectors, credentials, exports and one-off scripts must never be added to tracked `src/`, `tests/`, `docs/` or example files.
- Persistent profiles must use a directory inside `PWMCP_ALLOWED_PROFILE_ROOTS`. Prefer `local-private/profiles/<profile-name>` and never point the MCP at a personal Chrome or Edge profile.

## Escalation

When uncertain, prefer:
1. `mcp_status` — confirm the runtime is healthy.
2. `page_accessibility_snapshot` — show the user what the page looks like to the model.
3. Ask one targeted question rather than guessing.
