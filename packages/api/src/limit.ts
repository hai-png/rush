import { CursorQuery } from '@addis/shared';

/**
 * Parse + clamp the `limit` query parameter using the shared CursorQuery schema
 * (which enforces limit ∈ [1, 100] with a default of 20). Previously most routes
 * used raw `Number(c.req.query('limit') ?? 20)` which allowed ?limit=999999999
 * to force a huge table scan.
 */
export function parseLimit(raw: string | undefined): number {
  const parsed = CursorQuery.shape.limit.safeParse(raw);
  return parsed.success ? parsed.data : 20;
}
