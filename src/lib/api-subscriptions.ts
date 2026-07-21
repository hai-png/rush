// Subscriptions — list, create, fetch, cancel.
// and returns the checkout URL (telebirr) or instructions (cbe).
import { db } from '@/lib/db';
import { z } from 'zod';
import { Money } from '@/lib/money';
import { BadRequestError, NotFoundError, ConflictError } from '@/lib/errors';
import { getPaymentProvider } from '@/lib/payments';
import { loadEnv } from '@/lib/env';
import { audit } from '@/lib/audit';
import { createId } from '@/lib/id';

export async function GET_list({ session }: any) {
  const subs = await db.subscription.findMany({
    where: { userId: session.id },
    include: { plan: true, payments: { orderBy: { createdAt: 'desc' }, take: 5 } },
    orderBy: { createdAt: 'desc' },
  });
  return { data: subs };
}

const CreateInput = z.object({
  planId: z.string().min(1),
  paymentMethod: z.enum(['telebirr', 'cbe']),
  corporateCode: z.string().optional(),
});

export async function POST_create({ session, body, ipAddress, userAgent }: any) {
  const input = CreateInput.parse(body);

  const plan = await db.subscriptionPlan.findUnique({ where: { id: input.planId } });
  if (!plan || !plan.isActive) throw new NotFoundError('Plan not found');

  // Trial-only-once check
  if (plan.isTrial) {
    const priorTrial = await db.subscription.findFirst({
      where: { userId: session.id, plan: { isTrial: true } },
    });
    if (priorTrial) throw new BadRequestError('You have already used the trial plan');
  }

  // Resolve corporate membership if code provided.
  let corporateId: string | undefined;
  if (input.corporateCode) {
    const corp = await db.corporate.findUnique({ where: { code: input.corporateCode } });
    if (!corp || !corp.isActive || corp.deletedAt) throw new BadRequestError('Invalid corporate code');
    const member = await db.corporateMember.findUnique({
      where: { corporateId_userId: { corporateId: corp.id, userId: session.id } },
    });
    if (!member || member.approvalStatus !== 'approved' || !member.isActive || member.deletedAt) {
      throw new BadRequestError('You are not an approved member of this corporate');
    }
    corporateId = corp.id;
  }

  const now = new Date();
  const endDate = new Date(now.getTime() + plan.durationDays * 24 * 3600_000);

  const sub = await db.subscription.create({
    data: {
      userId: session.id,
      planId: plan.id,
      corporateId,
      status: 'pending_payment',
      startDate: now,
      endDate,
    },
    include: { plan: true },
  });

  // Apply corporate subsidy if applicable.
  let riderAmountCents = plan.priceCents;
  let corporateSubsidyCents = 0;
  if (corporateId) {
    const corp = await db.corporate.findUnique({ where: { id: corporateId } });
    if (corp) {
      corporateSubsidyCents = Math.round(plan.priceCents * corp.subsidyPercent / 100);
      riderAmountCents = plan.priceCents - corporateSubsidyCents;
    }
  }

  // Create the pending payment + checkout (rider pays their share).
  const reference = `PO${createId()}`;
  const provider = getPaymentProvider(input.paymentMethod);
  const env = loadEnv();
  const checkout = await provider.createCheckout({
    merchOrderId: reference,
    amount: Money.fromCents(riderAmountCents),
    description: corporateSubsidyCents > 0
      ? `${plan.name} subscription (${100 - Math.round(corporateSubsidyCents / plan.priceCents * 100)}% after corporate subsidy)`
      : `${plan.name} subscription`,
    notifyUrl: env.TELEBIRR_NOTIFY_URL || `${env.APP_BASE_URL}/api/v1/webhooks/telebirr/notify`,
    redirectUrl: env.TELEBIRR_REDIRECT_URL || `${env.APP_BASE_URL}/checkout/complete`,
  });

  await db.payment.create({
    data: {
      reference,
      userId: session.id,
      subscriptionId: sub.id,
      method: input.paymentMethod,
      amountCents: riderAmountCents,
      status: 'pending',
    },
  });

  await audit({
    actorId: session.id,
    action: 'subscription.created',
    entityType: 'subscription',
    entityId: sub.id,
    after: { planId: plan.id, paymentRef: reference, method: input.paymentMethod },
    ipAddress, userAgent,
  });

  return {
    status: 201,
    data: {
      subscription: sub,
      paymentReference: reference,
      checkout,
    },
  };
}

