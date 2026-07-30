# AGENTS.md — Operating policy for the Playwright MCP

> Use this document as the **playbook** an LLM (or human operator) should consult before invoking tools. It defines safety classes, default behaviors, and confirmation templates.

## Tool safety classification

Each tool below is tagged 🟢 READ / 🟡 WRITE / 🔴 DESTRUCTIVE. Match the user's intent against this list and confirm before invoking 🟡/🔴 in production-adjacent contexts.

### 🟢 READ (no side effects on remote systems)
`browser_list`, `page_list`, `page_console_messages`, `page_text_content`, `page_inner_text`, `page_inner_html`, `page_get_attribute`, `page_query_selector_all`, `page_accessibility_snapshot`, `page_get_url`, `page_get_title`, `page_get_cookies`, `page_screenshot`, `page_pdf`, `mcp_status`.

(Note: these still cost local CPU/RAM and may write artifacts to `./output/`.)

### 🟡 WRITE (state changes — local sessions or remote sites)
`browser_launch`, `context_new`, `context_storage_state`, `page_new`, `page_goto`, `page_reload`, `page_back`, `page_forward`, `page_wait_*`, `page_click`, `page_dblclick`, `page_hover`, `page_focus`, `page_blur`, `page_fill`, `page_type`, `page_press`, `page_select_option`, `page_check`, `page_uncheck`, `page_set_checked`, `page_drag_and_drop`, `page_set_input_files`, `page_evaluate`, `page_eval_in_frame`, `page_handle_dialog`, `page_route`, `page_unroute`, `page_wait_for_request`, `page_wait_for_response`, `network_log_start`, `tracing_start`, `tracing_stop`, `page_video_start`, `page_video_stop`, `browser_stealth`, `browser_install`.

These can submit forms, place orders, change settings on the target site. They CAN have real-world consequences. Always confirm intent.

### 🔴 DESTRUCTIVE (closes / discards in-memory state)
`browser_close`, `context_close`, `page_close`, `network_log_stop` (when `close_context=true`).

## Default-deny patterns

The LLM should refuse — or escalate — when:

1. The user asks to **target a financial / banking / government** portal AND the request includes form submissions or transfers without an explicit user confirmation in the same turn.
2. The user requests `page_evaluate` with code that touches `localStorage`, `sessionStorage`, `IndexedDB`, or `document.cookie` for a third-party origin without explanation.
3. The user requests `page_set_input_files` pointing at files **outside the workspace**.
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
- `page_evaluate` is bounded by `PWMCP_EVAL_TIMEOUT_MS` (default 5 s). For long-running scripts, split into smaller steps that the LLM can supervise.

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
