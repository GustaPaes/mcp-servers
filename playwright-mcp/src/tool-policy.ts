import { TOOL_RISK, type ToolRisk } from "@gustapaes/mcp-runtime";

interface ToolPolicy {
  risk: ToolRisk;
  idempotent?: boolean;
  openWorld?: boolean;
}

const POLICY = {
  browser_launch: { risk: TOOL_RISK.LOCAL_STATE, idempotent: false },
  browser_close: { risk: TOOL_RISK.DESTRUCTIVE, openWorld: false },
  browser_list: { risk: TOOL_RISK.READ, openWorld: false },
  context_new: { risk: TOOL_RISK.LOCAL_STATE, idempotent: false },
  context_close: { risk: TOOL_RISK.DESTRUCTIVE, openWorld: false },
  context_storage_state: { risk: TOOL_RISK.LOCAL_STATE },
  browser_install: { risk: TOOL_RISK.LOCAL_STATE },
  page_new: { risk: TOOL_RISK.LOCAL_STATE, idempotent: false },
  page_close: { risk: TOOL_RISK.DESTRUCTIVE, openWorld: false },
  page_list: { risk: TOOL_RISK.READ, openWorld: false },
  page_goto: { risk: TOOL_RISK.EXECUTION },
  page_reload: { risk: TOOL_RISK.EXECUTION },
  page_back: { risk: TOOL_RISK.EXECUTION },
  page_forward: { risk: TOOL_RISK.EXECUTION },
  page_wait_for_url: { risk: TOOL_RISK.READ },
  page_wait_for_selector: { risk: TOOL_RISK.READ },
  page_wait_for_load_state: { risk: TOOL_RISK.READ },
  page_click: { risk: TOOL_RISK.REMOTE_WRITE, idempotent: false },
  page_dblclick: { risk: TOOL_RISK.REMOTE_WRITE, idempotent: false },
  page_hover: { risk: TOOL_RISK.EXECUTION },
  page_focus: { risk: TOOL_RISK.EXECUTION },
  page_blur: { risk: TOOL_RISK.EXECUTION },
  page_fill: { risk: TOOL_RISK.EXECUTION },
  page_type: { risk: TOOL_RISK.EXECUTION, idempotent: false },
  page_press: { risk: TOOL_RISK.REMOTE_WRITE, idempotent: false },
  page_select_option: { risk: TOOL_RISK.EXECUTION },
  page_check: { risk: TOOL_RISK.EXECUTION },
  page_uncheck: { risk: TOOL_RISK.EXECUTION },
  page_set_checked: { risk: TOOL_RISK.EXECUTION },
  page_drag_and_drop: { risk: TOOL_RISK.REMOTE_WRITE, idempotent: false },
  page_set_input_files: { risk: TOOL_RISK.REMOTE_WRITE },
  page_console_messages: { risk: TOOL_RISK.READ },
  page_text_content: { risk: TOOL_RISK.READ },
  page_inner_text: { risk: TOOL_RISK.READ },
  page_inner_html: { risk: TOOL_RISK.READ },
  page_get_attribute: { risk: TOOL_RISK.READ },
  page_evaluate: { risk: TOOL_RISK.EXECUTION, idempotent: false },
  page_query_selector_all: { risk: TOOL_RISK.READ },
  page_accessibility_snapshot: { risk: TOOL_RISK.READ },
  page_get_url: { risk: TOOL_RISK.READ },
  page_get_title: { risk: TOOL_RISK.READ },
  page_get_cookies: { risk: TOOL_RISK.SECRET_READ },
  context_recording_status: { risk: TOOL_RISK.READ, openWorld: false },
  page_screenshot: { risk: TOOL_RISK.LOCAL_STATE },
  page_pdf: { risk: TOOL_RISK.LOCAL_STATE },
  page_video_start: { risk: TOOL_RISK.READ, openWorld: false },
  page_video_stop: { risk: TOOL_RISK.DESTRUCTIVE, openWorld: false },
  tracing_start: { risk: TOOL_RISK.LOCAL_STATE },
  tracing_stop: { risk: TOOL_RISK.LOCAL_STATE },
  page_route: { risk: TOOL_RISK.EXECUTION },
  page_unroute: { risk: TOOL_RISK.LOCAL_STATE },
  page_wait_for_request: { risk: TOOL_RISK.SECRET_READ },
  page_wait_for_response: { risk: TOOL_RISK.SECRET_READ },
  network_log_status: { risk: TOOL_RISK.READ, openWorld: false },
  network_log_start: { risk: TOOL_RISK.READ, openWorld: false },
  network_log_stop: { risk: TOOL_RISK.DESTRUCTIVE, openWorld: false },
  page_eval_in_frame: { risk: TOOL_RISK.EXECUTION, idempotent: false },
  page_handle_dialog: { risk: TOOL_RISK.EXECUTION },
  browser_stealth: { risk: TOOL_RISK.LOCAL_STATE },
  mcp_status: { risk: TOOL_RISK.READ, openWorld: false },
} as const satisfies Record<string, ToolPolicy>;

export const TOOL_POLICY: Readonly<Record<string, ToolPolicy>> = Object.freeze(POLICY);

export const TOOL_NAMES_BY_RISK = Object.freeze(
  Object.fromEntries(
    (Object.values(TOOL_RISK) as ToolRisk[]).map((risk) => [
      risk,
      Object.freeze(Object.entries(TOOL_POLICY).filter(([, value]) => value.risk === risk).map(([name]) => name)),
    ]),
  ) as Record<ToolRisk, readonly string[]>,
);
