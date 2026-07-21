// Rider: browse route assignments — see which routes are available this month,
// against the trips generated from the assignment.
import Link from 'next/link';
import { requireSession } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';

export default async function AssignmentsPage() {
  const session = await requireSession();
  const now = new Date();
  const assignments = await db.routeAssignment.findMany({
    where: {
      status: 'active',
      monthStart: { lte: now },
      monthEnd: { gte: now },
    },
    include: {
      route: { include: { pickups: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } } },
      shuttle: true,
      contractor: { select: { name: true, phone: true, contractorProfile: { select: { rating: true, verificationStatus: true } } } },
      _count: { select: { rides: true } },
    },
    orderBy: { monthStart: 'desc' },
    take: 50,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride · Routes</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/rider">Dashboard</Link></Button>
            <Button asChild variant="ghost"><Link href="/trips">Trips</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-2xl font-bold mb-2">Available routes this month</h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Contractors committed to these routes for the month. Pick a route to see pickup locations and book rides.
        </p>

        {assignments.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">No active route assignments this month.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {assignments.map(a => {
              const pattern = JSON.parse(a.schedulePattern);
              return (
                <Card key={a.id}>
                  <CardContent className="py-3">
                    <div className="flex flex-wrap justify-between items-start gap-2 mb-3">
                      <div>
                        <div className="font-medium text-lg">{a.route.origin} → {a.route.destination}</div>
                        <div className="text-xs text-muted-foreground">
                          Driver: {a.contractor.name} · Rating: {a.contractor.contractorProfile?.rating.toFixed(1) ?? '—'} · Shuttle: {a.shuttle.plate} ({a.shuttle.vehicleType})
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Schedule: {pattern.days?.join(', ')} · {pattern.windows?.join(', ')}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Fare: {(a.route.fareCents / 100).toFixed(0)} ETB · {a._count.rides} rides booked · {a.seatsBooked}/{a.maxSeats} seats used
                        </div>
                      </div>
                      <Badge>active</Badge>
                    </div>

                    {/* Pickup locations */}
                    <div className="border-t pt-2">
                      <div className="text-xs font-medium mb-1">Pickup locations (choose when booking):</div>
                      <div className="flex flex-wrap gap-2">
                        {a.route.pickups.map(p => (
                          <span key={p.id} className="text-xs bg-muted rounded-md px-2 py-1">
                            {p.name} <span className="text-muted-foreground">~{p.estimatedPickupTime}</span>
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="border-t pt-2 mt-2 flex gap-2">
                      <Button asChild size="sm" variant="outline"><Link href={`/assignments/${a.id}`}>View details</Link></Button>
                      <Button asChild size="sm"><Link href={`/trips?assignment=${a.id}`}>Book a ride</Link></Button>
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
