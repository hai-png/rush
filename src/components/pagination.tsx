import Link from 'next/link';
import { Button } from '@/components/ui/button';

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