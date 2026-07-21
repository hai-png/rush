// Seat marketplace — list open seat releases, claim button.
import Link from 'next/link';
import { requireSession } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { ClaimButton } from './claim-button';
import { Plus } from 'lucide-react';

export default async function OpenSeatsPage() {
  const session = await requireSession();
  const releases = await db.seatRelease.findMany({
    where: { status: 'open', expiresAt: { gt: new Date() } },
    include: {
      trip: { include: { route: true, shuttle: true } },
      user: { select: { name: true } },
    },
    orderBy: { expiresAt: 'asc' },
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
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold">Seat marketplace</h1>
          {session.role === 'rider' && (
            <Button asChild size="sm"><Link href="/open-seats/new"><Plus className="h-4 w-4 mr-1" /> List a seat</Link></Button>
          )}
        </div>
        <p className="text-muted-foreground mb-6 text-sm">Open seats from riders who couldn't make their trip. Claim one for the route fare.</p>
        {releases.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">No open seats right now.</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {releases.map(r => (
              <Card key={r.id}>
                <CardContent className="py-3">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-semibold">{r.trip.route.origin} → {r.trip.route.destination}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(r.trip.departureAt).toLocaleString()} · {r.trip.shuttle.plate}
                      </div>
                    </div>
                    <Badge variant="outline">{r.window}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">Fare</div>
                      <div className="font-semibold">{(r.trip.route.fareCents / 100).toFixed(0)} ETB</div>
                    </div>
                    <div className="text-xs text-muted-foreground">Expires {new Date(r.expiresAt).toLocaleTimeString()}</div>
                  </div>
                  {r.userId === session.id ? (
                    <div className="mt-3 text-xs text-muted-foreground">This is your listing.</div>
                  ) : (
                    <ClaimButton releaseId={r.id} fare={r.trip.route.fareCents} />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
