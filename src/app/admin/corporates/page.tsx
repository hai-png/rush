import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';

export default async function AdminCorporatesPage() {
  await requireRole('platform_admin');
  const corporates = await db.corporate.findMany({
    include: { _count: { select: { members: true, subscriptions: true } }, adminUser: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard/admin" className="text-xl font-bold">Admin · Corporates</Link>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-2xl font-bold mb-4">Corporates ({corporates.length})</h1>
        <Card>
          <CardContent className="py-3 divide-y">
            {corporates.map(c => (
              <div key={c.id} className="py-3 flex justify-between items-center">
                <div>
                  <div className="font-medium">{c.name} <span className="font-mono text-xs text-muted-foreground ml-2">{c.code}</span></div>
                  <div className="text-xs text-muted-foreground">Admin: {c.adminUser.name} · {c.adminUser.phone}</div>
                  <div className="text-xs text-muted-foreground">Subsidy: {c.subsidyPercent}% · {c._count.members} members · {c._count.subscriptions} subs</div>
                </div>
                <Badge variant={c.isActive ? 'default' : 'secondary'}>{c.isActive ? 'active' : 'inactive'}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
