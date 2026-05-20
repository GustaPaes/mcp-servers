export interface CursorPage<T> {
  data: T[];
  next?: string | null;
  prev?: string | null;
}

/** Iterates through a cursor-paginated source until a hard cap. */
export async function collectPaged<T>(
  fetchPage: (cursor?: string) => Promise<CursorPage<T>>,
  hardLimit = 500,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await fetchPage(cursor);
    out.push(...page.data);
    if (out.length >= hardLimit || !page.next) break;
    cursor = page.next;
  }
  return out.slice(0, hardLimit);
}
