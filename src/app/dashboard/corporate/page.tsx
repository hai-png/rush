// Corporate dashboard — manage invites + members.
import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { CreateInviteButton } from './create-invite-button';
import { MemberActions } from './member-actions';

export default async function CorporateDashboardPage() {
  const session = await requireRole('corporate_admin', 'platform_admin');
  const corp = session.role === 'platform_admin'
    ? await db.corporate.findFirst({
        include: {
          members: { include: { user: { select: { id: true, name: true, phone: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 100 },
          invites: { orderBy: { createdAt: 'desc' }, take: 20 },
          _count: { select: { subscriptions: true } },
        },
      })
    : await db.corporate.findUnique({
        where: { adminUserId: session.id },
        include: {
          members: { include: { user: { select: { id: true, name: true, phone: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 100 },
          invites: { orderBy: { createdAt: 'desc' }, take: 20 },
          _count: { select: { subscriptions: true } },
        },
      });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride · Corporate</Link>
          <div className="flex gap-2 items-center text-sm">
            <Button asChild variant="ghost"><Link href="/corporate/members">Members</Link></Button>
            <Button asChild variant="ghost"><Link href="/corporate/settings">Settings</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-6">Corporate: {session.phone}</h1>
        {!corp ? (
          <Card><CardContent className="py-6 text-center">
            <p className="text-muted-foreground mb-3">You don't have a corporate registered yet.</p>
            <Button asChild><Link href="/corporate/onboard">Onboard your company</Link></Button>
          </CardContent></Card>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardContent className="py-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><div className="text-xs text-muted-foreground">Code</div><div className="font-mono text-base">{corp.code}</div></div>
                <div><div className="text-xs text-muted-foreground">Subsidy</div><div>{corp.subsidyPercent}%</div></div>
                <div><div className="text-xs text-muted-foreground">Monthly allowance</div><div>{corp.monthlySeatAllowance}</div></div>
                <div><div className="text-xs text-muted-foreground">Members</div><div>{corp.members.length}</div></div>
              </CardContent>
            </Card>

            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">Invite codes</h2>
                <CreateInviteButton />
              </div>
              {corp.invites.length === 0 ? (
                <Card><CardContent className="py-4 text-center text-muted-foreground text-sm">No invites yet.</CardContent></Card>
              ) : (
                <Card>
                  <CardContent className="py-3 divide-y">
                    {corp.invites.map(inv => (
                      <div key={inv.id} className="py-2 flex justify-between items-center">
                        <div>
                          <div className="font-mono text-sm">{inv.code}</div>
                          <div className="text-xs text-muted-foreground">
                            {inv.note ? `${inv.note} · ` : ''}{inv.usesCount}/{inv.maxUses} uses
                            {inv.expiresAt && ` · expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                          </div>
                        </div>
                        <Badge variant={inv.isActive ? 'default' : 'secondary'}>{inv.isActive ? 'active' : 'disabled'}</Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Share an invite code with your employees. They sign up at <Link href="/corporate/signup" className="hover:underline">/corporate/signup</Link>.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">Members</h2>
              {corp.members.length === 0 ? (
                <Card><CardContent className="py-4 text-center text-muted-foreground text-sm">No members yet.</CardContent></Card>
              ) : (
                <Card>
                  <CardContent className="py-3 divide-y">
                    {corp.members.map(m => (
                      <div key={m.id} className="py-2 flex justify-between items-center">
                        <div>
                          <div className="font-medium">{m.user.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {m.user.phone} · employee ID: {m.employeeId} · joined {new Date(m.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{m.approvalStatus}</Badge>
                          {m.approvalStatus === 'pending' && <MemberActions id={m.id} />}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
