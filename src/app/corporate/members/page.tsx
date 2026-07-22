import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { MemberActions } from '@/app/dashboard/corporate/member-actions';

export default async function CorporateMembersPage() {
  const session = await requireRole('corporate_admin', 'platform_admin');
  const corp = await db.corporate.findUnique({
    where: session.role === 'platform_admin' ? undefined : { adminUserId: session.id },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, phone: true, email: true } } },
        orderBy: [{ approvalStatus: 'asc' }, { createdAt: 'desc' }],
      },
    },
  });

  if (!corp) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card><CardContent className="py-6 text-center">No corporate found.</CardContent></Card>
      </div>
    );
  }

  const pending = corp.members.filter(m => m.approvalStatus === 'pending');
  const approved = corp.members.filter(m => m.approvalStatus === 'approved');
  const rejected = corp.members.filter(m => m.approvalStatus === 'rejected');

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride · Members</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/corporate">Dashboard</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-2">{corp.name} — Members</h1>
        <p className="text-muted-foreground mb-6 text-sm">
          {pending.length} pending · {approved.length} approved · {rejected.length} rejected
        </p>

        {pending.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">Pending approval ({pending.length})</h2>
            <Card>
              <CardContent className="py-3 divide-y">
                {pending.map(m => (
                  <div key={m.id} className="py-3 flex flex-wrap justify-between items-center gap-2">
                    <div>
                      <div className="font-medium">{m.user.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.user.phone} {m.user.email && `· ${m.user.email}`} · employee ID: {m.employeeId}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Requested {new Date(m.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <MemberActions id={m.id} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )}

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Approved ({approved.length})</h2>
          {approved.length === 0 ? (
            <Card><CardContent className="py-4 text-center text-muted-foreground text-sm">No approved members.</CardContent></Card>
          ) : (
            <Card>
              <CardContent className="py-3 divide-y">
                {approved.map(m => (
                  <div key={m.id} className="py-2 flex justify-between items-center text-sm">
                    <div>
                      <div className="font-medium">{m.user.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.user.phone} · employee ID: {m.employeeId} · {m.ridesUsedThisMonth} rides used this month
                      </div>
                    </div>
                    <Badge>active</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </section>

        {rejected.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3">Rejected ({rejected.length})</h2>
            <Card>
              <CardContent className="py-3 divide-y">
                {rejected.map(m => (
                  <div key={m.id} className="py-2 flex justify-between items-center text-sm">
                    <div>
                      <div className="font-medium">{m.user.name}</div>
                      <div className="text-xs text-muted-foreground">{m.user.phone}</div>
                    </div>
                    <Badge variant="secondary">rejected</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )}
      </main>
    </div>
  );
}
