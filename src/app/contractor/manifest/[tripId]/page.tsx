import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { MarkRideStatus } from './mark-ride-status';

export default async function TripManifestPage({ params }: { params: Promise<{ tripId: string }> }) {
  const session = await requireRole('contractor', 'platform_admin');
  const { tripId } = await params;
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    include: {
      route: true,
      shuttle: true,
      rides: { include: { user: { select: { name: true, phone: true } }, pickupLocation: true } },
    },
  });
  if (!trip) notFound();
  if (trip.driverId !== session.id && session.role !== 'platform_admin') notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Trip Manifest</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/contractor/trips">My Trips</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-4">
          <h1 className="text-xl font-bold">{trip.route.origin} → {trip.route.destination}</h1>
          <div className="text-sm text-muted-foreground">
            {new Date(trip.departureAt).toLocaleString()} · {trip.shuttle.plate} · {trip.window} · {trip.seatsBooked}/{trip.shuttle.capacity} seats
          </div>
          <Badge variant="outline" className="mt-1">{trip.status}</Badge>
        </div>
        <h2 className="text-lg font-semibold mb-3">Passenger Manifest ({trip.rides.length})</h2>
        {trip.rides.length === 0 ? (
          <Card><CardContent className="py-4 text-center text-muted-foreground text-sm">No riders booked yet.</CardContent></Card>
        ) : (
          <Card>
            <CardContent className="py-3 divide-y">
              {trip.rides.map(r => (
                <div key={r.id} className="py-2 flex justify-between items-center text-sm">
                  <div>
                    <div className="font-medium">{r.user.name}</div>
                    <div className="text-xs text-muted-foreground">{r.user.phone}</div>
                    {r.pickupLocation && <div className="text-xs text-muted-foreground">Pickup: {r.pickupLocation.name} (~{r.pickupLocation.estimatedPickupTime})</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={r.status === 'completed' ? 'default' : r.status === 'boarded' ? 'secondary' : 'outline'}>{r.status}</Badge>
                    {trip.status === 'in_transit' && r.status === 'booked' && <MarkRideStatus rideId={r.id} action="boarded" />}
                    {trip.status === 'in_transit' && r.status === 'boarded' && <MarkRideStatus rideId={r.id} action="completed" />}
                    {r.status === 'booked' && <MarkRideStatus rideId={r.id} action="no_show" />}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
