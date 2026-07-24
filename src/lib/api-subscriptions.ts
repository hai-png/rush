import { db } from '@/lib/db';
import { z } from 'zod';
import { Money } from '@/lib/money';
import { BadRequestError, NotFoundError, ConflictError } from '@/lib/errors';
import { getPaymentProvider } from '@/lib/payments';
import { loadEnv } from '@/lib/env';
import { audit } from '@/lib/audit';
import { createId } from '@/lib/id';
import { enqueueNotification } from '@/lib/outbox';
import { logger } from '@/lib/logger';

// Single source of truth for corporate subsidy calculation.
export function computeCorporateSubsidy(priceCents: number, subsidyPercent: number): { riderAmountCents: number; corporateSubsidyCents: number } {
  const corporateSubsidyCents = Math.round(priceCents * Math.max(0, Math.min(100, subsidyPercent)) / 100);
  return {
    corporateSubsidyCents,
    riderAmountCents: priceCents - corporateSubsidyCents,
  };
}

export async function GET_list({ session, query }: any) {
  const { parsePagination, paginatedResponse } = await import('@/lib/pagination');
  const page = parsePagination(query);
  const where: any = { userId: session.id };
  if (query?.status) where.status = query.status;
  const [subs, total] = await Promise.all([
    db.subscription.findMany({
      where,
      include: { plan: true, payments: { orderBy: { createdAt: 'desc' }, take: 5 } },
      orderBy: { createdAt: 'desc' },
      ...page.findManyArgs,
    }),
    db.subscription.count({ where }),
  ]);
  return paginatedResponse(subs, total, page);
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

  // Trial-only-once check (race: re-validated inside the tx below).
  if (plan.isTrial) {
    const priorTrial = await db.subscription.findFirst({
      where: { userId: session.id, plan: { isTrial: true } },
    });
    if (priorTrial) throw new BadRequestError('You have already used the trial plan');
  }

  let corporateId: string | undefined;
  let corporateSubsidyCents = 0;
  let riderAmountCents = plan.priceCents;
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
    const subsidy = computeCorporateSubsidy(plan.priceCents, corp.subsidyPercent);
    corporateSubsidyCents = subsidy.corporateSubsidyCents;
    riderAmountCents = subsidy.riderAmountCents;
  }

  // reject zero-amount checkouts (100% subsidy) — Telebirr rejects them
  // and we'd end up with a stuck pending_payment subscription.
  if (riderAmountCents <= 0) {
    throw new BadRequestError('Corporate subsidy cannot cover 100% of the plan price — please contact support');
  }

  const now = new Date();
  // Use calendar-day arithmetic instead of ms-since-epoch. The previous
  // `new Date(now.getTime() + plan.durationDays * 24 * 3600_000)` drifts
  // across DST transitions and accumulates floating-point error for very
  // large durationDays values.
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + plan.durationDays);

  const reference = `PO${createId()}`;
  const provider = getPaymentProvider(input.paymentMethod);
  const env = loadEnv();

  // Create subscription + payment atomically. Re-check trial inside the tx
  // so two parallel POST /subscriptions calls for a trial plan can't both
  // succeed.
  const sub = await db.$transaction(async (tx) => {
    if (plan.isTrial) {
      const priorTrialInTx = await tx.subscription.findFirst({
        where: { userId: session.id, plan: { isTrial: true } },
        select: { id: true },
      });
      if (priorTrialInTx) throw new ConflictError('You have already used the trial plan');
    }
    const created = await tx.subscription.create({
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
    await tx.payment.create({
      data: {
        reference,
        userId: session.id,
        subscriptionId: created.id,
        method: input.paymentMethod,
        amountCents: riderAmountCents,
        // Record the corporate subsidy portion for the monthly billing job.
        subsidyCents: corporateSubsidyCents,
        status: 'pending',
      },
    });
    return created;
  }, { timeout: 15000, maxWait: 20000 });

  // Create the Telebirr checkout *after* the sub+payment row commits, so if
  // createCheckout throws we still have a pending Payment that the user can
  // retry. (Creating it inside the tx would orphan the Telebirr order if the
  // tx rolls back.)
  let checkout: any;
  try {
    checkout = await provider.createCheckout({
      merchOrderId: reference,
      amount: Money.fromCents(riderAmountCents),
      description: corporateSubsidyCents > 0
        ? `${plan.name} subscription (${100 - Math.round(corporateSubsidyCents / plan.priceCents * 100)}% after corporate subsidy)`
        : `${plan.name} subscription`,
      notifyUrl: env.TELEBIRR_NOTIFY_URL || `${env.APP_BASE_URL}/api/v1/webhooks/telebirr/notify`,
      redirectUrl: env.TELEBIRR_REDIRECT_URL || `${env.APP_BASE_URL}/checkout/complete`,
    });
  } catch (err) {
    // Mark the Payment as failed so the user can retry cleanly; the subscription
    // stays pending_payment and can be re-checked-out via POST /payments/checkout.
    await db.payment.updateMany({ where: { reference }, data: { status: 'failed' } }).catch(() => {});
    throw err;
  }

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

// Cascade-cancel future rides when a subscription is cancelled. Restore
// trip.seatsBooked for each cancelled ride so other riders can book.
export async function POST_cancel({ session, params, ipAddress, userAgent }: any) {
  const sub = await db.subscription.findUnique({ where: { id: params.id } });
  if (!sub) throw new NotFoundError('Subscription not found');
  if (sub.userId !== session.id && session.role !== 'platform_admin') {
    throw new NotFoundError('Subscription not found');
  }
  if (sub.status === 'cancelled') throw new ConflictError('Already cancelled');
  if (sub.status === 'expired') throw new ConflictError('Already expired');

  const before = sub;
  const cancelledRides = await db.$transaction(async (tx) => {
    const subCas = await tx.subscription.updateMany({
      where: { id: sub.id, status: { in: ['active', 'pending_payment'] } },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    if (subCas.count === 0) throw new ConflictError('Subscription is no longer in a cancellable state');

    // Find rides that need to be cancelled (only future trips, status booked).
    const ridesToCancel = await tx.ride.findMany({
      where: {
        subscriptionId: sub.id,
        status: 'booked',
        trip: { status: 'scheduled', departureAt: { gt: new Date() } },
      },
      select: { id: true, tripId: true },
    });

    if (ridesToCancel.length > 0) {
      await tx.ride.updateMany({
        where: { id: { in: ridesToCancel.map(r => r.id) } },
        data: { status: 'cancelled' },
      });
      // Decrement seatsBooked on each affected trip (CAS guarded).
      const tripIds = [...new Set(ridesToCancel.map(r => r.tripId))];
      for (const tripId of tripIds) {
        await tx.trip.updateMany({
          where: { id: tripId, seatsBooked: { gt: 0 } },
          data: { seatsBooked: { decrement: 1 } },
        });
      }
    }
    return ridesToCancel;
  }, { timeout: 15000, maxWait: 20000 });

  // Notify the user.
  try {
    await enqueueNotification({
      userId: sub.userId,
      type: 'subscription_cancelled',
      title: 'Subscription cancelled',
      body: `Your subscription has been cancelled. ${cancelledRides.length} future ${cancelledRides.length === 1 ? 'ride was' : 'rides were'} also cancelled.`,
      link: '/dashboard/rider',
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[sub.cancel] notify failed');
  }

  await audit({
    actorId: session.id,
    action: 'subscription.cancelled',
    entityType: 'subscription',
    entityId: sub.id,
    before,
    after: { status: 'cancelled', cancelledRides: cancelledRides.length },
    ipAddress, userAgent,
  });
  return { data: { id: sub.id, status: 'cancelled', cancelledRides: cancelledRides.length } };
}

export async function POST_renew({ session, params, body, ipAddress, userAgent }: any) {
  const sub = await db.subscription.findUnique({
    where: { id: params.id },
    include: { plan: true },
  });
  if (!sub) throw new NotFoundError('Subscription not found');
  if (sub.userId !== session.id && session.role !== 'platform_admin') {
    throw new NotFoundError('Subscription not found');
  }
  if (sub.status === 'cancelled') throw new ConflictError('Cannot renew a cancelled subscription');

  // CRITICAL FIX (H-8): Block trial plan renewal entirely. Trial plans are
  // a one-shot entry point — they should not be renewable. Previously the
  // check was outside the tx and used `id: { not: sub.id }`, which allowed
  // renewing the SAME trial sub indefinitely (combined with C-1, this
  // yielded unlimited free rides). Now we reject any renewal of a trial sub.
  if (sub.plan.isTrial) {
    throw new BadRequestError('Trial plans cannot be renewed. Subscribe to a paid plan instead.');
  }

  const { paymentMethod } = z.object({ paymentMethod: z.enum(['telebirr', 'cbe']) }).parse(body);
  let riderAmountCents = sub.plan.priceCents;
  // re-validate corporate is still active + member still approved.
  if (sub.corporateId) {
    const corp = await db.corporate.findUnique({ where: { id: sub.corporateId } });
    if (!corp || !corp.isActive || corp.deletedAt) {
      throw new BadRequestError('Your corporate is no longer active — renew without the corporate code or contact support');
    }
    const member = await db.corporateMember.findUnique({
      where: { corporateId_userId: { corporateId: corp.id, userId: sub.userId } },
    });
    if (!member || member.approvalStatus !== 'approved' || !member.isActive || member.deletedAt) {
      throw new BadRequestError('Your corporate membership is no longer active');
    }
    const subsidy = computeCorporateSubsidy(sub.plan.priceCents, corp.subsidyPercent);
    riderAmountCents = subsidy.riderAmountCents;
  }

  if (riderAmountCents <= 0) {
    throw new BadRequestError('Corporate subsidy cannot cover 100% of the plan price — please contact support');
  }

  const reference = `PO${createId()}`;
  const provider = getPaymentProvider(paymentMethod);
  const env = loadEnv();

  const now = new Date();
  // extend the existing subscription's endDate if it's still active,
  // start the new one from now.
  const newStartDate = sub.status === 'active' && sub.endDate > now ? sub.endDate : now;
  // Calendar-day arithmetic (see POST_create for rationale).
  const newEndDate = new Date(newStartDate);
  newEndDate.setDate(newEndDate.getDate() + sub.plan.durationDays);

  const newSub = await db.$transaction(async (tx) => {
    // CRITICAL FIX (C-1): Do NOT extend endDate or reset ridesUsed here.
    // Previously, the renewal handler extended the subscription immediately
    // and the user got free rides even if they never paid. Now we store
    // the pending extension on the subscription row and apply it inside
    // settlePayment() when the renewal payment transitions to 'completed'.
    // If the user never pays, a scheduler job reverts the pending fields
    // (TODO: add revert-pending-renewals job to scheduler.ts hourlyJobs).
    if (sub.status === 'active' && sub.endDate > now) {
      const extended = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          // Store the pending extension — applied atomically on payment success.
          pendingEndDate: newEndDate,
          pendingRidesReset: true,
          cancelledAt: null,
        },
        include: { plan: true },
      });
      await tx.payment.create({
        data: {
          reference,
          userId: sub.userId,
          subscriptionId: extended.id,
          method: paymentMethod,
          amountCents: riderAmountCents,
          // Record the corporate subsidy portion.
          subsidyCents: sub.plan.priceCents - riderAmountCents,
          status: 'pending',
        },
      });
      return extended;
    }
    // Old sub is expired or pending — create a fresh one.
    const created = await tx.subscription.create({
      data: {
        userId: sub.userId,
        planId: sub.planId,
        corporateId: sub.corporateId,
        status: 'pending_payment',
        startDate: newStartDate,
        endDate: newEndDate,
      },
      include: { plan: true },
    });
    await tx.payment.create({
      data: {
        reference,
        userId: sub.userId,
        subscriptionId: created.id,
        method: paymentMethod,
        amountCents: riderAmountCents,
        // Record the corporate subsidy portion.
        subsidyCents: sub.plan.priceCents - riderAmountCents,
        status: 'pending',
      },
    });
    return created;
  }, { timeout: 15000, maxWait: 20000 });

  let checkout: any;
  try {
    checkout = await provider.createCheckout({
      merchOrderId: reference,
      amount: Money.fromCents(riderAmountCents),
      description: `${sub.plan.name} renewal`,
      notifyUrl: env.TELEBIRR_NOTIFY_URL || `${env.APP_BASE_URL}/api/v1/webhooks/telebirr/notify`,
      redirectUrl: env.TELEBIRR_REDIRECT_URL || `${env.APP_BASE_URL}/checkout/complete`,
    });
  } catch (err) {
    await db.payment.updateMany({ where: { reference }, data: { status: 'failed' } }).catch(() => {});
    throw err;
  }

  await audit({
    actorId: session.id,
    action: 'subscription.renewed',
    entityType: 'subscription',
    entityId: newSub.id,
    after: { previousSubId: sub.id, planId: sub.planId, paymentRef: reference, method: paymentMethod, newEndDate },
    ipAddress, userAgent,
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

export async function DELETE_subscription(ctx: any) {
  // DELETE returns 204 with no body. Delegate to POST_cancel for the actual
  // work, then strip the body from the response.
  await POST_cancel(ctx);
  return { status: 204 };
}

// POST /subscriptions/:id/change-payment-method — swap the payment method
// for the subscription's NEXT billing cycle. Cancels the existing pending
// payment (if any) and creates a new pending Payment row with the requested
// method. Does NOT touch a completed/confirmed payment for the current cycle.
const ChangePaymentMethodInput = z.object({
  method: z.enum(['telebirr', 'cbe', 'cash']),
});

export async function POST_change_payment_method({ session, params, body, ipAddress, userAgent }: any) {
  const input = ChangePaymentMethodInput.parse(body);
  const sub = await db.subscription.findUnique({
    where: { id: params.id },
    include: { plan: true },
  });
  if (!sub) throw new NotFoundError('Subscription not found');
  if (sub.userId !== session.id && session.role !== 'platform_admin') {
    throw new NotFoundError('Subscription not found');
  }

  // Look up any pending payment on this subscription.
  const pendingPayments = await db.payment.findMany({
    where: { subscriptionId: sub.id, status: 'pending' },
    select: { id: true, reference: true, amountCents: true, method: true },
  });

  // Compute the rider amount for the next cycle, mirroring POST_create.
  let riderAmountCents = sub.plan.priceCents;
  if (sub.corporateId) {
    const corp = await db.corporate.findUnique({ where: { id: sub.corporateId } });
    if (corp && corp.isActive && !corp.deletedAt) {
      riderAmountCents = computeCorporateSubsidy(sub.plan.priceCents, corp.subsidyPercent).riderAmountCents;
    }
  }
  if (riderAmountCents <= 0) {
    throw new BadRequestError('Corporate subsidy covers 100% of the plan price — no payment needed');
  }

  const reference = `PO${createId()}`;
  const before = { pendingPayments: pendingPayments.map(p => ({ id: p.id, method: p.method })) };

  await db.$transaction(async (tx) => {
    // Cancel any existing pending payment(s) so the next-cycle payment is the
    // sole active one. status:'cancelled' is a terminal state for payments.
    if (pendingPayments.length > 0) {
      await tx.payment.updateMany({
        where: { id: { in: pendingPayments.map(p => p.id) }, status: 'pending' },
        data: { status: 'cancelled' },
      });
    }
    // Create the new pending payment. 'cash' is recorded as a manual-method
    // payment; admin will reconcile manually (same flow as CBE).
    await tx.payment.create({
      data: {
        reference,
        userId: sub.userId,
        subscriptionId: sub.id,
        method: input.method,
        amountCents: riderAmountCents,
        subsidyCents: sub.plan.priceCents - riderAmountCents,
        status: 'pending',
      },
    });
  }, { timeout: 15000, maxWait: 20000 });

  await audit({
    actorId: session.id,
    action: 'subscription.payment_method_changed',
    entityType: 'subscription',
    entityId: sub.id,
    before,
    after: { method: input.method, newPaymentRef: reference },
    ipAddress, userAgent,
  });

  return {
    status: 201,
    data: {
      subscriptionId: sub.id,
      method: input.method,
      paymentReference: reference,
      cancelledPendingPayments: pendingPayments.length,
    },
  };
}
