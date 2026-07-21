// Account — overview, link to export + delete.
import Link from 'next/link';
import { requireSession } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SignOutButton } from '@/components/sign-out-button';

export default async function AccountPage() {
  const session = await requireSession();
  const user = await db.user.findUnique({
    where: { id: session.id },
    include: { riderProfile: true, contractorProfile: true },
  });
  if (!user) return null;
  const { passwordHash: _, twoFactorSecret: __, ...safe } = user;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/rider">Dashboard</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-6">Account</h1>
        <Card className="mb-4">
          <CardContent className="py-4 text-sm space-y-1">
            <div><span className="text-muted-foreground">Name:</span> {safe.name}</div>
            <div><span className="text-muted-foreground">Phone:</span> {safe.phone}</div>
            <div><span className="text-muted-foreground">Email:</span> {safe.email ?? '—'}</div>
            <div><span className="text-muted-foreground">Role:</span> {safe.role}</div>
            <div><span className="text-muted-foreground">Phone verified:</span> {safe.phoneVerified ? 'yes' : 'no'}</div>
            <div><span className="text-muted-foreground">2FA enabled:</span> {safe.twoFactorEnabled ? 'yes' : 'no'}</div>
            <div><span className="text-muted-foreground">ToS version:</span> {safe.tosVersion ?? '—'}</div>
            <div><span className="text-muted-foreground">Created:</span> {new Date(safe.createdAt).toLocaleString()}</div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="outline"><Link href="/account/export">Export my data</Link></Button>
          <Button asChild variant="outline" className="text-red-600"><Link href="/account/delete">Delete account</Link></Button>
        </div>
      </main>
    </div>
  );
}
