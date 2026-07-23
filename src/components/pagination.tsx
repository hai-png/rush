import Link from 'next/link';
import { Button } from '@/components/ui/button';

// FE-043/FE-044: shared prev/next pagination component used by all admin
// list pages. Server-rendered; the caller passes the current page, the
// total row count, the page size, the base path (e.g. "/admin/users"), and
// any extra query params to preserve (e.g. search string, role filter).
//
// Renders "Page N of M" plus Prev / Next buttons. Prev/Next are disabled
// (not hidden) when there is no page to go to so screen-reader users still
// see the structure of the pagination.

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
