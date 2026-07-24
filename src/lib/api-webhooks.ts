import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getPaymentProvider } from '@/lib/payments';
import { settlePayment, failPayment } from '@/lib/payment-service';
import { toErrorEnvelope } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { formatETB } from '@/lib/format';
import { Prisma } from '@prisma/client';

// CRITICAL FIX (C-9): All webhook handlers now return NextResponse (not plain
// { status, data } objects). The dispatcher's handleRaw only special-cases
// NextResponse instances — plain objects were being wrapped via
// NextResponse.json() which always uses HTTP 200, so a forged Twilio webhook
// with an invalid signature received 200 OK instead of 401, and Twilio/Resend
// would stop retrying.
//
// CRITICAL FIX (H-13): verifyTwilioSignature now receives the parsed body
// params so the HMAC covers URL + sorted(POST params + query params) per
// Twilio's spec. Previously only query params were included, allowing an
// attacker to POST arbitrary MessageSid/MessageStatus values with a valid
// query-string signature.
//
// CRITICAL FIX (H-14): Resend webhook signature verification is now wired
// up. Previously verifyResendSignature was implemented but never called.
//
// CRITICAL FIX (H-18): If TWILIO_AUTH_TOKEN is unset, the Twilio webhook
// now fails closed (401) instead of accepting arbitrary POSTs.

export async function handleTelebirrNotify(req: NextRequest, _session: any, _params: any, ctx: { requestId: string }): Promise<NextResponse> {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  try {
    const provider = getPaymentProvider('telebirr');
    if (!provider.parseWebhook) {
      return NextResponse.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Provider does not support webhooks', requestId } }, { status: 501 });
    }

    // the signature against the raw body + headers. Re-serialising ctx.body
    // would mangle field ordering and break real Telebirr signatures.
    const event = await provider.parseWebhook(req as unknown as Request);

    if (!event.signatureValid) {
      logger.warn({ type: event.type }, '[telebirr-webhook] invalid signature — rejecting');
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid signature', requestId } }, { status: 401 });
    }

    const outRequestNo = (event as any).outRequestNo ?? (event as any).raw?.out_request_no ?? 'unknown';
    const raw = (event as any).raw;
    const tradeStatus = (event as any).raw?.trade_status ?? 'unknown';

    if (event.type === 'payment.settled') {
      await settlePayment(event.merchOrderId, event.amount, outRequestNo, tradeStatus, raw);
    } else if (event.type === 'payment.failed') {
      await failPayment(event.merchOrderId, raw, outRequestNo, tradeStatus, raw);
    } else if (event.type === 'refund.succeeded') {
      await markRefundSucceeded(event.refundRequestNo, raw);
    } else if (event.type === 'refund.failed') {
      await markRefundFailed(event.refundRequestNo, raw);
    }

    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err, requestId);
    return NextResponse.json(body, { status });
  }
}

// Update RefundRetry + Payment when a refund webhook arrives. Without this,
// the row stays 'pending'/'processing' forever and the user is never notified
// (only the polling-based processRefundRetries path would have marked it).
async function markRefundSucceeded(refundRequestNo: string, raw: unknown): Promise<void> {
  const sideEffects: Array<() => Promise<void>> = [];
  await db.$transaction(async (tx) => {
    const updated = await tx.refundRetry.updateMany({
      where: { refundRequestNo, status: { in: ['pending', 'processing'] } },
      data: { status: 'succeeded' },
    });
    if (updated.count === 0) return;
    const retry = await tx.refundRetry.findUnique({ where: { refundRequestNo } });
    if (!retry) return;
    const fresh = await tx.payment.findUnique({ where: { id: retry.paymentId } });
    if (!fresh) return;
    // refundAmountCents was already reserved at scheduleRefund time.
    // Do NOT add retry.amountCents again — that would double-count.
    const allRefunded = fresh.refundAmountCents >= fresh.amountCents;
    await tx.payment.update({
      where: { id: fresh.id },
      data: {
        status: allRefunded ? 'refunded' : 'partially_refunded',
        refundedAt: new Date(),
      },
    });
    const userId = fresh.userId;
    const refundAmount = retry.amountCents;
    sideEffects.push(async () => {
      const { enqueueNotification } = await import('@/lib/outbox');
      await enqueueNotification({
        userId,
        type: 'refund_completed',
        title: 'Refund completed',
        body: `Your refund of ${formatETB(refundAmount)} has been processed.`,
      });
    });
  });
  for (const fx of sideEffects) { try { await fx(); } catch (e) { logger.error({ err: (e as Error).message }, '[refund-webhook] side effect failed'); } }
  logger.info({ refundRequestNo }, '[telebirr-webhook] refund succeeded');
}

