import { db } from '@/lib/db';
import { z } from 'zod';
import { Money } from '@/lib/money';
import { NotFoundError, BadRequestError, ConflictError } from '@/lib/errors';

export async function GET_one({ session, params }: any) {
  const payment = await db.payment.findUnique({
    where: { id: params.id },
    include: { subscription: { include: { plan: true } }, refundRetries: true },
  });
  if (!payment) throw new NotFoundError('Payment not found');
  if (payment.userId !== session.id && session.role !== 'platform_admin') {
    throw new NotFoundError('Payment not found');
  }
  return { data: payment };
}

export async function GET_list({ session }: any) {
  const payments = await db.payment.findMany({
    where: session.role === 'platform_admin' ? {} : { userId: session.id },
    include: { subscription: { include: { plan: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return { data: payments };
}

// Idempotency window for /payments/checkout. After a successful createCheckout
// call, we write a Setting row keyed by the payment ID with the current
// timestamp. A second checkout call within IDEMPOTENCY_WINDOW_MS is rejected
// with 409 — the client should re-use the original checkout URL (returned in
// the first response) instead of creating a second Telebirr order with the
// same merchOrderId. Without this, two checkouts for the same pending Payment
// would create two valid Telebirr orders; if the user paid both, only the
// first webhook settles (the second payment is captured at Telebirr but never
// recorded).
const IDEMPOTENCY_WINDOW_MS = 5 * 60_000; // 5 minutes

export async function POST_checkout({ session, body }: any) {
  const { paymentId } = z.object({ paymentId: z.string() }).parse(body);
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { subscription: { include: { plan: true } } } });
  if (!payment) throw new NotFoundError('Payment not found');
  if (payment.userId !== session.id) throw new NotFoundError('Payment not found');
  if (payment.status !== 'pending') throw new BadRequestError('Payment is not pending');

  // Idempotency check — reject if a checkout was created for this payment
  // within the last IDEMPOTENCY_WINDOW_MS.
  const lockKey = `checkout-lock:${paymentId}`;
  const existing = await db.setting.findUnique({ where: { key: lockKey } });
  if (existing) {
    const lastCheckoutAt = parseInt(existing.value, 10);
    if (Number.isFinite(lastCheckoutAt) && Date.now() - lastCheckoutAt < IDEMPOTENCY_WINDOW_MS) {
      throw new ConflictError('A checkout was recently created for this payment. Use the existing checkout URL or wait a few minutes before retrying.');
    }
  }

  const { getPaymentProvider } = await import('@/lib/payments');
  const { loadEnv } = await import('@/lib/env');
  const provider = getPaymentProvider(payment.method as 'telebirr' | 'cbe');
  const env = loadEnv();
  const checkout = await provider.createCheckout({
    merchOrderId: payment.reference,
    amount: Money.fromCents(payment.amountCents),
    description: payment.subscription?.plan.name ?? 'Subscription',
    notifyUrl: env.TELEBIRR_NOTIFY_URL || `${env.APP_BASE_URL}/api/v1/webhooks/telebirr/notify`,
    redirectUrl: env.TELEBIRR_REDIRECT_URL || `${env.APP_BASE_URL}/checkout/complete`,
  });

  // Record the checkout timestamp so concurrent/repeated calls are rejected
  // within the idempotency window.
  await db.setting.upsert({
    where: { key: lockKey },
    update: { value: String(Date.now()) },
    create: { key: lockKey, value: String(Date.now()) },
  });

  return { data: { paymentReference: payment.reference, checkout } };
}
