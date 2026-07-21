import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';

export default async function RiderRidesPage() {
  const session = await requireRole('rider', 'platform_admin');
  const rides = await db.ride.findMany({
    where: { userId: session.id },
    include: {
      trip: { include: { route: true, shuttle: true } },
      pickupLocation: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Ride History</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/rider">Dashboard</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-6">My Rides</h1>
        {rides.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">No rides yet. <Link href="/trips" className="text-primary hover:underline">Browse trips →</Link></CardContent></Card>
        ) : (
          <Card>
            <CardContent className="py-3 divide-y">
              {rides.map(r => (
                <div key={r.id} className="py-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">{r.trip.route.origin} → {r.trip.route.destination}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(r.trip.departureAt).toLocaleString()} · {r.trip.shuttle.plate}
                      </div>
                      {r.pickupLocation && (
                        <div className="text-xs text-muted-foreground">
                          Pickup: {r.pickupLocation.name} (~{r.pickupLocation.estimatedPickupTime})
                        </div>
                      )}
                    </div>
                    <Badge variant={r.status === 'completed' ? 'default' : r.status === 'cancelled' ? 'destructive' : 'outline'}>
                      {r.status}
                    </Badge>
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
