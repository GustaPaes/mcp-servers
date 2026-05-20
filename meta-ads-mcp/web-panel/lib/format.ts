export function currency(value: number | string | undefined, code = 'BRL'): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n == null || Number.isNaN(n)) return '-';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code }).format(n);
}

export function number(value: number | string | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n == null || Number.isNaN(n)) return '-';
  return new Intl.NumberFormat('pt-BR').format(n);
}

export function pct(value: number | string | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n == null || Number.isNaN(n)) return '-';
  return `${n.toFixed(2)}%`;
}

export function shortJson(value: unknown): string {
  if (value == null) return '-';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return raw.length > 260 ? `${raw.slice(0, 260)}...` : raw;
}
