import Link from 'next/link';
import { Button } from '@/components/ui/button';

// Phase 3 fix: unified pagination component supporting both offset (legacy)
// and cursor-based (preferred) pagination.
//
// Cursor-based is preferred because:
//   - O(1) performance regardless of page depth (offset is O(n) on SQLite)
//   - No skipped/duplicate rows when items are inserted/deleted between pages
//   - Matches the API's existing cursor-based pagination (src/lib/pagination.ts)
//
// Admin pages should use CursorPagination. The offset-based Pagination is
// retained for backward compatibility but new pages should use cursor-based.

// ── Offset-based (legacy) ───────────────────────────────────────────
export function Pagination({
  page,
  total,
  pageSize,
  basePath,
  query = {},
}: {
  page: number;
  total: number;
  pageSize: number;
  basePath: string;
  query?: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const hasPrev = safePage > 1;
  const hasNext = safePage < totalPages;

  function href(p: number): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') params.set(k, v);
    }
    params.set('page', String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <div className="flex items-center justify-between gap-3 py-3 text-sm">
      <span className="text-muted-foreground">
        Page {safePage} of {totalPages} {total !== 0 && `· ${total} total`}
      </span>
      <div className="flex gap-2">
        {hasPrev ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(safePage - 1)} prefetch={false}>Prev</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>Prev</Button>
        )}
        {hasNext ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(safePage + 1)} prefetch={false}>Next</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>Next</Button>
        )}
      </div>
    </div>
  );
}

// ── Cursor-based (preferred) ────────────────────────────────────────
// Renders Prev/Next buttons using cursor params. The caller passes the
// current cursor (from searchParams) and the nextCursor (from the API
// response's pagination.nextCursor).
export function CursorPagination({
  cursor,
  nextCursor,
  hasMore,
  total,
  basePath,
  query = {},
}: {
  cursor: string | null;
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
  basePath: string;
  query?: Record<string, string | undefined>;
}) {
  const hasPrev = cursor !== null;
  const hasNext = hasMore && nextCursor !== null;

  function href(c: string | null): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') params.set(k, v);
    }
    if (c) params.set('cursor', c);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <div className="flex items-center justify-between gap-3 py-3 text-sm">
      <span className="text-muted-foreground">
        {total !== undefined ? `${total} total` : ''}
      </span>
      <div className="flex gap-2">
        {hasPrev ? (
          <Button asChild variant="outline" size="sm">
            {/* Note: cursor-based pagination doesn't support arbitrary "prev" */}
            {/* without storing a prevCursor. For now, Prev is disabled. */}
            <span className="opacity-50">Prev</span>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>Prev</Button>
        )}
        {hasNext ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(nextCursor)} prefetch={false}>Next</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>Next</Button>
        )}
      </div>
    </div>
  );
}
