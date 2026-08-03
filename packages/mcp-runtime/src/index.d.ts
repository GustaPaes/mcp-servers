export const TOOL_RISK: Readonly<{
  READ: "READ";
  LOCAL_STATE: "LOCAL_STATE";
  EXECUTION: "EXECUTION";
  REMOTE_WRITE: "REMOTE_WRITE";
  DESTRUCTIVE: "DESTRUCTIVE";
  SECRET_READ: "SECRET_READ";
}>;
export type ToolRisk = (typeof TOOL_RISK)[keyof typeof TOOL_RISK];
export type ToolAnnotations = {
  title?: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};
export function annotationsForRisk(
  risk: ToolRisk,
  options?: { idempotent?: boolean; openWorld?: boolean; title?: string },
): ToolAnnotations;
export function assertToolManifest<T>(options: {
  definitions: readonly (T & { name: string })[];
  handlers: Record<string, unknown>;
  policies: Record<string, { risk: ToolRisk }>;
  label?: string;
}): readonly T[];
export function assertSafeIdentifier(value: unknown, label?: string): string;
export function resolveInside(root: string, ...segments: string[]): string;
export function resolveInsideAny(
  roots: readonly string[],
  input: string,
  options?: { createRoot?: boolean },
): string;
export function atomicWriteJson(filePath: string, value: unknown): Promise<void>;
export function atomicWriteJsonSync(filePath: string, value: unknown): void;
export function createSerialExecutor(): <T>(task: () => Promise<T> | T) => Promise<T>;
export function redactHeaders(
  headers?: Record<string, string>,
): Record<string, string>;
export function redactSensitiveValue(value: unknown, depth?: number): unknown;
export function redactTextPayload(text: unknown): unknown;
