import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardHeader } from '@/components/dashboard-header';
import { RefundButton } from './refund-button';
import { formatETB, formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Payment · Admin' };

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
      <DashboardHeader title="Admin · Payment" backHref="/admin/payments" backLabel="All payments" />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-2 font-mono">{payment.reference}</h1>
        <div className="text-sm text-muted-foreground mb-6">Payment ID: {payment.id}</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardContent className="py-4 text-sm space-y-1">
              <div className="text-xs text-muted-foreground uppercase">Amount</div>
              <div className="text-2xl font-bold">{formatETB(payment.amountCents)}</div>
              {payment.refundAmountCents > 0 && (
                <div className="text-xs text-muted-foreground">Refunded: {formatETB(payment.refundAmountCents)}</div>
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
            <div>Created: {formatDateTime(payment.createdAt)}</div>
            <div>Updated: {formatDateTime(payment.updatedAt)}</div>
            {payment.refundedAt && <div>Refunded at: {formatDateTime(payment.refundedAt)}</div>}
          </CardContent>
        </Card>

        {refundable && maxRefund > 0 && (
          <Card className="mb-6">
            <CardContent className="py-4">
              <div className="text-sm font-semibold mb-2">Issue refund</div>
              <p className="text-xs text-muted-foreground mb-3">
                Max refundable: <strong>{formatETB(maxRefund)}</strong>
                {alreadyRefunded > 0 && ` (already refunded ${formatETB(alreadyRefunded)})`}
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
                      Amount: {formatETB(r.amountCents)} · attempts: {r.attempts}/{r.maxAttempts}
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
