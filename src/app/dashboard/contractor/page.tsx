// Contractor dashboard — profile, shuttles, upcoming trips, completed rides.
import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { TripActions } from '@/components/trip-actions';

export default async function ContractorDashboardPage() {
  const session = await requireRole('contractor', 'platform_admin');

  const [profile, shuttles, upcomingTrips, completedRides] = await Promise.all([
    db.contractorProfile.findUnique({ where: { userId: session.id } }),
    db.shuttle.findMany({ where: { contractorId: session.id } }),
    db.trip.findMany({
      where: { driverId: session.id, status: 'scheduled', departureAt: { gt: new Date() } },
      include: { route: true, shuttle: true },
      orderBy: { departureAt: 'asc' },
      take: 10,
    }),
    db.ride.count({ where: { trip: { driverId: session.id }, status: 'completed' } }),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/contractor/assignments">My Assignments</Link></Button>
            <Button asChild variant="ghost"><Link href="/dashboard/contractor/trips">My trips</Link></Button>
            <Button asChild variant="ghost"><Link href="/dashboard/contractor/documents">Documents</Link></Button>
            <Button asChild variant="ghost"><Link href="/account">Account</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-6">Contractor: {session.phone}</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Verification</CardTitle></CardHeader>
            <CardContent>
              {profile ? <Badge>{profile.verificationStatus}</Badge> : <span className="text-muted-foreground text-sm">No profile</span>}
              {profile?.verificationReason && <p className="text-xs mt-2 text-muted-foreground">{profile.verificationReason}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Rating</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{profile?.rating.toFixed(1) ?? '—'}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Completed rides</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{completedRides}</CardContent>
          </Card>
        </div>

        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Shuttles</h2>
          {shuttles.length === 0 ? (
            <Card><CardContent className="py-4 text-center text-muted-foreground text-sm">No shuttles registered.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {shuttles.map(s => (
                <Card key={s.id}>
                  <CardContent className="py-3 text-sm">
                    <div className="font-semibold">{s.plate}</div>
                    <div className="text-muted-foreground">{s.model}</div>
                    <div className="text-xs mt-1">{s.capacity} seats · {s.vehicleType}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">Upcoming trips</h2>
          {upcomingTrips.length === 0 ? (
            <Card><CardContent className="py-4 text-center text-muted-foreground text-sm">No upcoming trips.</CardContent></Card>
          ) : (
            <Card>
              <CardContent className="py-3 divide-y">
                {upcomingTrips.map(t => (
                  <div key={t.id} className="py-2 flex justify-between items-center text-sm">
                    <div>
                      <div className="font-medium">{t.route.origin} → {t.route.destination}</div>
                      <div className="text-xs text-muted-foreground">{t.shuttle.plate} · {new Date(t.departureAt).toLocaleString()}</div>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="outline">{t.seatsBooked}/{t.shuttle.capacity}</Badge>
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
