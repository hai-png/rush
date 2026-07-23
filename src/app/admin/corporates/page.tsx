import type { Metadata } from 'next';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardHeader } from '@/components/dashboard-header';
import { Pagination } from '@/components/pagination';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Corporates · Admin' };

const PAGE_SIZE = 50;

// FE-044: paginated corporates list (was unbounded, no pagination UI).
export default async function AdminCorporatesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireRole('platform_admin');
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const [corporates, total] = await Promise.all([
    db.corporate.findMany({
      include: { _count: { select: { members: true, subscriptions: true } }, adminUser: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.corporate.count(),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader title="Admin · Corporates" backHref="/dashboard/admin" />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-2xl font-bold mb-4">Corporates ({total})</h1>
        <Card>
          <CardContent className="py-3 divide-y">
            {corporates.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">No corporates yet.</div>
            ) : corporates.map(c => (
              <div key={c.id} className="py-3 flex justify-between items-center">
                <div>
                  <div className="font-medium">{c.name} <span className="font-mono text-xs text-muted-foreground ml-2">{c.code}</span></div>
                  <div className="text-xs text-muted-foreground">Admin: {c.adminUser.name} · {c.adminUser.phone}</div>
                  <div className="text-xs text-muted-foreground">Subsidy: {c.subsidyPercent}% · {c._count.members} members · {c._count.subscriptions} subs</div>
                </div>
                <Badge variant={c.isActive ? 'default' : 'secondary'}>{c.isActive ? 'active' : 'inactive'}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/admin/corporates" />
      </main>
    </div>
  );
}
