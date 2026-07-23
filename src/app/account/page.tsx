import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Account · Addis Ride' };

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
            <ThemeToggle />
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
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Phone verified:</span>
              {safe.phoneVerified ? (
                <Badge className="bg-green-600 hover:bg-green-600 text-white">Verified</Badge>
              ) : (
                <Badge variant="outline" className="text-amber-700 border-amber-500 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300">Not verified</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">2FA enabled:</span>
              {safe.twoFactorEnabled ? (
                <Badge className="bg-green-600 hover:bg-green-600 text-white">Enabled</Badge>
              ) : (
                <Badge variant="outline">Disabled</Badge>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">Terms:</span>{' '}
              {safe.tosVersion
                ? <span>Terms accepted (v{safe.tosVersion})</span>
                : <Badge variant="outline" className="text-amber-700 border-amber-500 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300">Not accepted</Badge>}
            </div>
            <div><span className="text-muted-foreground">Created:</span> {formatDateTime(safe.createdAt)}</div>
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
