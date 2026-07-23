import type { Metadata } from 'next';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { DashboardHeader } from '@/components/dashboard-header';
import { Pagination } from '@/components/pagination';
import { VerifyChainButton } from './verify-button';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Audit Logs · Admin' };

const PAGE_SIZE = 50;

// FE-044: paginated audit log list (was take:200, no pagination UI).
export default async function AdminAuditLogsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireRole('platform_admin');
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      include: { actor: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.auditLog.count(),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader title="Admin · Audit Logs" backHref="/dashboard/admin" />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Audit log ({total})</h1>
          <VerifyChainButton />
        </div>
        <Card>
          <CardContent className="py-3 divide-y text-xs font-mono">
            {logs.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground">No audit log entries.</div>
            ) : logs.map(l => (
              <div key={l.id} className="py-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{l.action}</span>
                  <span className="text-muted-foreground">{formatDateTime(l.createdAt)}</span>
                </div>
                <div className="text-muted-foreground">
                  actor: {l.actor?.name ?? 'system'} · entity: {l.entityType}/{l.entityId ?? '—'} · ip: {l.ipAddress ?? '—'}
                </div>
                <div className="text-muted-foreground truncate">hash: {l.hash.slice(0, 16)}… prev: {l.prevHash?.slice(0, 16) ?? '∅'}…</div>
                {(l.before || l.after) && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted-foreground">payload</summary>
                    <pre className="text-[10px] mt-1">
{JSON.stringify({ before: l.before ? JSON.parse(l.before) : null, after: l.after ? JSON.parse(l.after) : null }, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/admin/audit-logs" />
      </main>
    </div>
  );
}
