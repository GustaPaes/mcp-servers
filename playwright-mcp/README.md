# Playwright MCP

[![Playwright](https://img.shields.io/badge/Playwright-1.x-2EAD33)](https://playwright.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

🇺🇸 **English** · 🇧🇷 [Português](#-português)

> Project-specific README. For the broader bilingual MCP collection see [`../README.md`](../README.md). For the operating policy LLMs must follow, see [`AGENTS.md`](./AGENTS.md).

---

> A multi-session, batteries-included Model Context Protocol server for [Playwright](https://playwright.dev/) browser automation. Lets an LLM drive **Chromium / Firefox / WebKit** (and native **Chrome / Edge** channels), record HAR / video / traces, mock network responses, and operate **multiple isolated browser sessions in parallel**.

Built in TypeScript. Stdio transport. Logs to stderr. JSON Schema raw on the wire. Uses the workspace's shared MCP contract pattern.

---

## When to use this server

For general browser automation, start with [Microsoft's official Playwright MCP](https://github.com/microsoft/playwright-mcp).
It supports isolated sessions, storage state, CDP and the browser extension.
This server is useful when one MCP connection needs to manage several named
browser sessions and contexts at runtime, with explicit tools for HAR, video,
tracing, request interception and local artifact controls. Session and artifact
limits are configured with `PWMCP_*` variables. Its `page_video_start` and
`network_log_start` compatibility tools only report recording status;
recording must be enabled when creating the context.

---

## Requirements

- Node.js **≥ 20**
- Windows / macOS / Linux
- For Chrome native channel (`channel: "chrome"`), have Google Chrome installed on the host. Otherwise the MCP uses Playwright's bundled chromium.

## Install

```powershell
cd "<repo-root>/playwright-mcp"
npm install
npm run build
npx playwright install chromium       # at minimum; add firefox/webkit/msedge if you need them
```

## Configuration

Copy `.env.example` to `.env` and tweak. Every variable is optional:

```env
LOG_LEVEL=info
PWMCP_DEFAULT_HEADLESS=false
PWMCP_DEFAULT_BROWSER=chromium
PWMCP_DEFAULT_CHANNEL=chrome           # use the system Chrome
PWMCP_DEFAULT_VIEWPORT=1366x768
PWMCP_DEFAULT_LOCALE=pt-BR
PWMCP_DEFAULT_TIMEZONE=America/Sao_Paulo
PWMCP_MAX_SESSIONS=5
PWMCP_SESSION_TTL_MINUTES=30
PWMCP_OUTPUT_DIR=                       # defaults to <repo>/output
PWMCP_MAX_ARTIFACT_BYTES=2000000        # large screenshots stay on disk instead of inline base64
PWMCP_MAX_ARTIFACT_FILE_BYTES=50000000  # hard cap for each generated file
PWMCP_MAX_OUTPUT_BYTES=500000000         # total local artifact quota
PWMCP_MAX_NETWORK_BODY_BYTES=65536      # cap network bodies returned to the MCP client
PWMCP_STRICT=true
PWMCP_BLOCK_PRIVATE_NETWORKS=true        # block loopback, link-local and private IPs after DNS
PWMCP_ALLOWED_HOSTS=                     # optional exact hosts or *.example.com, comma-separated
PWMCP_ALLOW_EVAL=false                   # opt in only for a trusted local client
PWMCP_ALLOW_SECRET_REVEAL=false         # headers, cookies and bodies stay redacted
PWMCP_ALLOW_BROWSER_INSTALL=false       # opt in before browser_install may change the host
PWMCP_ALLOWED_FILE_ROOTS=               # defaults to ./local-private/uploads
PWMCP_ALLOWED_PROFILE_ROOTS=            # defaults to ./local-private/profiles
PWMCP_EVAL_TIMEOUT_MS=5000
PWMCP_ACTION_TIMEOUT_MS=10000
PWMCP_NAVIGATION_TIMEOUT_MS=30000
```

## Wire it into your MCP client

See `mcp.json.example` for ready-to-paste blocks for **Claude Desktop**, **OpenCode** and **Cline**.

Minimal Claude Desktop snippet (`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "playwright-mcp": {
      "command": "node",
      "args": ["<repo-root>/playwright-mcp/dist/index.js"],
      "env": { "PWMCP_DEFAULT_CHANNEL": "chrome" }
    }
  }
}
```

OpenCode (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "playwright-mcp": {
      "type": "local",
      "command": ["node", "<repo-root>/playwright-mcp/dist/index.js"],
      "enabled": true
    }
  }
}
```

## Run / test

```powershell
npm start            # runs dist/index.js (stdio)
npm run dev          # runs src/index.ts via tsx (hot reload-ish)
npm test             # smoke test: launch chromium -> goto example.com -> screenshot -> close
```

Output (screenshots, videos, traces, HAR, PDFs, downloads, storage state) goes to `./output/<subdir>/` by default.

---

## Tools

All tools follow `<domain>_<verb>_<resource>` naming. Most accept an optional `page_id`; if omitted, they target the most-recently-used page across all sessions.

### Sessions / contexts

| Tool | Purpose |
|------|---------|
| `browser_launch` | Launch a new session (chromium/firefox/webkit + chrome/msedge channels). Returns `session_id`. |
| `browser_close` | Close a session (frees browser + all its contexts/pages). |
| `browser_list` | List active sessions with idle time. |
| `context_new` | Open a new isolated `BrowserContext` inside a session (parallel logged-in users). |
| `context_close` | Close a single `BrowserContext`. |
| `context_storage_state` | Save (`mode=save`) or load (`mode=load`) cookies + localStorage inside allowed roots. |
| `context_recording_status` | Report HAR/video settings and completed artifact paths for a context. |
| `browser_install` | Run `npx playwright install <browser>` only after explicit host-level opt-in. |

### Pages / navigation

| Tool | Purpose |
|------|---------|
| `page_new` | Open a tab in a session/context. |
| `page_close` | Close a tab. |
| `page_list` | List all open pages. |
| `page_goto` | Navigate to URL with `wait_until` and `timeout`. |
| `page_reload` / `page_back` / `page_forward` | History navigation. |
| `page_wait_for_url` | Wait for URL match (string / glob / `/regex/flags`). |
| `page_wait_for_selector` | Wait for selector to be `attached`/`detached`/`visible`/`hidden`. |
| `page_wait_for_load_state` | Wait for `load`/`domcontentloaded`/`networkidle`. |

### Interaction

| Tool | Purpose |
|------|---------|
| `page_click` / `page_dblclick` / `page_hover` | Mouse actions with `button`, `modifiers`, `position`, `force`. |
| `page_focus` / `page_blur` | Focus management. |
| `page_fill` | Set value of a form field (clears first). |
| `page_type` | Character-by-character typing with `delay`. |
| `page_press` | Press a key combo (`Control+S`, `ArrowDown`, ...). |
| `page_select_option` | Pick options in `<select>` by `value`/`label`/`index`. |
| `page_check` / `page_uncheck` / `page_set_checked` | Checkbox / radio. |
| `page_drag_and_drop` | Drag from selector to selector with positions. |
| `page_set_input_files` | Upload one or many files to `<input type=file>`. |

### Extraction

| Tool | Purpose |
|------|---------|
| `page_text_content` / `page_inner_text` / `page_inner_html` | Read element text/HTML. |
| `page_get_attribute` | Read an HTML attribute. |
| `page_console_messages` | Read captured console messages and page errors for frontend diagnostics. |
| `page_evaluate` | Run an opt-in JS function in the page; disabled unless `PWMCP_ALLOW_EVAL=true`, filtered and time-bounded. |
| `page_query_selector_all` | Up to N matches with tag/text/bbox — great for scanning. |
| `page_accessibility_snapshot` | YAML ARIA snapshot in `mode:"ai"` with `[ref=eN]` refs (the LLM-friendly view of the page). |
| `page_get_url` / `page_get_title` / `page_get_cookies` | Basic page state. |

### Visual / artifacts

| Tool | Purpose |
|------|---------|
| `page_screenshot` | PNG/JPEG, full-page or clipped, optional size-capped base64. Saved under `./output/screenshots/`. |
| `page_pdf` | Chromium PDF rendering. Saved under `./output/pdf/`. |
| `page_video_start` / `page_video_stop` | Video (must enable `record_video` on `context_new`). |
| `tracing_start` / `tracing_stop` | Playwright `trace.zip` — open at https://trace.playwright.dev/. |

### Network

| Tool | Purpose |
|------|---------|
| `page_route` | Intercept requests by glob or `/regex/`. Action: `abort` / `fulfill` / `continue` (with overrides). |
| `page_unroute` | Remove one route or all of them. |
| `page_wait_for_request` / `page_wait_for_response` | Wait for a specific call; sensitive headers and bodies are redacted by default and size-capped. |
| `network_log_status` / `network_log_stop` | Inspect HAR state; enable via `record_har` on `context_new` and close the context to flush. `network_log_start` remains a deprecated status alias. |

### Advanced

| Tool | Purpose |
|------|---------|
| `page_eval_in_frame` | Run JS inside an `<iframe>` selected by `name` / `url_contains` / `index`. |
| `page_handle_dialog` | Auto-accept/dismiss `alert`/`confirm`/`prompt`/`beforeunload`, with optional prompt text. |
| `browser_stealth` | Apply a light "human profile" init-script to a context (see Limitations). |
| `mcp_status` | Health: version, RAM, uptime, sessions/contexts/pages, browsers installed. |

---

## Five example LLM prompts

1. **Quick screenshot of any URL**

   > Open `https://example.com` with Chrome (system channel) and give me a full-page screenshot.

2. **Persisted login**

   > Launch chromium with `user_data_dir=./local-private/profiles/portal-x`, go to `https://portal.example.com/login`, fill the form (username `user@example.com`, password from this prompt), wait for `**/dashboard`, then save the storage state.

3. **Capture network of an SPA**

   > Open a new context with `record_har=true`, navigate to `https://app.example.com`, click the "Reports" link, wait for the `**/api/reports` response, then call `network_log_stop` and tell me where the HAR is.

4. **Mock an API response**

   > Install a route on `**/api/user` that fulfills with `{ "name": "Test", "role": "admin" }`. Then reload the page and confirm the username appears.

5. **Run two isolated browser flows**

   > Launch two sessions; in each, open `https://example.com`, capture the accessibility snapshot and screenshot, then compare the titles and saved artifact paths.

---

## Architecture

```
playwright-mcp/
├── src/
│   ├── index.ts             # stdio entry, signal handlers
│   ├── server.ts            # Server (low-level) + TOOL_DEFS dispatch + withToolMetadata
│   ├── session-manager.ts   # pool of browsers/contexts/pages, TTL, cleanup, limits
│   ├── config.ts            # dotenv-backed Object.freeze config (single source)
│   ├── logger.ts            # pino → stderr (NEVER stdout — protocol channel)
│   ├── output-dir.ts        # ensures ./output/{screenshots,videos,traces,har,pdf,...}
│   ├── types.ts
│   ├── safety/
│   │   ├── safe-eval.ts     # filters page_evaluate sources
│   │   └── selectors.ts     # blocks chrome:// / about:/file:// in --strict
│   ├── lib/
│   │   ├── retry.ts         # 3 attempts, 200/500/1000 ms backoff
│   │   └── stealth.ts       # init-script applied via browser_stealth
│   └── tools/
│       ├── browser.ts       # launch/close/list, context_*, install
│       ├── page.ts          # page lifecycle, navigation, waits
│       ├── interaction.ts   # click/type/fill/select/check/drag/upload
│       ├── extraction.ts    # text/html/attribute/evaluate/qsa/aria/url/title/cookies
│       ├── visual.ts        # screenshot/pdf/video/tracing
│       ├── network.ts       # route/unroute/wait_for_*/HAR
│       └── advanced.ts      # eval_in_frame/handle_dialog/stealth/mcp_status
├── tests/
│   ├── smoke.test.ts
│   └── security.test.ts
├── output/                  # generated artifacts
└── logs/
```

**Pattern choice:** low-level `Server` + `setRequestHandler` + dispatch table + JSON Schema raw + `withToolMetadata` — same as `tfs-mcp` and `career-development-mcp`. Zod is used internally only when handler logic needs sharper validation; the public contract is the JSON Schema in `TOOL_DEFS`.

---

## Limitations / non-goals

- **Anti-bot bypass**: `browser_stealth` is a light tweak (UA, `navigator.webdriver`, languages, `chrome.runtime`). For Cloudflare Turnstile, DataDome, PerimeterX, etc. use a dedicated stack — out of scope.
- **`page_evaluate` is not a security sandbox.** It is disabled by default and requires `PWMCP_ALLOW_EVAL=true`. Playwright executes the function in the browser; the filter is only defense in depth.
- Main navigation and subresources are checked against `PWMCP_ALLOWED_HOSTS` and private-network rules after DNS resolution. A private destination is allowed only when its hostname/IP is explicitly listed. Keep the allowlist narrow; DNS prechecks reduce SSRF exposure but are not a complete sandbox against DNS rebinding.
- **HAR / video are context-level features in Playwright.** Enable them on `context_new`. `network_log_status` and `page_video_start` report status for an already-recording context.
- **No remote CDP attach** in v1 (`--cdp-endpoint` of MS MCP). Backlog.
- **Persistent sessions can't host extra contexts** (Playwright limitation): a `user_data_dir` launch returns a single persistent context which IS the only context for that session.
- Persistent profiles are confined to `PWMCP_ALLOWED_PROFILE_ROOTS`; use the ignored `local-private/profiles/` directory for real logins.
- Network headers, post data, response bodies and cookie values are redacted by default. Enable `PWMCP_ALLOW_SECRET_REVEAL` only temporarily for a trusted local client.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `browser_launch` fails with "Executable doesn't exist" | Run `browser_install` (or `npx playwright install <browser>`). For native Chrome, install Google Chrome first. |
| Screenshots empty / process hangs on Linux | Add `args: ["--no-sandbox"]` to `browser_launch` or run headless. |
| `max sessions reached` | Close an old session with `browser_close` or raise `PWMCP_MAX_SESSIONS`. |
| Output dir permission errors | Set `PWMCP_OUTPUT_DIR` to a writable absolute path. |
| Logs polluting stdout (breaks MCP) | This MCP writes ALL logs to stderr. If you see JSON lines on the client's stdout pipe, it's almost certainly a different process. |
| `page_evaluate rejected: forbidden token matched` | Rewrite the function without `eval` / `Function(...)` / dynamic `import` / `chrome.webRequest`. |

## License

MIT — see [`../LICENSE`](../LICENSE).

---

## 🇧🇷 Português

> **MCP server multi-sessão para [Playwright](https://playwright.dev/).** Permite que um LLM controle **Chromium / Firefox / WebKit** (e canais nativos **Chrome / Edge**), grave HAR / vídeo / traces, mocke respostas de rede e opere **múltiplas sessões isoladas de browser em paralelo**.

### Por que existe (vs `@playwright/mcp` da Microsoft)

O `@playwright/mcp` oficial é excelente para sessão única com snapshot. **Este MCP resolve outro conjunto de problemas:**

- ✅ Rodar **N browsers em paralelo** (sessões separadas) até `PWMCP_MAX_SESSIONS` (default 5)
- ✅ Salvar / restaurar estado de login programaticamente em runtime (`context_storage_state`)
- ✅ Capturar **HAR** completo via `record_har` + `network_log_*`
- ✅ Gravação de **vídeo** (`record_video` + `page_video_*`)
- ✅ **Tracing** Playwright (`trace.zip`) via `tracing_start` / `tracing_stop`
- ✅ **Interceptação / mock** programática (`page_route`)
- ✅ Helper de execução em **iframe** (`page_eval_in_frame`)
- ✅ Toggle de profile **stealth** (`browser_stealth`)
- ✅ Healthcheck (`mcp_status`)

### Requisitos

- **Node.js ≥ 20**
- **Windows / macOS / Linux**
- Para canal nativo Chrome (`channel: "chrome"`), tenha Google Chrome instalado. Senão, o MCP usa o Chromium bundled do Playwright.

### Instalação

```powershell
cd "<repo-root>/playwright-mcp"
npm install
npm run build
npx playwright install chromium       # mínimo; adicione firefox/webkit/msedge se quiser
```

### Configuração nos clientes MCP

Veja a seção [Wire it into your MCP client](#wire-it-into-your-mcp-client) acima — os snippets para OpenCode, Claude Desktop, Claude Code, Cursor, Cline, Codex CLI e Continue funcionam em qualquer idioma. Veja também [`mcp.json.example`](./mcp.json.example).

### Política operacional

Leia [`AGENTS.md`](./AGENTS.md) — a política executável classifica as tools como `READ`, `SECRET_READ`, `LOCAL_STATE`, `EXECUTION`, `REMOTE_WRITE` ou `DESTRUCTIVE` e exige confirmação de acordo com a consequência real da ação.

### Licença

MIT — veja [`../LICENSE`](../LICENSE).
