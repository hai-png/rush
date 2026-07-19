'use client';
import { ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';
import { Skeleton } from '../primitives/skeleton';

export type Column<T> = { key: keyof T & string; header: string; render?: (row: T) => React.ReactNode };

export function DataTable<T extends { id: string }>({
  columns, rows, loading, cursor, onNextPage, onPrevPage, hasPrev,
}: {
  columns: Column<T>[]; rows: T[]; loading?: boolean;
  cursor?: string; onNextPage?: () => void; onPrevPage?: () => void; hasPrev?: boolean;
}) {
  return (
    <div role="region" aria-label="Data table" className="rounded-2xl border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-secondary">
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className="text-left font-medium px-4 py-3">
                {col.header}
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
