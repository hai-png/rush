import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { UserActions } from './user-actions';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  await requireRole('platform_admin');
  const users = await db.user.findMany({
    select: { id: true, phone: true, email: true, name: true, role: true, isActive: true, deletedAt: true, createdAt: true, phoneVerified: true, twoFactorEnabled: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard/admin" className="text-xl font-bold">Admin · Users</Link>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-2xl font-bold mb-4">Users ({users.length})</h1>
        <Card>
          <CardContent className="py-3 divide-y">
            {users.map(u => (
              <div key={u.id} className="py-2 text-sm flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{u.name} <span className="text-xs text-muted-foreground">· {u.phone}</span></div>
                  <div className="text-xs text-muted-foreground">{u.email ?? '—'} · created {new Date(u.createdAt).toLocaleDateString()}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline">{u.role}</Badge>
                  {u.twoFactorEnabled && <Badge>2FA</Badge>}
                  {!u.isActive && <Badge variant="destructive">inactive</Badge>}
                  <UserActions userId={u.id} currentRole={u.role} isActive={u.isActive} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
