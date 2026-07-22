import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { AssignmentActions } from './assignment-actions';

export const dynamic = 'force-dynamic';

export default async function ContractorAssignmentsPage() {
  const session = await requireRole('contractor', 'platform_admin');
  const assignments = await db.routeAssignment.findMany({
    where: session.role === 'platform_admin' ? {} : { contractorId: session.id },
    include: {
      route: true,
      shuttle: true,
      assignedBy: { select: { name: true } },
      _count: { select: { trips: true, rides: true } },
    },
    orderBy: { monthStart: 'desc' },
    take: 50,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride · My Assignments</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/contractor">Dashboard</Link></Button>
            <Button asChild variant="ghost"><Link href="/dashboard/contractor/trips">Trips</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-2xl font-bold mb-2">Route Assignments</h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Routes assigned to you by the admin. Accept to activate; the system generates daily trips from the schedule.
        </p>

        {assignments.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">No assignments yet.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {assignments.map(a => {
              const pattern = JSON.parse(a.schedulePattern);
              return (
                <Card key={a.id}>
                  <CardContent className="py-3">
                    <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
                      <div>
                        <div className="font-medium text-lg">{a.route.origin} → {a.route.destination}</div>
                        <div className="text-xs text-muted-foreground">
                          Shuttle: {a.shuttle.plate} ({a.shuttle.capacity} seats) · Assigned by: {a.assignedBy?.name ?? '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Month: {new Date(a.monthStart).toLocaleDateString()} – {new Date(a.monthEnd).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Schedule: {pattern.days?.join(', ')} · {pattern.windows?.join(', ')}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {a._count.trips} trips generated · {a._count.rides} rides booked · {a.seatsBooked}/{a.maxSeats} seats
                        </div>
                      </div>
                      <Badge variant={
                        a.status === 'active' ? 'default' :
                        a.status === 'assigned' ? 'secondary' :
                        a.status === 'completed' ? 'outline' :
                        'destructive'
                      }>{a.status}</Badge>
                    </div>
                    {a.status === 'assigned' && (
                      <div className="border-t pt-2 mt-2">
                        <AssignmentActions id={a.id} />
                      </div>
                    )}
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
