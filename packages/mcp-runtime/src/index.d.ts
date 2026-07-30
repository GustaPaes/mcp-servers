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
