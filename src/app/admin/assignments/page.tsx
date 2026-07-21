// Admin: route assignments — assign routes to contractors for the month.
import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { CreateAssignmentButton } from './create-assignment-button';

export default async function AdminAssignmentsPage() {
  await requireRole('platform_admin');
  const assignments = await db.routeAssignment.findMany({
    include: {
      route: true,
      shuttle: true,
      contractor: { select: { name: true, phone: true } },
      _count: { select: { trips: true, rides: true } },
    },
    orderBy: { monthStart: 'desc' },
    take: 100,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard/admin" className="text-xl font-bold">Admin · Assignments</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/admin">Dashboard</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Route Assignments ({assignments.length})</h1>
          <CreateAssignmentButton />
        </div>
        <p className="text-muted-foreground mb-6 text-sm">
          Assign routes to contractors for a month. The system generates daily trips from the schedule pattern.
          Contractors must accept before the assignment becomes active.
        </p>

        {assignments.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">No assignments yet.</CardContent></Card>
        ) : (
          <Card>
            <CardContent className="py-3 divide-y">
              {assignments.map(a => {
                const pattern = JSON.parse(a.schedulePattern);
                return (
                  <div key={a.id} className="py-3 flex flex-wrap justify-between items-start gap-2">
                    <div>
                      <div className="font-medium">{a.route.origin} → {a.route.destination}</div>
                      <div className="text-xs text-muted-foreground">
                        Contractor: {a.contractor.name} · Shuttle: {a.shuttle.plate} ({a.shuttle.capacity} seats)
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Month: {new Date(a.monthStart).toLocaleDateString()} – {new Date(a.monthEnd).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Schedule: {pattern.days?.join(', ')} · {pattern.windows?.join(', ')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {a._count.trips} trips generated · {a._count.rides} rides booked
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={
                        a.status === 'active' ? 'default' :
                        a.status === 'assigned' ? 'secondary' :
                        a.status === 'completed' ? 'outline' :
                        'destructive'
                      }>{a.status}</Badge>
                      {a.maxSeats > 0 && (
                        <span className="text-xs text-muted-foreground">{a.seatsBooked}/{a.maxSeats} seats</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
