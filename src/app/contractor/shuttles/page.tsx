import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { RegisterShuttleForm } from './register-shuttle-form';

export const dynamic = 'force-dynamic';

export default async function ContractorShuttlesPage() {
  const session = await requireRole('contractor', 'platform_admin');
  const shuttles = await db.shuttle.findMany({
    where: { contractorId: session.id },
    include: { _count: { select: { trips: true, assignments: true } } },
    orderBy: { plate: 'asc' },
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">My Shuttles</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/contractor">Dashboard</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Shuttles ({shuttles.length})</h1>
          <RegisterShuttleForm />
        </div>
        {shuttles.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">No shuttles registered yet.</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {shuttles.map(s => (
              <Card key={s.id}>
                <CardContent className="py-3">
                  <div className="flex justify-between items-start mb-1">
                    <div className="font-medium text-lg">{s.plate}</div>
                    <Badge variant={s.isActive ? 'default' : 'secondary'}>{s.isActive ? 'active' : 'inactive'}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">{s.model} · {s.vehicleType} · {s.capacity} seats · {s.year}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s._count.trips} trips · {s._count.assignments} assignments</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
