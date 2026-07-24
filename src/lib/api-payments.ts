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

  // CRITICAL FIX (C-5): Acquire the lock BEFORE calling Telebirr.
  // Previously, the check-then-create-then-record sequence was a TOCTOU race
  // — two concurrent checkouts for the same payment both passed the findUnique
  // check, both called provider.createCheckout() with the same merchOrderId,
  // and both succeeded. The user paid both, but only the first webhook settled
  // (the second payment was captured at Telebirr but unrecorded locally).
  //
  // Now we INSERT the lock row first (relying on PK uniqueness). If a concurrent
  // checkout already holds the lock, the insert throws P2002 and we return 409.
  // Only after the insert commits do we call provider.createCheckout(). If
  // createCheckout throws, the lock remains for the idempotency window — an
  // acceptable trade-off (user can retry after 5 min).
  const lockKey = `checkout-lock:${paymentId}`;
  const now = Date.now();
  try {
    await db.setting.create({
      data: { key: lockKey, value: String(now) },
    });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      // Lock already held — check if it's stale (> IDEMPOTENCY_WINDOW_MS old).
      const existing = await db.setting.findUnique({ where: { key: lockKey } });
      if (existing) {
        const lastCheckoutAt = parseInt(existing.value, 10);
        if (Number.isFinite(lastCheckoutAt) && now - lastCheckoutAt < IDEMPOTENCY_WINDOW_MS) {
          throw new ConflictError('A checkout was recently created for this payment. Use the existing checkout URL or wait a few minutes before retrying.');
        }
        // Stale lock — overwrite with our timestamp and proceed.
        await db.setting.update({ where: { key: lockKey }, data: { value: String(now) } });
      } else {
        throw new ConflictError('A checkout is in progress for this payment.');
      }
    } else {
      throw e;
    }
  }

  const { getPaymentProvider } = await import('@/lib/payments');
  const { loadEnv } = await import('@/lib/env');
  const provider = getPaymentProvider(payment.method as 'telebirr' | 'cbe');
  const env = loadEnv();
  let checkout;
  try {
    checkout = await provider.createCheckout({
      merchOrderId: payment.reference,
      amount: Money.fromCents(payment.amountCents),
      description: payment.subscription?.plan.name ?? 'Subscription',
      notifyUrl: env.TELEBIRR_NOTIFY_URL || `${env.APP_BASE_URL}/api/v1/webhooks/telebirr/notify`,
      redirectUrl: env.TELEBIRR_REDIRECT_URL || `${env.APP_BASE_URL}/checkout/complete`,
    });
  } catch (err) {
    // createCheckout failed — release the lock so the user can retry immediately.
    // (The Telebirr order was never created, so there's nothing to dedup against.)
    await db.setting.delete({ where: { key: lockKey } }).catch(() => {});
    throw err;
  }

  // Lock is already held (we acquired it before calling Telebirr). Update the
  // timestamp to reflect the successful checkout.
  await db.setting.update({
    where: { key: lockKey },
    data: { value: String(Date.now()) },
  });

  return { data: { paymentReference: payment.reference, checkout } };
}
