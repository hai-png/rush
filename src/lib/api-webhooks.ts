import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payments";
import { settlePayment, failPayment } from "@/lib/payment-service";
import { toErrorEnvelope } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { Prisma } from "@prisma/client";

export async function handleTelebirrNotify(
  req: NextRequest,
  _session: any,
  _params: any,
  ctx: { requestId: string },
): Promise<NextResponse> {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  try {
    const provider = getPaymentProvider("telebirr");
    if (!provider.parseWebhook) {
      return NextResponse.json(
        {
          error: {
            code: "NOT_IMPLEMENTED",
            message: "Provider does not support webhooks",
            requestId,
          },
        },
        { status: 501 },
      );
    }

    // Pass the original Request through verbatim so the provider can verify
    // the signature against the raw body + headers. Re-serialising ctx.body
    // would mangle field ordering and break real Telebirr signatures.
    const event = await provider.parseWebhook(req as unknown as Request);

    if (!event.signatureValid) {
      logger.warn(
        { type: event.type },
        "[telebirr-webhook] invalid signature — rejecting",
      );
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid signature",
            requestId,
          },
        },
        { status: 401 },
      );
    }

    const outRequestNo =
      (event as any).outRequestNo ??
      (event as any).raw?.out_request_no ??
      "unknown";
    const raw = (event as any).raw;
    const tradeStatus = (event as any).raw?.trade_status ?? "unknown";

    if (event.type === "payment.settled") {
      await settlePayment(
        event.merchOrderId,
        event.amount,
        outRequestNo,
        tradeStatus,
        raw,
      );
    } else if (event.type === "payment.failed") {
      await failPayment(
        event.merchOrderId,
        raw,
        outRequestNo,
        tradeStatus,
        raw,
      );
    } else if (event.type === "refund.succeeded") {
      await markRefundSucceeded(event.refundRequestNo, raw);
    } else if (event.type === "refund.failed") {
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
async function markRefundSucceeded(
  refundRequestNo: string,
  raw: unknown,
): Promise<void> {
  const sideEffects: Array<() => Promise<void>> = [];
  await db.$transaction(async (tx) => {
    const updated = await tx.refundRetry.updateMany({
      where: { refundRequestNo, status: { in: ["pending", "processing"] } },
      data: { status: "succeeded" },
    });
    if (updated.count === 0) return;
    const retry = await tx.refundRetry.findUnique({
      where: { refundRequestNo },
    });
    if (!retry) return;
    const fresh = await tx.payment.findUnique({
      where: { id: retry.paymentId },
    });
    if (!fresh) return;
    // P0 FIX: refundAmountCents was already reserved at scheduleRefund time.
    // Do NOT add retry.amountCents again — that would double-count.
    const allRefunded = fresh.refundAmountCents >= fresh.amountCents;
    await tx.payment.update({
      where: { id: fresh.id },
      data: {
        status: allRefunded ? "refunded" : "partially_refunded",
        refundedAt: new Date(),
      },
    });
    const userId = fresh.userId;
    const refundAmount = retry.amountCents;
    sideEffects.push(async () => {
      const { enqueueNotification } = await import("@/lib/outbox");
      await enqueueNotification({
        userId,
        type: "refund_completed",
        title: "Refund completed",
        body: `Your refund of ${(refundAmount / 100).toFixed(2)} ETB has been processed.`,
      });
    });
  });
  for (const fx of sideEffects) {
    try {
      await fx();
    } catch (e) {
      logger.error(
        { err: (e as Error).message },
        "[refund-webhook] side effect failed",
      );
    }
  }
  logger.info({ refundRequestNo }, "[telebirr-webhook] refund succeeded");
}

async function markRefundFailed(
  refundRequestNo: string,
  raw: unknown,
): Promise<void> {
  const sideEffects: Array<() => Promise<void>> = [];
  await db.$transaction(async (tx) => {
    await tx.refundRetry.updateMany({
      where: { refundRequestNo, status: { in: ["pending", "processing"] } },
      data: {
        status: "permanent_failure",
        lastError: "Webhook reported refund failed",
      },
    });
    const retry = await tx.refundRetry.findUnique({
      where: { refundRequestNo },
    });
    if (!retry) return;
    const fresh = await tx.payment.findUnique({
      where: { id: retry.paymentId },
    });
    if (!fresh) return;
    const userId = fresh.userId;
    sideEffects.push(async () => {
      const { enqueueNotification } = await import("@/lib/outbox");
      await enqueueNotification({
        userId,
        type: "refund_failed",
        title: "Refund failed",
        body: "Your refund could not be processed by Telebirr.",
      });
    });
  });
  for (const fx of sideEffects) {
    try {
      await fx();
    } catch (e) {
      logger.error(
        { err: (e as Error).message },
        "[refund-webhook] side effect failed",
      );
    }
  }
  logger.warn({ refundRequestNo }, "[telebirr-webhook] refund failed");
}
