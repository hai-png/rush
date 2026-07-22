import { db } from '@/lib/db';
import { z } from 'zod';
import { Money } from '@/lib/money';
import { NotFoundError, BadRequestError } from '@/lib/errors';
import { scheduleRefund } from '@/lib/payment-service';
import { audit } from '@/lib/audit';

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

const RefundInput = z.object({
  amount: z.number().positive(),
  reason: z.string().min(1),
});

export async function POST_refund({ session, params, body, ipAddress, userAgent }: any) {
  const input = RefundInput.parse(body);
  await scheduleRefund(params.id, Money.fromETB(input.amount), input.reason);
  await audit({
    actorId: session.id,
    action: 'refund.requested',
    entityType: 'payment',
    entityId: params.id,
    after: { amount: input.amount, reason: input.reason },
    ipAddress, userAgent,
  });
  return { status: 202, data: { ok: true } };
}

export async function POST_checkout({ session, body }: any) {
  const { paymentId } = z.object({ paymentId: z.string() }).parse(body);
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { subscription: { include: { plan: true } } } });
  if (!payment) throw new NotFoundError('Payment not found');
  if (payment.userId !== session.id) throw new NotFoundError('Payment not found');
  if (payment.status !== 'pending') throw new BadRequestError('Payment is not pending');

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
  return { data: { paymentReference: payment.reference, checkout } };
}