async function markRefundFailed(refundRequestNo: string, raw: unknown): Promise<void> {
  const sideEffects: Array<() => Promise<void>> = [];
  await db.$transaction(async (tx) => {
    await tx.refundRetry.updateMany({
      where: { refundRequestNo, status: { in: ['pending', 'processing'] } },
      data: { status: 'permanent_failure', lastError: 'Webhook reported refund failed' },
    });
    const retry = await tx.refundRetry.findUnique({ where: { refundRequestNo } });
    if (!retry) return;
    const fresh = await tx.payment.findUnique({ where: { id: retry.paymentId } });
    if (!fresh) return;
    const userId = fresh.userId;
    sideEffects.push(async () => {
      const { enqueueNotification } = await import('@/lib/outbox');
      await enqueueNotification({
        userId,
        type: 'refund_failed',
        title: 'Refund failed',
        body: 'Your refund could not be processed by Telebirr.',
      });
    });
  });
  for (const fx of sideEffects) { try { await fx(); } catch (e) { logger.error({ err: (e as Error).message }, '[refund-webhook] side effect failed'); } }
  logger.warn({ refundRequestNo }, '[telebirr-webhook] refund failed');
}


export async function handleTwilioStatus(req: NextRequest, _session: any, _params: any, ctx: { requestId: string }): Promise<NextResponse> {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  try {
    const env = (await import('@/lib/env')).loadEnv();

    // CRITICAL FIX (H-18): Fail closed if TWILIO_AUTH_TOKEN is unset.
    // Previously, when the token was missing (the default in .env.example),
    // the endpoint accepted arbitrary POSTs and logged MessageSid/MessageStatus
    // from untrusted input. Combined with C-9 (return-shape bug), an attacker
    // could flood the audit log with bogus webhook events.
    if (!env.TWILIO_AUTH_TOKEN) {
      logger.warn('[webhook] Twilio SMS status received but TWILIO_AUTH_TOKEN is unset — rejecting');
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Twilio webhook verification not configured', requestId } },
        { status: 401 }
      );
    }

    // CRITICAL FIX (H-13): Read the raw body BEFORE signature verification
    // and merge POST params into the verification object. Twilio's signature
    // is HMAC-SHA1 over URL + sorted(POST params + query params). Previously
    // only query params were included, so an attacker could POST arbitrary
    // body values with a valid query-string signature.
    const rawBody = await req.text();
    const bodyParams: Record<string, string> = {};
    const urlSearchParams = new URLSearchParams(rawBody);
    urlSearchParams.forEach((v, k) => { bodyParams[k] = v; });

    const { verifyTwilioSignatureWithBody } = await import('@/lib/webhook-verify');
    if (!verifyTwilioSignatureWithBody(req, env.TWILIO_AUTH_TOKEN, bodyParams)) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Invalid signature', requestId } },
        { status: 401 }
      );
    }

    const messageSid = bodyParams.MessageSid;
    const messageStatus = bodyParams.MessageStatus;
    logger.info({ messageSid, messageStatus }, '[webhook] Twilio SMS status');
    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err, requestId);
    return NextResponse.json(body, { status });
  }
}


export async function handleResendStatus(req: NextRequest, _session: any, _params: any, ctx: { requestId: string }): Promise<NextResponse> {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  try {
    const env = (await import('@/lib/env')).loadEnv();
    const body = await req.text();

    // CRITICAL FIX (H-14): Wire up Resend signature verification. Previously
    // verifyResendSignature was implemented but never called, so anyone could
    // POST arbitrary email-bounce events. If RESEND_WEBHOOK_SECRET is unset,
    // fail closed (reject all) rather than silently accepting unverified posts.
    if (!env.RESEND_WEBHOOK_SECRET) {
      logger.warn('[webhook] Resend email status received but RESEND_WEBHOOK_SECRET is unset — rejecting');
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Resend webhook verification not configured', requestId } },
        { status: 401 }
      );
    }

    const { verifyResendSignature } = await import('@/lib/webhook-verify');
    if (!verifyResendSignature(req, body, env.RESEND_WEBHOOK_SECRET)) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Invalid signature', requestId } },
        { status: 401 }
      );
    }

    logger.info({ bodyLength: body.length }, '[webhook] Resend email status received');
    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err, requestId);
    return NextResponse.json(body, { status });
  }
}
