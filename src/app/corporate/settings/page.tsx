import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SignOutButton } from '@/components/sign-out-button';
import { CorporateSettingsForm } from './settings-form';

export default async function CorporateSettingsPage() {
  const session = await requireRole('corporate_admin', 'platform_admin');
  const corp = await db.corporate.findUnique({ where: { adminUserId: session.id } });
  if (!corp) return (
    <div className="min-h-screen flex items-center justify-center">
      <Card><CardContent className="py-6 text-center">No corporate found. <Link href="/corporate/onboard" className="text-primary">Onboard →</Link></CardContent></Card>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Corporate Settings</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/corporate">Dashboard</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-xl">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        <Card><CardContent className="py-4"><CorporateSettingsForm corp={corp} /></CardContent></Card>
      </main>
    </div>
  );
}
