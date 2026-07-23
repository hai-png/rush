import type { Metadata } from 'next';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardHeader } from '@/components/dashboard-header';
import { Pagination } from '@/components/pagination';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Subscriptions · Admin' };

const PAGE_SIZE = 50;

export default async function AdminSubscriptionsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireRole('platform_admin');
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const [subs, total] = await Promise.all([
    db.subscription.findMany({
      include: { user: { select: { name: true, phone: true } }, plan: true, corporate: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.subscription.count(),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader title="Admin · Subscriptions" backHref="/dashboard/admin" />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-4">All Subscriptions ({total})</h1>
        <Card>
          <CardContent className="py-3 divide-y">
            {subs.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">No subscriptions yet.</div>
            ) : subs.map(s => (
              <div key={s.id} className="py-2 flex justify-between items-center text-sm">
                <div>
                  <div className="font-medium">{s.user.name} · {s.user.phone}</div>
                  <div className="text-xs text-muted-foreground">{s.plan.name} · {formatDate(s.startDate)} – {formatDate(s.endDate)} · {s.ridesUsed}/{s.plan.ridesIncluded === -1 ? '∞' : s.plan.ridesIncluded} rides</div>
                  {s.corporate && <div className="text-xs text-muted-foreground">Corporate: {s.corporate.name}</div>}
                </div>
                <Badge variant={s.status === 'active' ? 'default' : 'secondary'}>{s.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/admin/subscriptions" />
      </main>
    </div>
  );
}
