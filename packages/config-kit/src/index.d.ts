export function isPlainObject(value: unknown): value is Record<string, unknown>;
export function readVersionedJsonConfigSync(
  filePath: string | undefined,
  options?: { optional?: boolean; expectedVersion?: number; label?: string },
): Readonly<Record<string, unknown>>;
export function firstConfigured<T>(...values: T[]): T | "";
export function toStringArray(value: unknown): string[];
