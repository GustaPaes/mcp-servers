/**
 * tools/interaction.ts — clicks, typing, form interactions, drag/drop, file upload.
 */
import { sessionManager } from "../session-manager.js";
import type { ToolModule } from "../types.js";
import { assertSelectorAllowed } from "../safety/selectors.js";
import { retry } from "../lib/retry.js";

const buttonEnum = ["left", "right", "middle"];
const baseProps = {
  page_id: { type: "string" },
  selector: { type: "string" },
  timeout_ms: { type: "number" },
};

export const interactionTools: ToolModule = {
  defs: [
    {
      name: "page_click",
      description: "Click on an element matched by selector.",
      annotations: { title: "Click" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector"],
        properties: {
          ...baseProps,
          button: { type: "string", enum: buttonEnum, default: "left" },
          click_count: { type: "number", default: 1 },
          force: { type: "boolean", default: false },
          modifiers: { type: "array", items: { type: "string", enum: ["Alt", "Control", "Meta", "Shift"] } },
          position: {
            type: "object",
            additionalProperties: false,
            properties: { x: { type: "number" }, y: { type: "number" } },
            required: ["x", "y"],
          },
          delay_ms: { type: "number" },
          trial: { type: "boolean", default: false },
        },
      },
    },
    {
      name: "page_dblclick",
      description: "Double-click on an element.",
      annotations: { title: "Double click" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector"],
        properties: {
          ...baseProps,
          button: { type: "string", enum: buttonEnum, default: "left" },
          force: { type: "boolean", default: false },
          delay_ms: { type: "number" },
        },
      },
    },
    {
      name: "page_hover",
      description: "Hover over an element.",
      annotations: { title: "Hover" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector"],
        properties: { ...baseProps, force: { type: "boolean", default: false } },
      },
    },
    {
      name: "page_focus",
      description: "Focus an element.",
      annotations: { title: "Focus" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector"],
        properties: baseProps,
      },
    },
    {
      name: "page_blur",
      description: "Blur (un-focus) an element.",
      annotations: { title: "Blur" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector"],
        properties: baseProps,
      },
    },
    {
      name: "page_fill",
      description:
        "Fill a form field with a value (clears any previous content first). Use page_type for character-by-character input.",
      annotations: { title: "Fill" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector", "value"],
        properties: { ...baseProps, value: { type: "string" }, force: { type: "boolean", default: false } },
      },
    },
    {
      name: "page_type",
      description: "Type text character-by-character with optional delay.",
      annotations: { title: "Type" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector", "text"],
        properties: { ...baseProps, text: { type: "string" }, delay_ms: { type: "number", default: 0 } },
      },
    },
    {
      name: "page_press",
      description: "Press a key or key combination, e.g. 'Enter', 'Control+S', 'ArrowDown'.",
      annotations: { title: "Press key" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["key"],
        properties: {
          page_id: { type: "string" },
          selector: { type: "string", description: "Optional — defaults to the page itself" },
          key: { type: "string" },
          delay_ms: { type: "number" },
          timeout_ms: { type: "number" },
        },
      },
    },
    {
      name: "page_select_option",
      description: "Select option(s) in a <select>. Use 'value', 'label' or 'index' (any of them).",
      annotations: { title: "Select option" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector"],
        properties: {
          ...baseProps,
          values: {
            type: "array",
            items: {
              oneOf: [
                { type: "string" },
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    value: { type: "string" },
                    label: { type: "string" },
                    index: { type: "number" },
                  },
                },
              ],
            },
            description: "Array of values, labels, indices, or option objects.",
          },
        },
      },
    },
    {
      name: "page_check",
      description: "Check a checkbox or radio.",
      annotations: { title: "Check" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector"],
        properties: { ...baseProps, force: { type: "boolean", default: false } },
      },
    },
    {
      name: "page_uncheck",
      description: "Uncheck a checkbox.",
      annotations: { title: "Uncheck" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector"],
        properties: { ...baseProps, force: { type: "boolean", default: false } },
      },
    },
    {
      name: "page_set_checked",
      description: "Set the checked state of a checkbox/radio.",
      annotations: { title: "Set checked" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector", "checked"],
        properties: { ...baseProps, checked: { type: "boolean" }, force: { type: "boolean", default: false } },
      },
    },
    {
      name: "page_drag_and_drop",
      description: "Drag from source selector and drop on target selector.",
      annotations: { title: "Drag & drop" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["source", "target"],
        properties: {
          page_id: { type: "string" },
          source: { type: "string" },
          target: { type: "string" },
          source_position: {
            type: "object",
            additionalProperties: false,
            properties: { x: { type: "number" }, y: { type: "number" } },
            required: ["x", "y"],
          },
          target_position: {
            type: "object",
            additionalProperties: false,
            properties: { x: { type: "number" }, y: { type: "number" } },
            required: ["x", "y"],
          },
          force: { type: "boolean", default: false },
          timeout_ms: { type: "number" },
        },
      },
    },
    {
      name: "page_set_input_files",
      description: "Upload one or multiple files into <input type=file>.",
      annotations: { title: "Upload files" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["selector", "paths"],
        properties: {
          ...baseProps,
          paths: { type: "array", items: { type: "string" }, minItems: 1 },
        },
      },
    },
  ],

  handlers: {
    async page_click(args) {
      const selector = String(args.selector);
      assertSelectorAllowed(selector);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      await retry(
        () =>
          rec.page.click(selector, {
            button: (args.button as "left") ?? "left",
            clickCount: (args.click_count as number) ?? 1,
            force: (args.force as boolean) ?? false,
            modifiers: args.modifiers as ("Alt" | "Control" | "Meta" | "Shift")[] | undefined,
            position: args.position as { x: number; y: number } | undefined,
            delay: args.delay_ms as number | undefined,
            timeout: args.timeout_ms as number | undefined,
            trial: (args.trial as boolean) ?? false,
          }),
        { label: "page_click" },
      );
      return { clicked: selector, url: rec.page.url() };
    },
    async page_dblclick(args) {
      const selector = String(args.selector);
      assertSelectorAllowed(selector);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      await rec.page.dblclick(selector, {
        button: (args.button as "left") ?? "left",
        force: (args.force as boolean) ?? false,
        delay: args.delay_ms as number | undefined,
        timeout: args.timeout_ms as number | undefined,
      });
      return { dblclicked: selector };
    },
    async page_hover(args) {
      const selector = String(args.selector);
      assertSelectorAllowed(selector);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      await rec.page.hover(selector, {
        force: (args.force as boolean) ?? false,
        timeout: args.timeout_ms as number | undefined,
      });
      return { hovered: selector };
    },
    async page_focus(args) {
      const selector = String(args.selector);
      assertSelectorAllowed(selector);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      await rec.page.focus(selector, { timeout: args.timeout_ms as number | undefined });
      return { focused: selector };
    },
    async page_blur(args) {
      const selector = String(args.selector);
      assertSelectorAllowed(selector);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      await rec.page.locator(selector).blur({ timeout: args.timeout_ms as number | undefined });
      return { blurred: selector };
    },
    async page_fill(args) {
      const selector = String(args.selector);
      assertSelectorAllowed(selector);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      await retry(
        () =>
          rec.page.fill(selector, String(args.value), {
            force: (args.force as boolean) ?? false,
            timeout: args.timeout_ms as number | undefined,
          }),
        { label: "page_fill" },
      );
      return { filled: selector };
    },
    async page_type(args) {
      const selector = String(args.selector);
      assertSelectorAllowed(selector);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      await rec.page.locator(selector).pressSequentially(String(args.text), {
        delay: (args.delay_ms as number) ?? 0,
        timeout: args.timeout_ms as number | undefined,
      });
      return { typed: selector, length: String(args.text).length };
    },
    async page_press(args) {
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const key = String(args.key);
      const selector = args.selector as string | undefined;
      if (selector) {
        assertSelectorAllowed(selector);
        await rec.page.press(selector, key, {
          delay: args.delay_ms as number | undefined,
          timeout: args.timeout_ms as number | undefined,
        });
      } else {
        await rec.page.keyboard.press(key, { delay: args.delay_ms as number | undefined });
      }
      return { pressed: key };
    },
    async page_select_option(args) {
      const selector = String(args.selector);
      assertSelectorAllowed(selector);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const values = (args.values ?? []) as Array<string | { value?: string; label?: string; index?: number }>;
      const result = await rec.page.selectOption(selector, values as Parameters<typeof rec.page.selectOption>[1], {
        timeout: args.timeout_ms as number | undefined,
      });
      return { selected: result };
    },
    async page_check(args) {
      const selector = String(args.selector);
      assertSelectorAllowed(selector);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      await rec.page.check(selector, {
        force: (args.force as boolean) ?? false,
        timeout: args.timeout_ms as number | undefined,
      });
      return { checked: selector };
    },
    async page_uncheck(args) {
      const selector = String(args.selector);
      assertSelectorAllowed(selector);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      await rec.page.uncheck(selector, {
        force: (args.force as boolean) ?? false,
        timeout: args.timeout_ms as number | undefined,
      });
      return { unchecked: selector };
    },
    async page_set_checked(args) {
      const selector = String(args.selector);
      assertSelectorAllowed(selector);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      await rec.page.setChecked(selector, Boolean(args.checked), {
        force: (args.force as boolean) ?? false,
        timeout: args.timeout_ms as number | undefined,
      });
      return { selector, checked: Boolean(args.checked) };
    },
    async page_drag_and_drop(args) {
      const source = String(args.source);
      const target = String(args.target);
      assertSelectorAllowed(source);
      assertSelectorAllowed(target);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      await rec.page.dragAndDrop(source, target, {
        sourcePosition: args.source_position as { x: number; y: number } | undefined,
        targetPosition: args.target_position as { x: number; y: number } | undefined,
        force: (args.force as boolean) ?? false,
        timeout: args.timeout_ms as number | undefined,
      });
      return { dragged: source, dropped_on: target };
    },
    async page_set_input_files(args) {
      const selector = String(args.selector);
      assertSelectorAllowed(selector);
      const rec = sessionManager.resolvePage(args.page_id as string | undefined);
      const paths = (args.paths as string[]) ?? [];
      await rec.page.setInputFiles(selector, paths, {
        timeout: args.timeout_ms as number | undefined,
      });
      return { selector, files: paths };
    },
  },
};
