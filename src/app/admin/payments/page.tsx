import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardHeader } from '@/components/dashboard-header';
import { Pagination } from '@/components/pagination';
import { formatETB, formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Payments · Admin' };

const PAGE_SIZE = 50;

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireRole('platform_admin');
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const [payments, total] = await Promise.all([
    db.payment.findMany({
      include: { user: { select: { name: true, phone: true } }, subscription: { include: { plan: true } } },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.payment.count(),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader title="Admin · Payments" backHref="/dashboard/admin" />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-2xl font-bold mb-4">Payments ({total})</h1>
        <Card>
          <CardContent className="py-3 divide-y">
            {payments.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">No payments yet.</div>
            ) : payments.map(p => (
              <Link key={p.id} href={`/admin/payments/${p.id}`} className="block py-2 text-sm hover:bg-accent/30 -mx-3 px-3 rounded">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono text-xs">{p.reference}</div>
                    <div className="text-xs text-muted-foreground">{p.user.name} · {p.user.phone} · {p.subscription?.plan?.name ?? '—'} · {formatDateTime(p.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>{formatETB(p.amountCents)}</span>
                    {p.refundAmountCents > 0 && <span className="text-xs text-muted-foreground">refunded {formatETB(p.refundAmountCents)}</span>}
                    <Badge variant="outline">{p.status}</Badge>
                    <Badge>{p.method}</Badge>
                  </div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/admin/payments" />
      </main>
    </div>
  );
}
