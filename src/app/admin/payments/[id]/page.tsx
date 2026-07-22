import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { RefundButton } from './refund-button';

export const dynamic = 'force-dynamic';

export default async function AdminPaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('platform_admin');
  const { id } = await params;
  const payment = await db.payment.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, phone: true, email: true } },
      subscription: { include: { plan: true } },
      seatClaim: { include: { seatRelease: { include: { trip: { include: { route: true } } } } } },
      refundRetries: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!payment) notFound();

  const refundable = payment.status === 'completed';
  const alreadyRefunded = payment.refundAmountCents;
  const maxRefund = payment.amountCents - alreadyRefunded;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard/admin" className="text-xl font-bold">Admin · Payment</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/admin/payments">All payments</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-2 font-mono">{payment.reference}</h1>
        <div className="text-sm text-muted-foreground mb-6">Payment ID: {payment.id}</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardContent className="py-4 text-sm space-y-1">
              <div className="text-xs text-muted-foreground uppercase">Amount</div>
              <div className="text-2xl font-bold">{(payment.amountCents / 100).toFixed(2)} ETB</div>
              {payment.refundAmountCents > 0 && (
                <div className="text-xs text-muted-foreground">Refunded: {(payment.refundAmountCents / 100).toFixed(2)} ETB</div>
              )}
              <div className="pt-2"><Badge variant="outline">{payment.status}</Badge> <Badge>{payment.method}</Badge></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-sm space-y-1">
              <div className="text-xs text-muted-foreground uppercase">Customer</div>
              <div className="font-medium">{payment.user.name}</div>
              <div className="text-xs text-muted-foreground">{payment.user.phone}</div>
              {payment.user.email && <div className="text-xs text-muted-foreground">{payment.user.email}</div>}
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardContent className="py-4 text-sm space-y-2">
            <div className="text-xs text-muted-foreground uppercase">Linked entities</div>
            {payment.subscription ? (
              <div>
                Subscription: <Link href={`/admin/payments?sub=${payment.subscription.id}`} className="text-primary hover:underline">{payment.subscription.plan.name}</Link>
                <span className="ml-2"><Badge variant="outline">{payment.subscription.status}</Badge></span>
              </div>
            ) : null}
            {payment.seatClaim ? (
              <div>
                Seat claim for: {payment.seatClaim.seatRelease.trip.route.origin} → {payment.seatClaim.seatRelease.trip.route.destination}
              </div>
            ) : null}
            <div>Created: {new Date(payment.createdAt).toLocaleString()}</div>
            <div>Updated: {new Date(payment.updatedAt).toLocaleString()}</div>
            {payment.refundedAt && <div>Refunded at: {new Date(payment.refundedAt).toLocaleString()}</div>}
          </CardContent>
        </Card>

        {refundable && maxRefund > 0 && (
          <Card className="mb-6">
            <CardContent className="py-4">
              <div className="text-sm font-semibold mb-2">Issue refund</div>
              <p className="text-xs text-muted-foreground mb-3">
                Max refundable: <strong>{(maxRefund / 100).toFixed(2)} ETB</strong>
                {alreadyRefunded > 0 && ` (already refunded ${(alreadyRefunded / 100).toFixed(2)} ETB)`}
              </p>
              <RefundButton paymentId={payment.id} maxAmount={maxRefund / 100} />
            </CardContent>
          </Card>
        )}

        {payment.refundRetries.length > 0 && (
          <Card>
            <CardContent className="py-4">
              <div className="text-sm font-semibold mb-2">Refund history</div>
              <div className="divide-y text-xs">
                {payment.refundRetries.map(r => (
                  <div key={r.id} className="py-2">
                    <div className="flex justify-between">
                      <span className="font-mono">{r.refundRequestNo}</span>
                      <Badge variant="outline">{r.status}</Badge>
                    </div>
                    <div className="text-muted-foreground">
                      Amount: {(r.amountCents / 100).toFixed(2)} ETB · attempts: {r.attempts}/{r.maxAttempts}
                    </div>
                    <div className="text-muted-foreground">Reason: {r.reason}</div>
                    {r.lastError && <div className="text-red-600">Error: {r.lastError}</div>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
