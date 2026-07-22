import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { RouteMap } from '@/components/route-map-lazy';

export const dynamic = 'force-dynamic';

export default async function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const assignment = await db.routeAssignment.findUnique({
    where: { id },
    include: {
      route: { include: { pickups: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } } },
      shuttle: true,
      contractor: { select: { name: true, phone: true, contractorProfile: { select: { rating: true, verificationStatus: true } } } },
      trips: { where: { status: 'scheduled', departureAt: { gt: new Date() } }, orderBy: { departureAt: 'asc' }, take: 30 },
    },
  });
  if (!assignment || assignment.status !== 'active') notFound();

  const pattern = JSON.parse(assignment.schedulePattern);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Route Details</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/assignments">All routes</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{assignment.route.origin} → {assignment.route.destination}</h1>
          <div className="text-sm text-muted-foreground mt-1">
            Driver: {assignment.contractor.name} · Rating: {assignment.contractor.contractorProfile?.rating.toFixed(1) ?? '—'} · {assignment.shuttle.plate} ({assignment.shuttle.vehicleType})
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="outline">Fare: {(assignment.route.fareCents / 100).toFixed(2)} ETB</Badge>
            <Badge variant="outline">Schedule: {pattern.days?.join(', ')}</Badge>
            <Badge variant="outline">Windows: {pattern.windows?.join(', ')}</Badge>
            <Badge>{assignment.status}</Badge>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <Card>
            <CardContent className="py-4">
              <h2 className="font-semibold mb-3">Pickup Locations</h2>
              <div className="space-y-2">
                {assignment.route.pickups.map(p => (
                  <div key={p.id} className="flex justify-between items-center text-sm border-b pb-2">
                    <div>
                      <div className="font-medium">{p.name}</div>
                      {p.lat && <div className="text-xs text-muted-foreground">{p.lat.toFixed(4)}, {p.lng?.toFixed(4)}</div>}
                    </div>
                    <Badge variant="outline">~{p.estimatedPickupTime}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <h2 className="font-semibold mb-3">Route Map</h2>
              <RouteMap pickups={assignment.route.pickups} origin={assignment.route.origin} destination={assignment.route.destination} />
            </CardContent>
          </Card>
        </div>

        <h2 className="text-lg font-semibold mb-3">Upcoming Trips ({assignment.trips.length})</h2>
        {assignment.trips.length === 0 ? (
          <Card><CardContent className="py-4 text-center text-muted-foreground text-sm">No upcoming trips for this route.</CardContent></Card>
        ) : (
          <Card>
            <CardContent className="py-3 divide-y">
              {assignment.trips.map(t => (
                <div key={t.id} className="py-2 flex justify-between items-center text-sm">
                  <div>
                    <div className="font-medium">{new Date(t.departureAt).toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">{t.window} · {t.seatsBooked}/{assignment.shuttle.capacity} seats booked</div>
                  </div>
                  <Button asChild size="sm"><Link href={`/trips?assignment=${assignment.id}`}>Book</Link></Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
