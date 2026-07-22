import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { SignOutButton } from '@/components/sign-out-button';
import { NewRouteForm } from './new-route-form';

export default async function AdminRoutesPage() {
  await requireRole('platform_admin');
  const routes = await db.route.findMany({ orderBy: { origin: 'asc' } });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard/admin" className="text-xl font-bold">Admin · Routes</Link>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-4">Routes ({routes.length})</h1>
        <Card className="mb-6">
          <CardContent className="py-3 divide-y text-sm">
            {routes.map(r => (
              <div key={r.id} className="py-2 flex justify-between">
                <div>
                  <div className="font-medium">{r.origin} → {r.destination}</div>
                  <div className="text-xs text-muted-foreground">{r.distanceKm} km · {r.durationMin} min</div>
                </div>
                <div className="text-xs">{(r.fareCents / 100).toFixed(2)} ETB</div>
              </div>
            ))}
          </CardContent>
        </Card>
        <h2 className="text-lg font-semibold mb-3">Create route</h2>
        <NewRouteForm />
      </main>
    </div>
  );
}
