export function isPlainObject(value: unknown): value is Record<string, unknown>;
export function readVersionedJsonConfigSync(
  filePath: string | undefined,
  options?: {
    optional?: boolean;
    expectedVersion?: number;
    label?: string;
    allowedKeys?: readonly string[];
    onUnknown?: "error" | "warn" | "ignore";
    validate?: (configuration: Record<string, unknown>) => boolean | void;
  },
): Readonly<Record<string, unknown>>;
export function firstConfigured<T>(...values: T[]): T | "";
export function toStringArray(value: unknown): string[];
export function toBoolean(
  value: unknown,
  options?: { defaultValue?: boolean; label?: string },
): boolean;
export function toBoundedInteger(
  value: unknown,
  options?: { defaultValue?: number; min?: number; max?: number; label?: string },
): number;
export function toEnum<T>(
  value: unknown,
  allowed: readonly T[],
  options?: { defaultValue?: T; label?: string },
): T;
