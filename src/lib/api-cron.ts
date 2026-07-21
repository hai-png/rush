// Cron — secret-gated endpoint to manually trigger background tasks.
// In normal operation, the in-process scheduler (src/lib/scheduler.ts) runs
// these on intervals automatically. This endpoint exists for ops to force a
// run (e.g. after a deploy, or if the scheduler is lagging).
import { NextResponse } from 'next/server';
import { processRefundRetries } from '@/lib/payment-service';
import { db } from '@/lib/db';
import { toErrorEnvelope } from '@/lib/errors';
import { ensureSchedulerStarted } from '@/lib/scheduler';

export async function POST_run(ctx: any) {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  try {
    ensureSchedulerStarted();

    const refundResult = await processRefundRetries(20);

    const expiredSubs = await db.subscription.updateMany({
      where: { status: 'active', endDate: { lt: new Date() } },
      data: { status: 'expired' },
    });

    const expiredReleases = await db.seatRelease.updateMany({
      where: { status: 'open', expiresAt: { lt: new Date() } },
      data: { status: 'expired' },
    });

    const pendingOutbox = await db.outboxEvent.count({ where: { status: 'pending' } });
    const processingOutbox = await db.outboxEvent.count({ where: { status: 'processing' } });

    return NextResponse.json({
      data: {
        refunds: refundResult,
        expiredSubs: expiredSubs.count,
        expiredReleases: expiredReleases.count,
        outbox: { pending: pendingOutbox, processing: processingOutbox },
        scheduler: 'running',
      },
    });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err, requestId);
    return NextResponse.json(body, { status });
  }
}
