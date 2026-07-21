// Rider's seat-release listings — view + cancel.
import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { CancelReleaseButton } from './cancel-release-button';

export default async function RiderListingsPage() {
  const session = await requireRole('rider', 'platform_admin');
  const releases = await db.seatRelease.findMany({
    where: { userId: session.id },
    include: {
      trip: { include: { route: true, shuttle: true } },
      claims: { include: { claimant: { select: { name: true, phone: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride · My listings</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/rider">Dashboard</Link></Button>
            <Button asChild variant="ghost"><Link href="/open-seats">Marketplace</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-2">My seat listings</h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Seats you've released to the marketplace. Cancel them to reclaim the seat (if not yet claimed).
        </p>

        {releases.length === 0 ? (
          <Card><CardContent className="py-6 text-center">
            <p className="text-muted-foreground mb-3">You have no seat listings yet.</p>
            <Button asChild variant="outline"><Link href="/open-seats/new">List a seat</Link></Button>
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {releases.map(r => (
              <Card key={r.id}>
                <CardContent className="py-3">
                  <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
                    <div>
                      <div className="font-medium">{r.trip.route.origin} → {r.trip.route.destination}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(r.trip.departureAt).toLocaleString()} · {r.trip.shuttle.plate} · {r.window}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Listed {new Date(r.createdAt).toLocaleDateString()} · expires {new Date(r.expiresAt).toLocaleString()}
                      </div>
                    </div>
                    <Badge variant={
                      r.status === 'open' ? 'default' :
                      r.status === 'claimed' ? 'secondary' :
                      r.status === 'expired' ? 'outline' :
                      'destructive'
                    }>{r.status}</Badge>
                  </div>
                  {r.claims.length > 0 && (
                    <div className="text-xs border-t pt-2 mt-2">
                      <div className="font-medium mb-1">Claims ({r.claims.length})</div>
                      {r.claims.map(c => (
                        <div key={c.id} className="text-muted-foreground">
                          {c.claimant.name} · {c.claimant.phone} · status: {c.status}
                        </div>
                      ))}
                    </div>
                  )}
                  {r.status === 'open' && (
                    <div className="border-t pt-2 mt-2">
                      <CancelReleaseButton id={r.id} />
                    </div>
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
