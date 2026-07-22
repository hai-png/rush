import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { RevokeSessionButton } from './revoke-session-button';

export const dynamic = 'force-dynamic';

export default async function SessionsPage() {
  const session = await requireRole('rider', 'platform_admin');
  const sessions = await db.session.findMany({
    where: { userId: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Active Sessions</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/rider/security">Security</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">Active Sessions</h1>
        {sessions.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">No active sessions.</CardContent></Card>
        ) : (
          <Card>
            <CardContent className="py-3 divide-y">
              {sessions.map(s => (
                <div key={s.id} className="py-3 flex justify-between items-center">
                  <div>
                    <div className="text-sm font-medium">{s.userAgent || 'Unknown device'}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.ipAddress || 'Unknown IP'} · created {new Date(s.createdAt).toLocaleString()} · expires {new Date(s.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  <RevokeSessionButton id={s.id} />
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
