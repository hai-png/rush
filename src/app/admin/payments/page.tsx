import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';

export const dynamic = 'force-dynamic';

export default async function AdminPaymentsPage() {
  await requireRole('platform_admin');
  const payments = await db.payment.findMany({
    include: { user: { select: { name: true, phone: true } }, subscription: { include: { plan: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard/admin" className="text-xl font-bold">Admin · Payments</Link>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-2xl font-bold mb-4">Payments ({payments.length})</h1>
        <Card>
          <CardContent className="py-3 divide-y">
            {payments.map(p => (
              <Link key={p.id} href={`/admin/payments/${p.id}`} className="block py-2 text-sm hover:bg-accent/30 -mx-3 px-3 rounded">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono text-xs">{p.reference}</div>
                    <div className="text-xs text-muted-foreground">{p.user.name} · {p.user.phone} · {p.subscription?.plan?.name ?? '—'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>{(p.amountCents / 100).toFixed(2)} ETB</span>
                    {p.refundAmountCents > 0 && <span className="text-xs text-muted-foreground">refunded {(p.refundAmountCents / 100).toFixed(2)}</span>}
                    <Badge variant="outline">{p.status}</Badge>
                    <Badge>{p.method}</Badge>
                  </div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
