import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { TwoFactorSetup } from './two-factor-setup';
import { ChangePasswordForm } from './change-password-form';

export const dynamic = 'force-dynamic';

export default async function RiderSecurityPage() {
  const session = await requireRole('rider', 'platform_admin');
  const user = await db.user.findUnique({ where: { id: session.id } });
  if (!user) return null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Security</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/rider">Dashboard</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">Security & Privacy</h1>
        <div className="space-y-6">
          <Card>
            <CardContent className="py-4">
              <h2 className="font-semibold mb-2">Password</h2>
              <ChangePasswordForm />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold">Two-Factor Authentication</h2>
                <Badge variant={user.twoFactorEnabled ? 'default' : 'secondary'}>
                  {user.twoFactorEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
              <TwoFactorSetup enabled={user.twoFactorEnabled} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <h2 className="font-semibold mb-2">Active Sessions</h2>
              <Button asChild variant="outline" size="sm"><Link href="/dashboard/rider/sessions">Manage sessions</Link></Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <h2 className="font-semibold mb-2 text-red-600">Danger Zone</h2>
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm"><Link href="/account/export">Export my data</Link></Button>
                <Button asChild variant="destructive" size="sm"><Link href="/account/delete">Delete account</Link></Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
