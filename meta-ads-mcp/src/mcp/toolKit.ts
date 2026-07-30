import type { z, ZodTypeAny } from 'zod';
import type { ToolContext } from './context.js';

/**
 * A standard MCP tool wrapper. We use Zod schemas directly so they:
 *   - validate input strictly
 *   - generate JSON Schema automatically via z.toJSONSchema (SDK helper).
 */
export interface McpTool<TInput extends ZodTypeAny, TOutput> {
  name: string;
  description: string;
  inputSchema: TInput;
  handler: (input: z.infer<TInput>, ctx: ToolContext) => Promise<TOutput>;
  /** When true, this tool changes Meta state or the local draft/profile store. */
  mutating?: boolean;
  /** Destructive operations are intentionally rare; deletion is not exposed. */
  destructive?: boolean;
  /** Override when a mutating operation is safe to repeat with the same input. */
  idempotent?: boolean;
  /** False for tools that only analyze caller-provided/local data. */
  openWorld?: boolean;
}

export function defineTool<TInput extends ZodTypeAny, TOutput>(
  tool: McpTool<TInput, TOutput>,
): McpTool<TInput, TOutput> {
  return tool;
}

/** Standard envelope returned by every tool — predictable for the LLM. */
export interface ToolEnvelope<T> {
  ok: boolean;
  data?: T;
  warnings?: string[];
  errors?: string[];
  meta?: Record<string, unknown>;
}

export function ok<T>(data: T, extra: Partial<ToolEnvelope<T>> = {}): ToolEnvelope<T> {
  return { ok: true, data, ...extra };
}

export function fail(message: string, extra: Partial<ToolEnvelope<never>> = {}): ToolEnvelope<never> {
  return { ok: false, errors: [message], ...extra };
}