export async function GET_one({ session, params }: any) {
  const sub = await db.subscription.findUnique({
    where: { id: params.id },
    include: { plan: true, payments: true, rides: { include: { trip: { include: { route: true } } } } },
  });
  if (!sub) throw new NotFoundError('Subscription not found');
  if (sub.userId !== session.id && session.role !== 'platform_admin') {
    throw new NotFoundError('Subscription not found');
  }
  return { data: sub };
}

export async function POST_cancel({ session, params, ipAddress, userAgent }: any) {
  const sub = await db.subscription.findUnique({ where: { id: params.id } });
  if (!sub) throw new NotFoundError('Subscription not found');
  if (sub.userId !== session.id && session.role !== 'platform_admin') {
    throw new NotFoundError('Subscription not found');
  }
  if (sub.status === 'cancelled') throw new ConflictError('Already cancelled');
  if (sub.status === 'expired') throw new ConflictError('Already expired');

  await db.subscription.update({
    where: { id: sub.id },
    data: { status: 'cancelled', cancelledAt: new Date() },
  });
  await audit({
    actorId: session.id,
    action: 'subscription.cancelled',
    entityType: 'subscription',
    entityId: sub.id,
    ipAddress, userAgent,
  });
  return { data: { id: sub.id, status: 'cancelled' } };
}

// Creates a new pending payment + checkout URL for the same plan.
export async function POST_renew({ session, params, body }: any) {
  const sub = await db.subscription.findUnique({
    where: { id: params.id },
    include: { plan: true },
  });
  if (!sub) throw new NotFoundError('Subscription not found');
  if (sub.userId !== session.id && session.role !== 'platform_admin') {
    throw new NotFoundError('Subscription not found');
  }

  const { paymentMethod } = z.object({ paymentMethod: z.enum(['telebirr', 'cbe']) }).parse(body);
  const reference = `PO${createId()}`;
  const provider = getPaymentProvider(paymentMethod);
  const env = loadEnv();
  const checkout = await provider.createCheckout({
    merchOrderId: reference,
    amount: Money.fromCents(sub.plan.priceCents),
    description: `${sub.plan.name} renewal`,
    notifyUrl: env.TELEBIRR_NOTIFY_URL || `${env.APP_BASE_URL}/api/v1/webhooks/telebirr/notify`,
    redirectUrl: env.TELEBIRR_REDIRECT_URL || `${env.APP_BASE_URL}/checkout/complete`,
  });

  // Create a new subscription period.
  const now = new Date();
  const endDate = new Date(now.getTime() + sub.plan.durationDays * 24 * 3600_000);
  const newSub = await db.subscription.create({
    data: {
      userId: sub.userId,
      planId: sub.planId,
      corporateId: sub.corporateId,
      status: 'pending_payment',
      startDate: now,
      endDate,
    },
    include: { plan: true },
  });

  await db.payment.create({
    data: {
      reference,
      userId: sub.userId,
      subscriptionId: newSub.id,
      method: paymentMethod,
      amountCents: sub.plan.priceCents,
      status: 'pending',
    },
  });

  return {
    status: 201,
    data: {
      subscription: newSub,
      paymentReference: reference,
      checkout,
    },
  };
}

export async function DELETE_subscription({ session, params, ipAddress, userAgent }: any) {
  const sub = await db.subscription.findUnique({ where: { id: params.id } });
  if (!sub) throw new NotFoundError('Subscription not found');
  if (sub.userId !== session.id && session.role !== 'platform_admin') {
    throw new NotFoundError('Subscription not found');
  }
  if (sub.status === 'cancelled') throw new ConflictError('Already cancelled');
  if (sub.status === 'expired') throw new ConflictError('Already expired');
  await db.subscription.update({ where: { id: sub.id }, data: { status: 'cancelled', cancelledAt: new Date() } });
  await audit({ actorId: session.id, action: 'subscription.cancelled', entityType: 'subscription', entityId: sub.id, ipAddress, userAgent });
  return { data: { id: sub.id, status: 'cancelled' } };
}
