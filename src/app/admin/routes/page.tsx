import type { Metadata } from 'next';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { DashboardHeader } from '@/components/dashboard-header';
import { Pagination } from '@/components/pagination';
import { NewRouteForm } from './new-route-form';
import { formatETB } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Routes · Admin' };

const PAGE_SIZE = 50;

export default async function AdminRoutesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireRole('platform_admin');
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const [routes, total] = await Promise.all([
    db.route.findMany({
      orderBy: { origin: 'asc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.route.count(),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader title="Admin · Routes" backHref="/dashboard/admin" />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-4">Routes ({total})</h1>
        <Card className="mb-6">
          <CardContent className="py-3 divide-y text-sm">
            {routes.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground">No routes yet.</div>
            ) : routes.map(r => (
              <div key={r.id} className="py-2 flex justify-between">
                <div>
                  <div className="font-medium">{r.origin} → {r.destination}</div>
                  <div className="text-xs text-muted-foreground">{r.distanceKm} km · {r.durationMin} min</div>
                </div>
                <div className="text-xs">{formatETB(r.fareCents)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/admin/routes" />

        <h2 className="text-lg font-semibold mb-3 mt-8">Create route</h2>
        <NewRouteForm />
      </main>
    </div>
  );
}
