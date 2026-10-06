export function paginateCollection<T>(items: T[], page: number, pageSize: number): T[] {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const safePage = Number.isFinite(page) ? Math.max(1, Number(page)) : 1;
  const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Number(pageSize)) : 1;
  const start = (safePage - 1) * safePageSize;

  return items.slice(start, start + safePageSize);
}

export function getPageCount<T>(items: T[], pageSize: number): number {
  const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Number(pageSize)) : 1;
  if (!items.length) {
    return 1;
  }

  return Math.ceil(items.length / safePageSize);
}
