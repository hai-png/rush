import Link from 'next/link';
import { requireSession } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function AccountExportPage() {
  const session = await requireSession();
  const [user, subs, payments, rides, tickets, notifications, sessions] = await Promise.all([
    db.user.findUnique({ where: { id: session.id }, include: { riderProfile: true, contractorProfile: true } }),
    db.subscription.findMany({ where: { userId: session.id }, include: { plan: true } }),
    db.payment.findMany({ where: { userId: session.id } }),
    db.ride.findMany({ where: { userId: session.id }, include: { trip: { include: { route: true } } } }),
    db.supportTicket.findMany({ where: { userId: session.id } }),
    db.notification.findMany({ where: { userId: session.id } }),
    db.session.findMany({ where: { userId: session.id } }),
  ]);
  if (!user) return null;
  const { passwordHash: _, twoFactorSecret: __, ...safeUser } = user;
  const exportData = {
    exportedAt: new Date().toISOString(),
    user: safeUser,
    subscriptions: subs,
    payments,
    rides,
    tickets,
    notifications,
    sessions,
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride</Link>
          <Button asChild variant="ghost"><Link href="/account">Back to account</Link></Button>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-4">Your data export</h1>
        <pre className="text-xs bg-muted p-4 rounded-md overflow-x-auto max-h-[60vh]">
{JSON.stringify(exportData, null, 2)}
        </pre>
      </main>
    </div>
  );
}
