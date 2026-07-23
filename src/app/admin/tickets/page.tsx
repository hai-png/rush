import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardHeader } from '@/components/dashboard-header';
import { Pagination } from '@/components/pagination';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Tickets · Admin' };

const PAGE_SIZE = 50;

export default async function AdminTicketsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireRole('platform_admin');
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const [tickets, total] = await Promise.all([
    db.supportTicket.findMany({
      include: { user: { select: { name: true, phone: true } }, _count: { select: { messages: true } } },
      orderBy: { updatedAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.supportTicket.count(),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader title="Admin · Tickets" backHref="/dashboard/admin" />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-2xl font-bold mb-4">Support tickets ({total})</h1>
        <Card>
          <CardContent className="py-3 divide-y text-sm">
            {tickets.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground">No tickets yet.</div>
            ) : tickets.map(t => (
              <Link key={t.id} href={`/tickets/${t.id}`} className="block py-2 hover:bg-accent/30 -mx-3 px-3 rounded">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium">{t.subject}</div>
                    <div className="text-xs text-muted-foreground">{t.user.name} · {t.user.phone} · {t._count.messages} messages</div>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline">{t.category}</Badge>
                    <Badge variant="outline">{t.priority}</Badge>
                    <Badge>{t.status}</Badge>
                  </div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/admin/tickets" />
      </main>
    </div>
  );
}
