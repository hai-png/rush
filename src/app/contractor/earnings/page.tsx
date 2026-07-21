import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';

export default async function ContractorEarningsPage() {
  const session = await requireRole('contractor', 'platform_admin');
  const [trips, rides, assignments] = await Promise.all([
    db.trip.count({ where: { driverId: session.id, status: 'completed' } }),
    db.ride.findMany({
      where: { trip: { driverId: session.id }, status: 'completed' },
      include: { trip: { include: { route: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    db.routeAssignment.count({ where: { contractorId: session.id, status: 'active' } }),
  ]);

  const profile = await db.contractorProfile.findUnique({ where: { userId: session.id } });
  const totalFare = rides.reduce((sum, r) => sum + (r.trip.route.fareCents || 0), 0);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Earnings</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/contractor">Dashboard</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-6">Earnings & Performance</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Completed trips</div><div className="text-2xl font-bold">{trips}</div></CardContent></Card>
          <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Completed rides</div><div className="text-2xl font-bold">{rides.length}</div></CardContent></Card>
          <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Active assignments</div><div className="text-2xl font-bold">{assignments}</div></CardContent></Card>
          <Card><CardContent className="py-4"><div className="text-xs text-muted-foreground">Rating</div><div className="text-2xl font-bold">{profile?.rating.toFixed(1) ?? '—'}</div></CardContent></Card>
        </div>
        <Card>
          <CardContent className="py-3 divide-y">
            {rides.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">No completed rides yet.</div>
            ) : rides.map(r => (
              <div key={r.id} className="py-2 flex justify-between items-center text-sm">
                <div>
                  <div className="font-medium">{r.trip.route.origin} → {r.trip.route.destination}</div>
                  <div className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</div>
                </div>
                <span className="font-semibold">{(r.trip.route.fareCents / 100).toFixed(0)} ETB</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
