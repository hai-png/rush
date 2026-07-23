import Link from 'next/link';
import { requireSession } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadDataExportButton } from './download-data-export-button';

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
  // FE-06: pre-serialize so the client download button can embed the JSON in
  // a Blob without re-fetching or re-serializing server-side data.
  const json = JSON.stringify(exportData, null, 2);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride</Link>
          <Button asChild variant="ghost"><Link href="/account">Back to account</Link></Button>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Your data export</h1>
          {/* FE-06: download button — generates a JSON file client-side so the
              user can save a copy for their records (GDPR data portability). */}
          <DownloadDataExportButton json={json} filename={`addis-ride-export-${session.id}.json`} />
        </div>
        <pre className="text-xs bg-muted p-4 rounded-md overflow-x-auto max-h-[60vh]">
{json}
        </pre>
      </main>
    </div>
  );
}
