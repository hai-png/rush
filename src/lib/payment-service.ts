import { db } from "@/lib/db";
import { Money } from "@/lib/money";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { getPaymentProvider } from "@/lib/payments";
import { enqueueNotification } from "@/lib/outbox";
import { audit } from "@/lib/audit";
import { createId } from "@/lib/id";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

export async function settlePayment(
  reference: string,
  reportedAmount: Money | undefined,
  outRequestNo: string,
  tradeStatus: string,
  rawPayload: unknown,
): Promise<boolean> {
  const sideEffects: Array<() => Promise<void>> = [];

  const result = await db.$transaction(
    async (tx) => {
      try {
        await tx.telebirrNotifyEvent.create({
          data: {
            merchOrderId: reference,
            outRequestNo,
            tradeStatus,
            totalAmount: reportedAmount?.toDecimalString() ?? null,
            rawPayload: JSON.stringify(rawPayload),
          },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          return false;
        }
        throw e;
      }

      const updated = await tx.payment.updateMany({
        where: { reference, status: "pending" },
        data: { status: "completed", updatedAt: new Date() },
      });
      if (updated.count === 0) return false;

      const p = await tx.payment.findUnique({ where: { reference } });
      if (!p) return false;

      // P1-22 / BIZ-029: require reportedAmount for settlement. Previously,
      // if the webhook payload omitted `total_amount`, the amount-mismatch
      // check was skipped and the payment settled for whatever was originally
      // recorded — a malicious or buggy Telebirr could send a no-amount
      // webhook for a 1-ETB payment on a 1500-ETB order and settle it.
      if (!reportedAmount) {
        await tx.payment.update({
          where: { id: p.id },
          data: { status: "failed" },
        });
        sideEffects.push(async () => {
          await audit({
            action: "payment.amount_missing",
            entityType: "payment",
            entityId: p.id,
            after: { reason: "webhook payload omitted total_amount" },
          });
        });
        return false;
      }
      const expected = Money.fromCents(p.amountCents);
      if (!expected.eq(reportedAmount)) {
        await tx.payment.update({
          where: { id: p.id },
          data: { status: "failed" },
        });
        sideEffects.push(async () => {
          await audit({
            action: "payment.amount_mismatch",
            entityType: "payment",
            entityId: p.id,
            after: { expected: p.amountCents, reported: reportedAmount.cents },
          });
        });
        return false;
      }

      if (p.subscriptionId) {
        // Inline the subscription transition to avoid enqueueNotification inside
        // the transaction (which would deadlock SQLite).
        const sub = await tx.subscription.findUnique({
          where: { id: p.subscriptionId },
        });
        if (sub && sub.status === "pending_payment") {
          await tx.subscription.update({
            where: { id: sub.id },
            data: { status: "active" },
          });
          sideEffects.push(async () => {
            await enqueueNotification({
              userId: sub.userId,
              type: "subscription_activated",
              title: "Subscription activated",
              body: `Your subscription is now active until ${new Date(sub.endDate).toLocaleDateString()}.`,
              link: "/dashboard/rider",
            });
          });
        }
      }
      if (p.seatClaimId) {
        await tx.seatClaim.update({
          where: { id: p.seatClaimId },
          data: { status: "confirmed" },
        });
      }

      const userId = p.userId;
      const amountCents = p.amountCents;
      const paymentId = p.id;
      sideEffects.push(async () => {
        await enqueueNotification({
          userId,
          type: "payment_received",
          title: "Payment received",
          body: `Your payment of ${Money.fromCents(amountCents).toString()} was received.`,
          link: "/dashboard/rider",
        });
        await audit({
          actorId: userId,
          action: "payment.settled",
          entityType: "payment",
          entityId: paymentId,
          after: { reference, amountCents },
        });
      });
      return true;
    },
    { timeout: 15_000, maxWait: 20_000 },
  );

  for (const fx of sideEffects) {
    try {
      await fx();
    } catch (e) {
      logger.error(
        { err: (e as Error).message },
        "[settlePayment] side effect failed",
      );
    }
  }
  return result;
}

export async function failPayment(
  reference: string,
  reasonRaw: unknown,
  outRequestNo: string,
  tradeStatus: string,
  rawPayload: unknown,
): Promise<boolean> {
  const sideEffects: Array<() => Promise<void>> = [];

  const result = await db.$transaction(async (tx) => {
    try {
      await tx.telebirrNotifyEvent.create({
        data: {
          merchOrderId: reference,
          outRequestNo,
          tradeStatus,
          rawPayload: JSON.stringify(rawPayload),
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        return false;
      throw e;
    }

    const updated = await tx.payment.updateMany({
      where: { reference, status: "pending" },
      data: { status: "failed", updatedAt: new Date() },
    });
    if (updated.count === 0) return false;

    const p = await tx.payment.findUnique({ where: { reference } });
    if (!p) return false;

    if (p.seatClaimId) {
      const claim = await tx.seatClaim.findUnique({
        where: { id: p.seatClaimId },
      });
      if (claim) {
        const release = await tx.seatRelease.findUnique({
          where: { id: claim.seatReleaseId },
        });
        await tx.seatClaim.update({
          where: { id: p.seatClaimId },
          data: { status: "refunded" },
        });
        // P1 FIX: CAS on status:'claimed' so concurrent paths can't double-open.
        await tx.seatRelease.updateMany({
          where: { id: claim.seatReleaseId, status: "claimed" },
          data: { status: "open" },
        });
        // Restore the seller's ride + trip capacity — without this, the
        // seller's seat stays 'released' (decremented from seatsBooked) but
        // the release is now 'open' with no buyer, so the seller permanently
        // loses their seat AND the trip shows a phantom free seat.
        if (release) {
          const sellerRide = await tx.ride.findFirst({
            where: {
              tripId: release.tripId,
              userId: release.userId,
              status: "released",
            },
          });
          if (sellerRide) {
            await tx.ride.update({
              where: { id: sellerRide.id },
              data: { status: "booked" },
            });
            await tx.trip.update({
              where: { id: release.tripId },
              data: { seatsBooked: { increment: 1 } },
            });
          }
        }
      }
    }

    const userId = p.userId;
    const amountCents = p.amountCents;
    sideEffects.push(async () => {
      await enqueueNotification({
        userId,
        type: "payment_failed",
        title: "Payment failed",
        body: `Your payment of ${Money.fromCents(amountCents).toString()} failed.`,
      });
    });
    return true;
  });

  for (const fx of sideEffects) {
    try {
      await fx();
    } catch (e) {
      logger.error(
        { err: (e as Error).message },
        "[failPayment] side effect failed",
      );
    }
  }
  return result;
}

export async function scheduleRefund(
  paymentId: string,
  amount: Money,
  reason: string,
): Promise<void> {
  const sideEffects: Array<() => Promise<void>> = [];

  await db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundError(`Payment ${paymentId} not found`);
    if (payment.status !== "completed")
      throw new BadRequestError("Only completed payments can be refunded");
    if (!amount.isPositive())
      throw new BadRequestError("Refund amount must be positive");

    const original = Money.fromCents(payment.amountCents);
    const alreadyRefunded = Money.fromCents(payment.refundAmountCents);
    const total = alreadyRefunded.add(amount);
    if (total.gt(original)) {
      throw new BadRequestError(
        `Refund of ${amount.toString()} would exceed payment amount. Original: ${original.toString()}, already refunded: ${alreadyRefunded.toString()}.`,
      );
    }

    const refundRequestNo = `RF${createId()}`;
    await tx.refundRetry.create({
      data: {
        paymentId,
        merchOrderId: payment.reference,
        refundRequestNo,
        amountCents: amount.cents,
        reason,
      },
    });
    // P1-25 / BIZ-032: reserve the refund amount atomically with a CAS on
    // refundAmountCents. Two concurrent scheduleRefund calls both read the
    // same refundAmountCents and both pass the gt(original) check, but only
    // one CAS succeeds — the loser's tx rolls back (the RefundRetry row is
    // also rolled back, so no orphaned retry is scheduled).
    const reserveCas = await tx.payment.updateMany({
      where: {
        id: paymentId,
        // Only succeed if the new total still fits within the original amount.
        // SQLite doesn't support expression-based where-clauses, so we re-read
        // the refundAmountCents we just saw — if a concurrent refund bumped
        // it, this CAS won't match and we throw.
        refundAmountCents: payment.refundAmountCents,
      },
      data: {
        refundAmountCents: payment.refundAmountCents + amount.cents,
        status: "partially_refunded",
      },
    });
    if (reserveCas.count === 0) {
      throw new BadRequestError(
        "Concurrent refund detected — please retry. The original refund was not scheduled.",
      );
    }
    const userId = payment.userId;
    sideEffects.push(async () => {
      await audit({
        actorId: userId,
        action: "refund.scheduled",
        entityType: "payment",
        entityId: paymentId,
        after: { amountCents: amount.cents, refundRequestNo, reason },
      });
    });
  });
  for (const fx of sideEffects) {
    try {
      await fx();
    } catch (e) {
      logger.error(
        { err: (e as Error).message },
        "[scheduleRefund] side effect failed",
      );
    }
  }
}

const BACKOFF_MIN = [1, 5, 15, 60, 240];

export async function processRefundRetries(
  limit = 10,
): Promise<{ processed: number }> {
  // Reset stale 'processing' rows. Before resetting, we mark them as 'pending'
  // WITHOUT immediately retrying — the next loop iteration will pick them up,
  // and the refund call itself is idempotent on the Telebirr side (duplicate
  // refund_request_no values are deduped by Telebirr and return REFUND_DUPLICATED).
  await db.refundRetry.updateMany({
    where: {
      status: "processing",
      updatedAt: { lt: new Date(Date.now() - 15 * 60_000) },
    },
    data: { status: "pending" },
  });

  const claimed = await db.$transaction(async (tx) => {
    const rows = await tx.refundRetry.findMany({
      where: { status: "pending", nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
    });
    if (rows.length === 0) return [];
    await tx.refundRetry.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, status: "pending" },
      data: { status: "processing" },
    });
    return rows;
  });

  let processed = 0;
  for (const retry of claimed) {
    const payment = await db.payment.findUnique({
      where: { id: retry.paymentId },
    });
    if (!payment) continue;
    const provider = getPaymentProvider(payment.method as "telebirr" | "cbe");
    if (!provider.refund) continue;

    let result;
    try {
      result = await provider.refund({
        merchOrderId: retry.merchOrderId,
        refundRequestNo: retry.refundRequestNo,
        amount: Money.fromCents(retry.amountCents),
        reason: retry.reason,
      });
    } catch (err) {
      result = {
        status: "failed" as const,
        error: (err as Error).message,
        permanent: false,
      };
    }

    // Side effects run AFTER the tx commits to avoid SQLite single-writer deadlock.
    const sideEffects: Array<() => Promise<void>> = [];
    await db.$transaction(async (tx) => {
      if (result.status === "succeeded") {
        const updated = await tx.refundRetry.updateMany({
          where: { id: retry.id, status: { in: ["pending", "processing"] } },
          data: { status: "succeeded" },
        });
        if (updated.count === 0) return;

        // P0 FIX: refundAmountCents was ALREADY reserved at scheduleRefund time
        // (line 222-235). Do NOT add retry.amountCents again — that would double-count.
        // Just update the status based on the already-reserved amount.
        const fresh = await tx.payment.findUnique({
          where: { id: payment.id },
        });
        if (!fresh) return;
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
          await enqueueNotification({
            userId,
            type: "refund_completed",
            title: "Refund completed",
            body: `Your refund of ${Money.fromCents(refundAmount).toString()} has been processed.`,
          });
        });
      } else {
        const attempts = retry.attempts + 1;
        if (result.status === "failed" && result.permanent) {
          await tx.refundRetry.update({
            where: { id: retry.id },
            data: {
              status: "permanent_failure",
              attempts,
              lastError: result.error,
            },
          });
          sideEffects.push(async () => {
            await enqueueNotification({
              userId: payment.userId,
              type: "refund_failed",
              title: "Refund failed",
              body: "Your refund could not be processed.",
            });
          });
        } else if (attempts >= retry.maxAttempts) {
          await tx.refundRetry.update({
            where: { id: retry.id },
            data: { status: "permanent_failure", attempts },
          });
          sideEffects.push(async () => {
            await enqueueNotification({
              userId: payment.userId,
              type: "refund_failed",
              title: "Refund failed",
              body: "Your refund could not be processed after multiple attempts.",
            });
          });
        } else {
          const backoffMin =
            BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
          await tx.refundRetry.update({
            where: { id: retry.id },
            data: {
              attempts,
              nextAttemptAt: new Date(Date.now() + backoffMin * 60_000),
              lastError: result.status === "failed" ? result.error : null,
            },
          });
        }
      }
    });
    for (const fx of sideEffects) {
      try {
        await fx();
      } catch (e) {
        logger.error(
          { err: (e as Error).message },
          "[processRefundRetries] side effect failed",
        );
      }
    }
    processed++;
  }
  return { processed };
}
