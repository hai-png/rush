// Telebirr advanced endpoints — InApp SDK + Subscription Payment.
// These supplement the basic H5 checkout that's wired into /api/v1/subscriptions.
//
// InApp SDK:
//   POST /api/v1/payments/telebirr/inapp-checkout
//     - For mobile clients with the Telebirr SDK. Returns prepay_id + receiveCode.
//     - The mobile SDK uses those to launch Telebirr SuperApp.
//
// Subscription Payment:
//   POST /api/v1/payments/telebirr/mandate/sign-url
//     - Returns the merchant:// deep-link URL the front-end SDK invokes.
//     - The customer signs the mandate in Telebirr SuperApp (PIN entry).
//   GET  /api/v1/payments/telebirr/mandate/:mctContractNo
//     - Query mandate status (active / cancelled / unknown)
//   POST /api/v1/payments/telebirr/mandate/:mctContractNo/cancel
//     - Cancel a mandate (no further disbursements possible)
//   POST /api/v1/payments/telebirr/disburse
//     - Pull funds from a signed mandate (PIN-free). Used by the scheduler.

import { z } from 'zod';
import { db } from '@/lib/db';
import { Money } from '@/lib/money';
import { getPaymentProvider } from '@/lib/payments';
import { loadEnv } from '@/lib/env';
import { BadRequestError, NotFoundError } from '@/lib/errors';
import { createId } from '@/lib/id';
import { audit } from '@/lib/audit';

// ─── InApp SDK ───────────────────────────────────────────────────────────────
const InAppInput = z.object({
  amountCents: z.number().int().positive(),
  description: z.string().min(1).max(200),
  // Optional: link to a subscription or seat claim
  subscriptionId: z.string().optional(),
  seatClaimId: z.string().optional(),
});

export async function POST_inapp_checkout({ session, body }: any) {
  const input = InAppInput.parse(body);
  const provider = getPaymentProvider('telebirr');
  if (!provider.createInAppOrder) {
    throw new BadRequestError('InApp SDK not supported by current provider');
  }

  const reference = `PO${createId()}`;
  const env = loadEnv();
  const intent = {
    merchOrderId: reference,
    amount: Money.fromCents(input.amountCents),
    description: input.description,
    notifyUrl: env.TELEBIRR_NOTIFY_URL || `${env.APP_BASE_URL}/api/v1/webhooks/telebirr/notify`,
    redirectUrl: env.TELEBIRR_REDIRECT_URL || `${env.APP_BASE_URL}/checkout/complete`,
  };

  const result = await provider.createInAppOrder(intent);

  // Create the pending payment row.
  await db.payment.create({
    data: {
      reference,
      userId: session.id,
      subscriptionId: input.subscriptionId,
      seatClaimId: input.seatClaimId,
      method: 'telebirr',
      amountCents: input.amountCents,
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

// ─── Subscription: mandate sign URL ──────────────────────────────────────────
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

  // Generate a 32-digit numeric contract number (system-unique per Telebirr docs)
  let mctContractNo = '';
  for (let i = 0; i < 32; i++) mctContractNo += Math.floor(Math.random() * 10).toString();

  const result = provider.buildMandateSignUrl({
    mctContractNo,
    mandateTemplateId: input.mandateTemplateId,
  });

  // If subscriptionId was provided, record the contract number on the subscription
  // (in a real app, you'd add a `telebirrMctContractNo` field to Subscription).
  // For MVP, just return the URL + contract number — the front-end invokes the
  // deep link, then polls /mandate/:mctContractNo to confirm signing.

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

// ─── Subscription: query mandate ─────────────────────────────────────────────
export async function GET_mandate({ params }: any) {
  const provider = getPaymentProvider('telebirr');
  if (!provider.queryMandate) {
    throw new BadRequestError('Subscription Payment not supported by current provider');
  }
  const result = await provider.queryMandate(params.mctContractNo);
  return { data: result };
}

// ─── Subscription: cancel mandate ────────────────────────────────────────────
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

// ─── Subscription: disburse (pull funds) ─────────────────────────────────────
// Typically called by the cron scheduler, not by users. Auth via CRON_SECRET
// in production; in dev, any signed-in admin can trigger for testing.
const DisburseInput = z.object({
  mctContractNo: z.string().length(32),
  amountCents: z.number().int().positive(),
  reason: z.string().min(1).max(200),
});

export async function POST_disburse({ session, body, ipAddress, userAgent }: any) {
  if (session?.role !== 'platform_admin') {
    throw new BadRequestError('Admin only — disburse is for the scheduler or admin testing');
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
