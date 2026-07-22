import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { Plus, Calendar } from 'lucide-react';
import { TripActions } from '@/components/trip-actions';
import { CreateTripForm } from './create-trip-form';

export default async function ContractorTripsPage() {
  const session = await requireRole('contractor', 'platform_admin');
  const [trips, shuttles, routes] = await Promise.all([
    db.trip.findMany({
      where: { driverId: session.id },
      include: { route: true, shuttle: true, _count: { select: { rides: true } } },
      orderBy: { departureAt: 'desc' },
      take: 50,
    }),
    db.shuttle.findMany({ where: { contractorId: session.id, isActive: true } }),
    db.route.findMany({ where: { isActive: true }, orderBy: { origin: 'asc' } }),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride · Trips</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/contractor">Dashboard</Link></Button>
            <Button asChild variant="ghost"><Link href="/dashboard/contractor/documents">Documents</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">My trips</h1>
        </div>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Plus className="h-4 w-4" /> Schedule a new trip</h2>
          {shuttles.length === 0 || routes.length === 0 ? (
            <Card><CardContent className="py-4 text-center text-muted-foreground text-sm">
              You need at least one shuttle and one active route before scheduling a trip.
            </CardContent></Card>
          ) : (
            <CreateTripForm shuttles={shuttles} routes={routes} />
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Calendar className="h-4 w-4" /> All trips ({trips.length})</h2>
          {trips.length === 0 ? (
            <Card><CardContent className="py-4 text-center text-muted-foreground text-sm">No trips yet.</CardContent></Card>
          ) : (
            <Card>
              <CardContent className="py-3 divide-y">
                {trips.map(t => (
                  <div key={t.id} className="py-2 flex flex-wrap justify-between items-center text-sm">
                    <div>
                      <div className="font-medium">{t.route.origin} → {t.route.destination}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(t.departureAt).toLocaleString()} · {t.shuttle.plate} · {t._count.rides} ride(s) booked · {t.seatsBooked}/{t.shuttle.capacity} seats
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{t.window}</Badge>
                      <Badge variant={t.status === 'scheduled' ? 'default' : 'secondary'}>{t.status}</Badge>
                      <TripActions tripId={t.id} status={t.status} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}
