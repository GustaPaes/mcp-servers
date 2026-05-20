/** Currency helpers — keep amounts as floats with care, never mix units. */

export function roundCurrency(value: number, fractionDigits = 2): number {
  const m = 10 ** fractionDigits;
  return Math.round(value * m) / m;
}

export function pctChange(from: number, to: number): number {
  if (from <= 0) return Number.POSITIVE_INFINITY;
  return ((to - from) / from) * 100;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
