import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { RenewButton } from './renew-button';

export default async function RiderSubscriptionsPage() {
  const session = await requireRole('rider', 'platform_admin');
  const subs = await db.subscription.findMany({
    where: { userId: session.id },
    include: { plan: true, payments: { orderBy: { createdAt: 'desc' }, take: 5 } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">My Subscriptions</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/rider">Dashboard</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Subscriptions</h1>
          <Button asChild size="sm"><Link href="/plans">New subscription</Link></Button>
        </div>
        {subs.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">No subscriptions yet.</CardContent></Card>
        ) : (
          <div className="space-y-4">
            {subs.map(s => (
              <Card key={s.id}>
                <CardContent className="py-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-medium text-lg">{s.plan.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(s.startDate).toLocaleDateString()} – {new Date(s.endDate).toLocaleDateString()}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Rides: {s.ridesUsed} / {s.plan.ridesIncluded === -1 ? '∞' : s.plan.ridesIncluded}
                      </div>
                    </div>
                    <Badge variant={s.status === 'active' ? 'default' : 'secondary'}>{s.status}</Badge>
                  </div>
                  {s.payments.length > 0 && (
                    <div className="border-t pt-2 mt-2">
                      <div className="text-xs font-medium mb-1">Recent payments</div>
                      {s.payments.map(p => (
                        <div key={p.id} className="text-xs flex justify-between">
                          <span className="font-mono">{p.reference.slice(0, 20)}…</span>
                          <span>{(p.amountCents / 100).toFixed(0)} ETB · <Badge variant="outline">{p.status}</Badge></span>
                        </div>
                      ))}
                    </div>
                  )}
                  {s.status === 'active' && <RenewButton subId={s.id} />}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
