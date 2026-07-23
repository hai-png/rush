// P1-56 / API-031: cursor-based pagination helper.
//
// Usage in a handler:
//   const page = parsePagination(query);
//   const [items, total] = await Promise.all([
//     db.ride.findMany({ where, ...page.findManyArgs, orderBy: { createdAt: 'desc' } }),
//     db.ride.count({ where }),
//   ]);
//   return { data: items, pagination: paginateMeta(items, total, page) };
//
// Returns:
//   { items: [...], pagination: { total, limit, cursor, nextCursor, hasMore } }

export type PaginationParams = {
  limit: number;
  cursor: string | undefined;
  findManyArgs: {
    take: number;
    skip?: number;
    cursor?: { id: string };
  };
};

export type PaginationMeta = {
  total: number;
  limit: number;
  cursor: string | null;
  nextCursor: string | null;
  hasMore: boolean;
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export function parsePagination(query: Record<string, string> | undefined): PaginationParams {
  const limit = Math.min(
    Math.max(1, parseInt(query?.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const cursor = query?.cursor || undefined;
  return {
    limit,
    cursor,
    findManyArgs: {
      take: limit + 1, // fetch one extra to check hasMore
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    },
  };
}

export function paginateMeta<T extends { id: string }>(
  items: T[],
  total: number,
  params: PaginationParams,
): PaginationMeta {
  const hasMore = items.length > params.limit;
  const pageItems = hasMore ? items.slice(0, params.limit) : items;
  const nextCursor = hasMore && pageItems.length > 0 ? pageItems[pageItems.length - 1]!.id : null;
  return {
    total,
    limit: params.limit,
    cursor: params.cursor ?? null,
    nextCursor,
    hasMore,
  };
}

// Helper for handlers that want to return the standard paginated shape.
export function paginatedResponse<T extends { id: string }>(
  items: T[],
  total: number,
  params: PaginationParams,
): { data: T[]; pagination: PaginationMeta } {
  const meta = paginateMeta(items, total, params);
  const pageItems = meta.hasMore ? items.slice(0, params.limit) : items;
  return { data: pageItems, pagination: meta };
}
