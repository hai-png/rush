import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';

export default async function AdminDashboardPage() {
  await requireRole('platform_admin');

  const [users, payments, subs, tickets, auditLogs, recentPayments] = await Promise.all([
    db.user.count(),
    db.payment.count(),
    db.subscription.count(),
    db.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
    db.auditLog.count(),
    db.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { user: { select: { name: true, phone: true } }, subscription: { include: { plan: true } } },
    }),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride · Admin</Link>
          <div className="flex gap-2 items-center text-sm">
            <Button asChild variant="ghost"><Link href="/admin/users">Users</Link></Button>
            <Button asChild variant="ghost"><Link href="/admin/payments">Payments</Link></Button>
            <Button asChild variant="ghost"><Link href="/admin/plans">Plans</Link></Button>
            <Button asChild variant="ghost"><Link href="/admin/contractors">Contractors</Link></Button>
            <Button asChild variant="ghost"><Link href="/admin/shuttles">Shuttles</Link></Button>
            <Button asChild variant="ghost"><Link href="/admin/routes">Routes</Link></Button>
            <Button asChild variant="ghost"><Link href="/admin/assignments">Assignments</Link></Button>
            <Button asChild variant="ghost"><Link href="/admin/subscriptions">Subs</Link></Button>
            <Button asChild variant="ghost"><Link href="/admin/corporates">Corporates</Link></Button>
            <Button asChild variant="ghost"><Link href="/admin/faqs">FAQs</Link></Button>
            <Button asChild variant="ghost"><Link href="/admin/settings">Settings</Link></Button>
            <Button asChild variant="ghost"><Link href="/admin/tickets">Tickets</Link></Button>
            <Button asChild variant="ghost"><Link href="/admin/audit-logs">Audit</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-2xl font-bold mb-6">Admin overview</h1>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Stat label="Users" value={users} />
          <Stat label="Payments" value={payments} />
          <Stat label="Subscriptions" value={subs} />
          <Stat label="Open tickets" value={tickets} />
          <Stat label="Audit log rows" value={auditLogs} />
        </div>
        <section>
          <h2 className="text-lg font-semibold mb-3">Recent payments</h2>
          <Card>
            <CardContent className="py-3 divide-y">
              {recentPayments.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">No payments yet.</div>
              ) : recentPayments.map(p => (
                <div key={p.id} className="py-2 text-sm flex justify-between items-center">
                  <div>
                    <div className="font-mono text-xs">{p.reference}</div>
                    <div className="text-xs text-muted-foreground">{p.user?.name} · {p.user?.phone}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>{(p.amountCents / 100).toFixed(0)} ETB</span>
                    <Badge variant="outline">{p.status}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground uppercase">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
