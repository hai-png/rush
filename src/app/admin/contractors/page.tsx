import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { VerifyButton } from './verify-button';

export default async function AdminContractorsPage() {
  await requireRole('platform_admin');
  const contractors = await db.contractorProfile.findMany({
    include: { user: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard/admin" className="text-xl font-bold">Admin · Contractors</Link>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-4">Contractors ({contractors.length})</h1>
        <Card>
          <CardContent className="py-3 divide-y text-sm">
            {contractors.map(c => (
              <div key={c.id} className="py-2 flex items-center justify-between">
                <div>
                  <div className="font-medium">{c.user.name} <span className="text-xs text-muted-foreground">· {c.user.phone}</span></div>
                  <div className="text-xs text-muted-foreground">License: {c.licenseNumber} · {c.experienceYears}y exp · rating {c.rating.toFixed(1)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{c.verificationStatus}</Badge>
                  {c.verificationStatus === 'pending' && <VerifyButton id={c.id} />}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
