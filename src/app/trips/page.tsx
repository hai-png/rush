import Link from 'next/link';
import { requireSession } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { BookRideButton } from './book-ride-button';

export const dynamic = 'force-dynamic';

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ assignment?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const assignmentFilter = sp.assignment;

  const trips = await db.trip.findMany({
    where: {
      status: 'scheduled',
      departureAt: { gt: new Date() },
      ...(assignmentFilter && { assignmentId: assignmentFilter }),
    },
    include: {
      route: { include: { pickups: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } } },
      shuttle: { include: { contractor: { select: { name: true } } } },
    },
    orderBy: { departureAt: 'asc' },
    take: 50,
  });

  // Pre-fetch the rider's active subscriptions so the book button knows what
  // subscription to charge against.
  const subs = session.role === 'rider' ? await db.subscription.findMany({
    where: { userId: session.id, status: 'active' },
    include: { plan: true },
  }) : [];

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
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-2xl font-bold mb-2">Upcoming trips</h1>
        <p className="text-muted-foreground mb-6 text-sm">Book a seat on any scheduled trip using your active subscription.</p>

        {trips.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">No upcoming trips.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {trips.map(t => {
              const seatsLeft = t.shuttle.capacity - t.seatsBooked;
              return (
                <Card key={t.id}>
                  <CardContent className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{t.route.origin} → {t.route.destination}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(t.departureAt).toLocaleString()} · {t.window} · {t.shuttle.plate} ({t.shuttle.vehicleType})
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Driver: {t.shuttle.contractor.name} · fare {(t.route.fareCents / 100).toFixed(2)} ETB
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant={seatsLeft > 0 ? 'default' : 'destructive'}>
                          {seatsLeft > 0 ? `${seatsLeft} seats left` : 'full'}
                        </Badge>
                        {session.role === 'rider' && (
                          <BookRideButton
                            tripId={t.id}
                            subs={subs.map(s => ({ id: s.id, name: s.plan.name, ridesIncluded: s.plan.ridesIncluded, ridesUsed: s.ridesUsed }))}
                            seatsLeft={seatsLeft}
                            pickups={t.route.pickups.map(p => ({ id: p.id, name: p.name, estimatedPickupTime: p.estimatedPickupTime }))}
                          />
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
