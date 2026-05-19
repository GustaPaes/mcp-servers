# Best Practices — Playwright MCP

Practical patterns to get reliable automations out of this MCP.

## Locator strategy

Prefer in this order:

1. **`role=` selectors** (`role=button[name="Save"]`) — survive style/markup changes.
2. **`data-testid`** when the team owns the page.
3. **`text=` selectors** (`text="Continue"`) for unambiguous labels.
4. **CSS** (`.user-list > li:nth-child(2)`) — fragile, last resort.
5. Avoid raw XPath unless the DOM forces it.

For LLMs: **always run `page_accessibility_snapshot` (mode `"ai"`) first** to discover `[ref=eN]` references — they are the most stable identifiers Playwright exposes.

## Waiting

- Don't `setTimeout`. Use `page_wait_for_selector`, `page_wait_for_load_state`, `page_wait_for_url`, or `page_wait_for_response`.
- For SPAs that render after XHR, wait on `state: "networkidle"` **only** as a last resort (it can hang on long-poll sockets). Better: `page_wait_for_response` on the actual API URL.

## Sessions

- One session per **browser identity** (different cookies/profile).
- One context inside a session per **logical user** (parallel logins of the same site).
- Reuse pages across navigations when possible — opening tabs is cheap, but each open page costs ~30–60 MB of RAM.

## Authentication

- Persistent profile (`user_data_dir`): easiest, survives MCP restarts. **Caveat:** only one Playwright process can own a `user_data_dir` at a time.
- Storage state file (`context_storage_state` save → `context_new` with `storage_state_path`): more flexible, lets you snapshot a logged-in state and replay it from any context.

```text
1. Launch fresh, log in manually (or scripted)
2. context_storage_state mode=save -> ./output/storage/portal.json
3. Next runs: context_new(storage_state_path: "./output/storage/portal.json")
```

## Network

- HAR is the right tool for "what does this page actually request?". Enable it on context creation, do the action, then close the context to flush.
- `page_route` with `action: "fulfill"` is the right tool for **mocking** a backend in a hostile or flaky environment.
- `page_route` with `action: "abort"` is the right tool for **blocking** trackers/heavy assets in screenshots.

## Screenshots vs accessibility snapshot

| You want to… | Use |
|--------------|-----|
| Show the user what the page looks like | `page_screenshot` |
| Decide what to click next | `page_accessibility_snapshot` (much smaller, structured) |
| Compare two states pixel-perfectly | `page_screenshot` of the same `clip` |
| Audit form labels / a11y | `page_accessibility_snapshot` |

## Iframes

`page_click("button.submit")` will not click a button inside an `<iframe>`. Resolve the frame first with `page_eval_in_frame`, or use Playwright's frame locators directly via `page_evaluate` if needed. The MCP exposes `page_eval_in_frame` for the common case.

## Failure modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Timeout 30000ms exceeded` on `page_goto` | Network or `wait_until: "load"` blocked by an analytics tag | Use `wait_until: "domcontentloaded"` and then `page_wait_for_selector` on a real element |
| `Element is not visible` | Element exists but offscreen / display:none | `page_wait_for_selector` with `state: "visible"`, or scroll via `page_evaluate` |
| Click goes through but page doesn't react | SPA reattaches the listener after re-render | Try `page_click` again with `force: true`, or wait for the API response that follows |
| Cookies / localStorage missing on next run | Storage state JSON only restores cookies via `addCookies`; localStorage origins must come in via `context_new(storage_state_path)` | Pass storage_state_path on context creation, not after |

## Performance

- `headless: true` is roughly 2× faster than headed and uses ~30 % less RAM.
- Disable `record_video` and `record_har` unless you need them.
- `page_query_selector_all` with a high `limit` builds a big payload — keep it ≤ 100 unless you're really exporting.

## Cleanup discipline

The TTL sweep is a backstop. Do this in your normal flow:

```text
browser_launch -> ... -> browser_close
```

If a workflow fails mid-way, calling `browser_list` and then `browser_close` on stale ids is the safe recovery.
