import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';

export default async function AdminSubscriptionsPage() {
  await requireRole('platform_admin');
  const subs = await db.subscription.findMany({
    include: { user: { select: { name: true, phone: true } }, plan: true, corporate: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard/admin" className="text-xl font-bold">Admin · Subscriptions</Link>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-4">All Subscriptions ({subs.length})</h1>
        <Card>
          <CardContent className="py-3 divide-y">
            {subs.map(s => (
              <div key={s.id} className="py-2 flex justify-between items-center text-sm">
                <div>
                  <div className="font-medium">{s.user.name} · {s.user.phone}</div>
                  <div className="text-xs text-muted-foreground">{s.plan.name} · {new Date(s.startDate).toLocaleDateString()} – {new Date(s.endDate).toLocaleDateString()} · {s.ridesUsed}/{s.plan.ridesIncluded === -1 ? '∞' : s.plan.ridesIncluded} rides</div>
                  {s.corporate && <div className="text-xs text-muted-foreground">Corporate: {s.corporate.name}</div>}
                </div>
                <Badge variant={s.status === 'active' ? 'default' : 'secondary'}>{s.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
