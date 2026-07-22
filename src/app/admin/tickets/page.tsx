import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';

export const dynamic = 'force-dynamic';

export default async function AdminTicketsPage() {
  await requireRole('platform_admin');
  const tickets = await db.supportTicket.findMany({
    include: { user: { select: { name: true, phone: true } }, _count: { select: { messages: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard/admin" className="text-xl font-bold">Admin · Tickets</Link>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-2xl font-bold mb-4">Support tickets ({tickets.length})</h1>
        <Card>
          <CardContent className="py-3 divide-y text-sm">
            {tickets.map(t => (
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
      </main>
    </div>
  );
}
