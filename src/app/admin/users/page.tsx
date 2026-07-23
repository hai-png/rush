import Link from 'next/link';
import type { Metadata } from 'next';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardHeader } from '@/components/dashboard-header';
import { Pagination } from '@/components/pagination';
import { UserActions } from './user-actions';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Users · Admin' };

const PAGE_SIZE = 20;

// FE-043: paginated user list (was take:200, no search, no pagination UI).
// Reads `page`, `q` (free-text search across name/phone/email), and `role`
// (filter) from searchParams and feeds them to findMany + count. The shared
// <Pagination> component renders the prev/next controls and preserves the
// search/role filters when moving between pages.
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string; role?: string }> }) {
  const session = await requireRole('platform_admin');
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const q = (sp.q ?? '').trim();
  const role = (sp.role ?? '').trim();

  const where = {
    AND: [
      q ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { phone: { contains: q } },
          { email: { contains: q, mode: 'insensitive' as const } },
        ],
      } : {},
      role ? { role } : {},
    ],
  };

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      select: { id: true, phone: true, email: true, name: true, role: true, isActive: true, deletedAt: true, createdAt: true, phoneVerified: true, twoFactorEnabled: true },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.user.count({ where }),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <DashboardHeader title="Admin · Users" backHref="/dashboard/admin" />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        {/* Filter form — GET so it's shareable and bookmarkable. */}
        <form className="mb-4 flex flex-wrap gap-2 items-center">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name / phone / email"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[220px]"
          />
          <select
            name="role"
            defaultValue={role}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All roles</option>
            <option value="rider">rider</option>
            <option value="contractor">contractor</option>
            <option value="corporate_admin">corporate_admin</option>
            <option value="platform_admin">platform_admin</option>
          </select>
          <button type="submit" className="h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground">Filter</button>
          {(q || role) && (
            <Link href="/admin/users" className="h-9 flex items-center px-2 text-sm text-muted-foreground hover:text-foreground">Clear</Link>
          )}
        </form>

        <h1 className="text-2xl font-bold mb-4">Users ({total})</h1>
        <Card>
          <CardContent className="py-3 divide-y">
            {users.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">No users match your filters.</div>
            ) : users.map(u => (
              <div key={u.id} className="py-2 text-sm flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{u.name} <span className="text-xs text-muted-foreground">· {u.phone}</span></div>
                  <div className="text-xs text-muted-foreground">{u.email ?? '—'} · created {formatDate(u.createdAt)}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline">{u.role}</Badge>
                  {u.twoFactorEnabled && <Badge>2FA</Badge>}
                  {!u.isActive && <Badge variant="destructive">inactive</Badge>}
                  <UserActions userId={u.id} currentRole={u.role} isActive={u.isActive} currentUserId={session.id} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Pagination
          page={page}
          total={total}
          pageSize={PAGE_SIZE}
          basePath="/admin/users"
          query={{ q, role }}
        />
      </main>
    </div>
  );
}
