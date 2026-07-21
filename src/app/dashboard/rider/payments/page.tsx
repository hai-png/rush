import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';

export default async function RiderPaymentsPage() {
  const session = await requireRole('rider', 'platform_admin');
  const payments = await db.payment.findMany({
    where: { userId: session.id },
    include: { subscription: { include: { plan: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Payment History</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/rider">Dashboard</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-6">Payments</h1>
        {payments.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-muted-foreground">No payments yet.</CardContent></Card>
        ) : (
          <Card>
            <CardContent className="py-3 divide-y">
              {payments.map(p => (
                <div key={p.id} className="py-3 flex justify-between items-center">
                  <div>
                    <div className="font-mono text-sm">{p.reference}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(p.createdAt).toLocaleString()} · {p.method} · {p.subscription?.plan?.name ?? '—'}
                    </div>
                    {p.refundAmountCents > 0 && (
                      <div className="text-xs text-orange-600">Refunded: {(p.refundAmountCents / 100).toFixed(0)} ETB</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{(p.amountCents / 100).toFixed(0)} ETB</span>
                    <Badge variant="outline">{p.status}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
