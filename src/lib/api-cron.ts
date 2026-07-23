import { NextResponse } from 'next/server';
import { processRefundRetries } from '@/lib/payment-service';
import { db } from '@/lib/db';
import { toErrorEnvelope } from '@/lib/errors';
import { ensureSchedulerStarted } from '@/lib/scheduler';
import { loadEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'node:crypto';

export async function POST_run(ctx: any) {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  try {
    const env = loadEnv();
    // P3 FIX: use constant-time comparison instead of !==.
    const provided = ctx.body?._cronSecret ?? '';
    const expected = env.CRON_SECRET;
    if (!provided || provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret', requestId } }, { status: 401 });
    }
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

export async function GET_cron_jobs() {
  return {
    data: [
      { name: 'outbox-drain', route: '/api/v1/cron/run', intervalMs: 30_000 },
      { name: 'refund-retries', route: '/api/v1/cron/run', intervalMs: 60_000 },
      { name: 'expire-stale', route: '/api/v1/cron/run', intervalMs: 300_000 },
      { name: 'monthly-reset', route: '/api/v1/cron/run', intervalMs: 3_600_000 },
    ],
  };
}
