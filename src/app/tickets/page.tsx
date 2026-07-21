// Tickets list + new ticket link.
import Link from 'next/link';
import { requireSession } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { Plus } from 'lucide-react';

export default async function TicketsPage() {
  const session = await requireSession();
  const tickets = await db.supportTicket.findMany({
    where: { userId: session.id },
    include: { _count: { select: { messages: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/rider">Dashboard</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Support tickets</h1>
          <Button asChild size="sm"><Link href="/tickets/new"><Plus className="h-4 w-4 mr-1" /> New</Link></Button>
        </div>
        {tickets.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">No tickets. <Link href="/tickets/new" className="text-primary hover:underline">Create one →</Link></CardContent></Card>
        ) : (
          <Card>
            <CardContent className="py-3 divide-y">
              {tickets.map(t => (
                <Link key={t.id} href={`/tickets/${t.id}`} className="block py-3 hover:bg-accent/30 -mx-3 px-3 rounded">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">{t.subject}</div>
                      <div className="text-xs text-muted-foreground">{t.category} · {t._count.messages} messages</div>
                    </div>
                    <Badge variant="outline">{t.status}</Badge>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
