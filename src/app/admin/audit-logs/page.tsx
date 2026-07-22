import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { VerifyChainButton } from './verify-button';

export const dynamic = 'force-dynamic';

export default async function AdminAuditLogsPage() {
  await requireRole('platform_admin');
  const logs = await db.auditLog.findMany({
    include: { actor: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard/admin" className="text-xl font-bold">Admin · Audit Logs</Link>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Audit log ({logs.length})</h1>
          <VerifyChainButton />
        </div>
        <Card>
          <CardContent className="py-3 divide-y text-xs font-mono">
            {logs.map(l => (
              <div key={l.id} className="py-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{l.action}</span>
                  <span className="text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</span>
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
      </main>
    </div>
  );
}
