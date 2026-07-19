'use client';
import { ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';
import { Skeleton } from '../primitives/skeleton';

export type Column<T> = { key: keyof T & string; header: string; sortable?: boolean; render?: (row: T) => React.ReactNode };

export function DataTable<T extends { id: string }>({
  columns, rows, loading, cursor, onNextPage, onPrevPage, hasPrev, onSort, sortKey, sortDir, caption,
}: {
  columns: Column<T>[]; rows: T[]; loading?: boolean;
  cursor?: string; onNextPage?: () => void; onPrevPage?: () => void; hasPrev?: boolean;
  onSort?: (key: string) => void;
  /** Current sort key (for aria-sort). Required when onSort is set. */
  sortKey?: string;
  /** Current sort direction ('asc' | 'desc'). Required when onSort is set. */
  sortDir?: 'asc' | 'desc';
  /** Visible caption for screen readers. Renders as a sr-only <caption>. */
  caption?: string;
}) {
  return (
    // FIX (UI-001): Added role="region" + aria-label on the wrapper div so
    // screen readers announce the table as a navigable region. Changed
    // overflow-hidden to overflow-x-auto so wide tables scroll horizontally
    // on mobile instead of clipping the rightmost columns (often the Actions
    // column) — also fixes focus rings being clipped.
    <div role="region" aria-label="Data table" className="rounded-2xl border border-border overflow-x-auto">
      <table className="w-full text-sm">
        {/* FIX (UI-001): <caption> provides an accessible name for the table.
            sr-only keeps it visible to screen readers but hidden visually. */}
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-secondary">
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className="text-left font-medium px-4 py-3"
                  // FIX (UI-001): aria-sort announces the current sort state
                  // for sortable columns. Screen readers now say
                  // "Sort by Amount, ascending" instead of just "Amount, button".
                  aria-sort={col.sortable
                    ? (sortKey === col.key
                      ? (sortDir === 'asc' ? 'ascending' : 'descending')
                      : 'none')
                    : undefined}>
                {col.sortable ? (
                  <button
                    className="flex items-center gap-1"
                    aria-label={`Sort by ${col.header}${sortKey === col.key ? ` (${sortDir === 'asc' ? 'ascending' : 'descending'})` : ''}`}
                    onClick={() => onSort?.(col.key)}>
                    {col.header} <ArrowUpDown className="h-3 w-3" aria-hidden />
                  </button>
                ) : col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && Array.from({ length: 5 }).map((_, i) => (
            <tr key={i} className="border-t border-border" aria-hidden>
              {columns.map((c) => <td key={c.key} className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>)}
            </tr>
          ))}
          {/* FIX (UI-006): empty state. Previously rendered just headers
              when rows was empty — users saw an empty box and thought it
              was still loading. */}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">No data</td></tr>
          )}
          {!loading && rows.map((row) => (
            <tr key={row.id} className="border-t border-border hover:bg-secondary/50">
              {columns.map((col) => <td key={col.key} className="px-4 py-3">{col.render ? col.render(row) : String(row[col.key] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between px-4 py-3 border-t border-border">
        <button disabled={!hasPrev} onClick={onPrevPage} className="disabled:opacity-30 flex items-center gap-1 text-sm">
          <ChevronLeft className="h-4 w-4" aria-hidden /> Prev
        </button>
        <button disabled={!cursor} onClick={onNextPage} className="disabled:opacity-30 flex items-center gap-1 text-sm">
          Next <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
