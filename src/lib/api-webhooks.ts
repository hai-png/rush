import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getPaymentProvider } from '@/lib/payments';
import { settlePayment, failPayment } from '@/lib/payment-service';
import { toErrorEnvelope } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { formatETB } from '@/lib/format';
import { Prisma } from '@prisma/client';

export async function handleTelebirrNotify(req: NextRequest, _session: any, _params: any, ctx: { requestId: string }): Promise<NextResponse> {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  try {
    const provider = getPaymentProvider('telebirr');
    if (!provider.parseWebhook) {
      return NextResponse.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Provider does not support webhooks', requestId } }, { status: 501 });
    }

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
    if (!env.TWILIO_AUTH_TOKEN) {
      logger.warn('[webhook] Twilio SMS status received but TWILIO_AUTH_TOKEN is unset — rejecting');
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Twilio webhook verification not configured', requestId } },
        { status: 401 }
      );
    }

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

