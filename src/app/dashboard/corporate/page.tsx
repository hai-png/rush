// Corporate dashboard — placeholder (corporate signup isn't in the MVP slice).
import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SignOutButton } from '@/components/sign-out-button';

export default async function CorporateDashboardPage() {
  const session = await requireRole('corporate_admin', 'platform_admin');
  const corp = await db.corporate.findUnique({
    where: { adminUserId: session.id },
    include: { members: { take: 50, orderBy: { createdAt: 'desc' } } },
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride · Corporate</Link>
          <SignOutButton />
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
          <div className="space-y-4">
            <Card>
              <CardContent className="py-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><div className="text-xs text-muted-foreground">Code</div><div className="font-mono">{corp.code}</div></div>
                <div><div className="text-xs text-muted-foreground">Subsidy</div><div>{corp.subsidyPercent}%</div></div>
                <div><div className="text-xs text-muted-foreground">Monthly allowance</div><div>{corp.monthlySeatAllowance}</div></div>
                <div><div className="text-xs text-muted-foreground">Members</div><div>{corp.members.length}</div></div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
