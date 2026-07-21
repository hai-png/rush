// Rider dashboard — active subscriptions, recent rides, recent payments,
// unread notifications, open tickets.
import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Bell, Ticket, Calendar, Plus } from 'lucide-react';
import { CancelSubscriptionButton } from './cancel-button';
import { SignOutButton } from '@/components/sign-out-button';

export default async function RiderDashboardPage() {
  const session = await requireRole('rider', 'platform_admin');

  const [activeSubs, rides, recentPayments, openTickets, unreadNotifs] = await Promise.all([
    db.subscription.findMany({
      where: { userId: session.id, status: 'active' },
      include: { plan: true },
      orderBy: { endDate: 'asc' },
    }),
    db.ride.findMany({
      where: { userId: session.id },
      include: { trip: { include: { route: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    db.payment.findMany({
      where: { userId: session.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    db.supportTicket.count({ where: { userId: session.id, status: { in: ['open', 'in_progress'] } } }),
    db.notification.count({ where: { userId: session.id, readAt: null } }),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride</Link>
          <div className="flex gap-2 text-sm items-center">
            <Button asChild variant="ghost"><Link href="/plans">Plans</Link></Button>
            <Button asChild variant="ghost"><Link href="/open-seats">Marketplace</Link></Button>
            <Button asChild variant="ghost"><Link href="/tickets">Tickets</Link></Button>
            <Button asChild variant="ghost"><Link href="/notifications">Notifications {unreadNotifs > 0 && <Badge className="ml-1">{unreadNotifs}</Badge>}</Link></Button>
            <Button asChild variant="ghost"><Link href="/account">Account</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-6">Welcome, {session.phone}</h1>
        <div className="space-y-6">
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Active subscriptions</h2>
              <Button asChild size="sm"><Link href="/plans"><Plus className="h-4 w-4 mr-1" /> New subscription</Link></Button>
            </div>
            {activeSubs.length === 0 ? (
              <Card><CardContent className="py-6 text-center text-muted-foreground">
                No active subscriptions. <Link href="/plans" className="text-primary hover:underline">Browse plans →</Link>
              </CardContent></Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeSubs.map(s => (
                  <Card key={s.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{s.plan.name}</CardTitle>
                        <Badge>active</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="text-sm space-y-1">
                      <div className="flex justify-between"><span className="text-muted-foreground">Rides used</span><span>{s.ridesUsed} / {s.plan.ridesIncluded === -1 ? '∞' : s.plan.ridesIncluded}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Expires</span><span>{new Date(s.endDate).toLocaleDateString()}</span></div>
                      <div className="pt-2"><CancelSubscriptionButton id={s.id} /></div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <section>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Calendar className="h-4 w-4" /> Recent rides</h2>
              <Card>
                <CardContent className="py-3">
                  {rides.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-4">No rides yet.</div>
                  ) : (
                    <div className="divide-y">
                      {rides.map(r => (
                        <div key={r.id} className="py-2 text-sm flex justify-between">
                          <span>{r.trip?.route?.origin} → {r.trip?.route?.destination}</span>
                          <Badge variant="outline">{r.status}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><CreditCard className="h-4 w-4" /> Recent payments</h2>
              <Card>
                <CardContent className="py-3">
                  {recentPayments.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-4">No payments yet.</div>
                  ) : (
                    <div className="divide-y">
                      {recentPayments.map(p => (
                        <div key={p.id} className="py-2 text-sm flex justify-between">
                          <span className="font-mono text-xs">{p.reference}</span>
                          <span>{(p.amountCents / 100).toFixed(0)} ETB · <Badge variant="outline">{p.status}</Badge></span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </div>

          <section>
            <h2 className="text-lg font-semibold mb-3">Quick actions</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Button asChild variant="outline"><Link href="/tickets/new"><Ticket className="h-4 w-4 mr-1" /> New ticket</Link></Button>
              <Button asChild variant="outline"><Link href="/notifications"><Bell className="h-4 w-4 mr-1" /> Notifications</Link></Button>
              <Button asChild variant="outline"><Link href="/account/export">Export data</Link></Button>
              <Button asChild variant="outline"><Link href="/open-seats">Marketplace</Link></Button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
