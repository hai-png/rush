import { NextResponse } from 'next/server';
import { toErrorEnvelope } from '@/lib/errors';
import { ensureSchedulerStarted, runAllJobs } from '@/lib/scheduler';
import { loadEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'node:crypto';

export async function POST_run(ctx: any) {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  try {
    const env = loadEnv();
    // use constant-time comparison instead of !==.
    const provided = ctx.body?._cronSecret ?? '';
    const expected = env.CRON_SECRET;
    if (!provided || provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret', requestId } }, { status: 401 });
    }
    ensureSchedulerStarted();

    // call the SAME functions the scheduler uses, not a partial
    // notifications, monthly corporate counter reset, and outbox drain.
    const result = await runAllJobs();

    return NextResponse.json({
      data: {
        refunds: result.refunds,
        outbox: { pending: result.outboxPending, processing: result.outboxProcessing },
        scheduler: 'running',
        message: 'All jobs executed (expire + cascade + outbox + hourly)',
      },
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[cron] runAllJobs failed');
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
