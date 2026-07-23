import type { Metadata } from 'next';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { DashboardHeader } from '@/components/dashboard-header';
import { Pagination } from '@/components/pagination';
import { NewShuttleForm } from './new-shuttle-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Shuttles · Admin' };

const PAGE_SIZE = 50;

export default async function AdminShuttlesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireRole('platform_admin');
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const [shuttles, total] = await Promise.all([
    db.shuttle.findMany({
      include: { contractor: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.shuttle.count(),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader title="Admin · Shuttles" backHref="/dashboard/admin" />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-4">Shuttles ({total})</h1>
        <Card className="mb-6">
          <CardContent className="py-3 divide-y text-sm">
            {shuttles.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground">No shuttles registered.</div>
            ) : shuttles.map(s => (
              <div key={s.id} className="py-2 flex justify-between">
                <div>
                  <div className="font-medium">{s.plate} · {s.model}</div>
                  <div className="text-xs text-muted-foreground">{s.contractor.name} · {s.contractor.phone}</div>
                </div>
                <div className="text-xs text-right">
                  <div>{s.capacity} seats · {s.vehicleType}</div>
                  <div className="text-muted-foreground">year {s.year}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/admin/shuttles" />

        <h2 className="text-lg font-semibold mb-3 mt-8">Register shuttle</h2>
        <NewShuttleForm />
      </main>
    </div>
  );
}
