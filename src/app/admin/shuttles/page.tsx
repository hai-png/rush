import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { SignOutButton } from '@/components/sign-out-button';
import { NewShuttleForm } from './new-shuttle-form';

export const dynamic = 'force-dynamic';

export default async function AdminShuttlesPage() {
  await requireRole('platform_admin');
  const shuttles = await db.shuttle.findMany({
    include: { contractor: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard/admin" className="text-xl font-bold">Admin · Shuttles</Link>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-4">Shuttles ({shuttles.length})</h1>
        <Card className="mb-6">
          <CardContent className="py-3 divide-y text-sm">
            {shuttles.map(s => (
              <div key={s.id} className="py-2 flex justify-between">
                <div>
                  <div className="font-medium">{s.plate} · {s.model}</div>
                  <div className="text-xs text-muted-foreground">{s.contractor.name} · {s.contractor.phone}</div>
                </div>
                <div className="text-xs text-right">
                  <div>{s.capacity} seats · {s.vehicleType}</div>
                  <div className="text-muted-foreground">year {s.year}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <h2 className="text-lg font-semibold mb-3">Register shuttle</h2>
        <NewShuttleForm />
      </main>
    </div>
  );
}
