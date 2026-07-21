// Ticket detail — show messages + reply box.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { ReplyForm } from './reply-form';

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true, role: true } } },
      },
    },
  });
  if (!ticket) notFound();
  if (ticket.userId !== session.id && session.role !== 'platform_admin') notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/tickets">All tickets</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-4">
          <h1 className="text-xl font-bold">{ticket.subject}</h1>
          <div className="text-sm text-muted-foreground">
            {ticket.category} · {ticket.priority} priority · <Badge variant="outline">{ticket.status}</Badge>
          </div>
        </div>
        <Card className="mb-4">
          <CardContent className="py-3 divide-y">
            {ticket.messages.map(m => (
              <div key={m.id} className="py-3">
                <div className="text-xs text-muted-foreground mb-1">
                  <span className="font-medium">{m.author.name}</span> · {m.author.role} · {new Date(m.createdAt).toLocaleString()}
                </div>
                <div className="text-sm whitespace-pre-wrap">{m.body}</div>
              </div>
            ))}
          </CardContent>
        </Card>
        {ticket.status !== 'closed' && (
          <Card>
            <CardContent className="py-4">
              <ReplyForm ticketId={ticket.id} />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
