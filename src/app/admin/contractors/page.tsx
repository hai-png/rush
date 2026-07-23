import type { Metadata } from 'next';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardHeader } from '@/components/dashboard-header';
import { Pagination } from '@/components/pagination';
import { VerifyButton } from './verify-button';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Drivers · Admin' };

const PAGE_SIZE = 50;

// FE-044: paginated contractors list (was unbounded, no pagination UI).
export default async function AdminContractorsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireRole('platform_admin');
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const [contractors, total] = await Promise.all([
    db.contractorProfile.findMany({
      include: { user: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.contractorProfile.count(),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader title="Admin · Contractors" backHref="/dashboard/admin" />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-4">Contractors ({total})</h1>
        <Card>
          <CardContent className="py-3 divide-y text-sm">
            {contractors.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground">No contractors yet.</div>
            ) : contractors.map(c => (
              <div key={c.id} className="py-2 flex items-center justify-between">
                <div>
                  <div className="font-medium">{c.user.name} <span className="text-xs text-muted-foreground">· {c.user.phone}</span></div>
                  <div className="text-xs text-muted-foreground">License: {c.licenseNumber} · {c.experienceYears}y exp · rating {c.rating.toFixed(1)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{c.verificationStatus}</Badge>
                  {c.verificationStatus === 'pending' && <VerifyButton id={c.id} />}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/admin/contractors" />
      </main>
    </div>
  );
}
