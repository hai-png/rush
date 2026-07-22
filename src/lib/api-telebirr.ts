
import { z } from 'zod';
import { db } from '@/lib/db';
import { Money } from '@/lib/money';
import { getPaymentProvider } from '@/lib/payments';
import { loadEnv } from '@/lib/env';
import { BadRequestError, NotFoundError, ForbiddenError } from '@/lib/errors';
import { createId } from '@/lib/id';
import { audit } from '@/lib/audit';

const InAppInput = z.object({
  subscriptionId: z.string().optional(),
  seatClaimId: z.string().optional(),
  description: z.string().min(1).max(200).optional(),
}).refine(v => v.subscriptionId || v.seatClaimId, 'Either subscriptionId or seatClaimId is required');

export async function POST_inapp_checkout({ session, body }: any) {
  const input = InAppInput.parse(body);

  // Resolve the expected amount from the linked entity and verify ownership.
  // We never trust a client-supplied amount — it must match the plan price or
  // route fare exactly, otherwise a 1-cent payment could activate a 1500-ETB
  // subscription.
  let amountCents: number;
  let description: string;
  let subscriptionId: string | undefined;
  let seatClaimId: string | undefined;

  if (input.subscriptionId) {
    const sub = await db.subscription.findUnique({
      where: { id: input.subscriptionId },
      include: { plan: true },
    });
    if (!sub) throw new NotFoundError('Subscription not found');
    if (sub.userId !== session.id) throw new ForbiddenError('Not your subscription');
    let riderAmountCents = sub.plan.priceCents;
    if (sub.corporateId) {
      const corp = await db.corporate.findUnique({ where: { id: sub.corporateId } });
      if (corp) {
        riderAmountCents = sub.plan.priceCents - Math.round(sub.plan.priceCents * corp.subsidyPercent / 100);
      }
    }
    amountCents = riderAmountCents;
    description = input.description ?? `${sub.plan.name} subscription (InApp)`;
    subscriptionId = sub.id;
  } else {
    const claim = await db.seatClaim.findUnique({
      where: { id: input.seatClaimId! },
      include: { seatRelease: { include: { trip: { include: { route: true } } } } },
    });
    if (!claim) throw new NotFoundError('Seat claim not found');
    if (claim.claimantUserId !== session.id) throw new ForbiddenError('Not your seat claim');
    amountCents = claim.seatRelease.trip.route.fareCents;
    description = input.description ?? `Seat claim for ${claim.seatRelease.trip.route.origin} → ${claim.seatRelease.trip.route.destination}`;
    seatClaimId = claim.id;
  }

  if (amountCents <= 0) throw new BadRequestError('Resolved amount must be positive');

  const provider = getPaymentProvider('telebirr');
  if (!provider.createInAppOrder) {
    throw new BadRequestError('InApp SDK not supported by current provider');
  }

  const reference = `PO${createId()}`;
  const env = loadEnv();
  const intent = {
    merchOrderId: reference,
    amount: Money.fromCents(amountCents),
    description,
    notifyUrl: env.TELEBIRR_NOTIFY_URL || `${env.APP_BASE_URL}/api/v1/webhooks/telebirr/notify`,
    redirectUrl: env.TELEBIRR_REDIRECT_URL || `${env.APP_BASE_URL}/checkout/complete`,
  };

  const result = await provider.createInAppOrder(intent);

  await db.payment.create({
    data: {
      reference,
      userId: session.id,
      subscriptionId,
      seatClaimId,
      method: 'telebirr',
      amountCents,
      status: 'pending',
    },
  });

  return {
    status: 201,
    data: {
      paymentReference: reference,
      prepayId: result.prepayId,
      receiveCode: result.receiveCode,
    },
  };
}

const MandateSignInput = z.object({
  mandateTemplateId: z.string().min(1),
  // Optional: link this mandate to a subscription for our records
  subscriptionId: z.string().optional(),
});

export async function POST_mandate_sign_url({ session, body }: any) {
  const input = MandateSignInput.parse(body);
  const provider = getPaymentProvider('telebirr');
  if (!provider.buildMandateSignUrl) {
    throw new BadRequestError('Subscription Payment not supported by current provider');
  }

  let mctContractNo = '';
  for (let i = 0; i < 32; i++) mctContractNo += Math.floor(Math.random() * 10).toString();

  const result = provider.buildMandateSignUrl({
    mctContractNo,
    mandateTemplateId: input.mandateTemplateId,
  });

  await audit({
    actorId: session.id,
    action: 'telebirr.mandate_sign_url_generated',
    entityType: 'subscription',
    entityId: input.subscriptionId ?? 'unknown',
    after: { mctContractNo, mandateTemplateId: input.mandateTemplateId },
  });

  return {
    status: 201,
    data: result,
  };
}

export async function GET_mandate({ params }: any) {
  const provider = getPaymentProvider('telebirr');
  if (!provider.queryMandate) {
    throw new BadRequestError('Subscription Payment not supported by current provider');
  }
  const result = await provider.queryMandate(params.mctContractNo);
  return { data: result };
}

export async function POST_mandate_cancel({ session, params, ipAddress, userAgent }: any) {
  const provider = getPaymentProvider('telebirr');
  if (!provider.cancelMandate) {
    throw new BadRequestError('Subscription Payment not supported by current provider');
  }
  const result = await provider.cancelMandate(params.mctContractNo);
  await audit({
    actorId: session.id,
    action: 'telebirr.mandate_cancelled',
    entityType: 'mandate',
    entityId: params.mctContractNo,
    after: { ok: result.ok },
    ipAddress, userAgent,
  });
  return { data: result };
}

const DisburseInput = z.object({
  mctContractNo: z.string().length(32),
  amountCents: z.number().int().positive(),
  reason: z.string().min(1).max(200),
});

export async function POST_disburse({ session, body, ipAddress, userAgent }: any) {
  // Route is already requireRole: ['platform_admin'] in the route table;
  // this is a defensive check in case the handler is ever called directly.
  if (session?.role !== 'platform_admin') {
    throw new ForbiddenError('Admin only — disburse is for the scheduler or admin testing');
  }
  const input = DisburseInput.parse(body);
  const provider = getPaymentProvider('telebirr');
  if (!provider.disburse) {
    throw new BadRequestError('Subscription Payment not supported by current provider');
  }

  const merchOrderId = `DIS${createId()}`;
  const result = await provider.disburse({
    mctContractNo: input.mctContractNo,
    merchOrderId,
    amount: Money.fromCents(input.amountCents),
    reason: input.reason,
  });

  await audit({
    actorId: session.id,
    action: 'telebirr.disburse',
    entityType: 'mandate',
    entityId: input.mctContractNo,
    after: { merchOrderId, amountCents: input.amountCents, result },
    ipAddress, userAgent,
  });

  return { status: 201, data: { merchOrderId, ...result } };
}
