import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { ListSeatForm } from './list-seat-form';
import { formatETB, formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'List a Seat · Addis Ride' };

export default async function ListSeatPage() {
  const session = await requireRole('rider', 'platform_admin');

  const rides = await db.ride.findMany({
    where: {
      userId: session.id,
      status: 'booked',
      trip: { status: 'scheduled', departureAt: { gt: new Date() } },
    },
    include: { trip: { include: { route: true, shuttle: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/open-seats">Marketplace</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">List a seat for sale</h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Can't make a trip you're booked on? List your seat for another rider to claim.
        </p>

        {rides.length === 0 ? (
          <Card><CardContent className="py-6 text-center">
            <p className="text-muted-foreground mb-3">You have no upcoming booked rides to release.</p>
            <Button asChild variant="outline"><Link href="/dashboard/rider">Back to dashboard</Link></Button>
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {rides.map(r => (
              <Card key={r.id}>
                <CardContent className="py-3">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-medium">{r.trip.route.origin} → {r.trip.route.destination}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(r.trip.departureAt)} · {r.trip.shuttle.plate}
                      </div>
                    </div>
                    <Badge variant="outline">fare {formatETB(r.trip.route.fareCents)}</Badge>
                  </div>
                  <ListSeatForm ride={r} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
