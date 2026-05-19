/**
 * Pagination helper — repeatedly calls listFn until no opcNextPage.
 */
export async function paginateAll(listFn, params = {}, { max = 1000 } = {}) {
  const items = [];
  let page;
  do {
    const res = await listFn({ ...params, page });
    const collection = res.items ?? res.value ?? res.data ?? [];
    for (const it of collection) {
      items.push(it);
      if (items.length >= max) return items;
    }
    page = res.opcNextPage ?? res.nextPage ?? null;
  } while (page);
  return items;
}
