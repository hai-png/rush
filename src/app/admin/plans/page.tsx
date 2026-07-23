import type { Metadata } from 'next';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { DashboardHeader } from '@/components/dashboard-header';
import { Pagination } from '@/components/pagination';
import { NewPlanForm } from './new-plan-form';
import { formatETB } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Plans · Admin' };

const PAGE_SIZE = 50;

// FE-044: paginated plans list (was unbounded, no pagination UI).
export default async function AdminPlansPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireRole('platform_admin');
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const [plans, total] = await Promise.all([
    db.subscriptionPlan.findMany({
      orderBy: { sortOrder: 'asc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.subscriptionPlan.count(),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader title="Admin · Plans" backHref="/dashboard/admin" />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-4">Subscription plans ({total})</h1>
        <Card className="mb-6">
          <CardContent className="py-3 divide-y text-sm">
            {plans.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground">No plans yet.</div>
            ) : plans.map(p => (
              <div key={p.id} className="py-2 flex justify-between">
                <div>
                  <div className="font-medium">{p.name} ({p.slug})</div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                </div>
                <div className="text-right text-xs">
                  <div>{formatETB(p.priceCents)} · {p.durationDays}d</div>
                  <div className="text-muted-foreground">{p.ridesIncluded === -1 ? 'unlimited' : `${p.ridesIncluded} rides`}{p.isTrial ? ' · trial' : ''}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/admin/plans" />

        <h2 className="text-lg font-semibold mb-3 mt-8">Create new plan</h2>
        <NewPlanForm />
      </main>
    </div>
  );
}
