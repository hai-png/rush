import { NextResponse } from 'next/server';
import { toErrorEnvelope } from '@/lib/errors';
import {
  ensureSchedulerStarted,
  runAllJobs,
  drainOutbox,
  processRefundRetries,
  expireStale,
  hourlyJobs,
} from '@/lib/scheduler';
import { loadEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'node:crypto';

// #9: per-job trigger — accepts ?job=drain-outbox|refund-retries|expire-stale|hourly
// and runs ONLY that job. When omitted, runs all jobs (the historical behavior).
const JOB_NAMES = new Set(['drain-outbox', 'refund-retries', 'expire-stale', 'hourly']);

async function runJob(job: string | undefined): Promise<{ job: string; ok: boolean }> {
  if (!job || job === 'all') {
    await runAllJobs();
    return { job: 'all', ok: true };
  }
  switch (job) {
    case 'drain-outbox':
      await drainOutbox();
      return { job, ok: true };
    case 'refund-retries':
      await processRefundRetries(50);
      return { job, ok: true };
    case 'expire-stale':
      await expireStale();
      return { job, ok: true };
    case 'hourly':
      await hourlyJobs();
      return { job, ok: true };
    default:
      throw new Error(`Unknown job: ${job}`);
  }
}

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

    // #9: optional ?job= query param selects a single job to run.
    const requestedJob = (ctx.query?.job ?? '').trim();
    if (requestedJob && !JOB_NAMES.has(requestedJob)) {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: `Unknown job: ${requestedJob}. Valid: drain-outbox, refund-retries, expire-stale, hourly`, requestId } }, { status: 400 });
    }

    // Run the requested job(s). runAllJobs returns aggregate counts that we
    // mirror back to the caller (kept under stable keys for backward-compat
    // with the e2e suite and any external monitors).
    const allResult = requestedJob
      ? null
      : await runAllJobs();
    if (requestedJob) {
      await runJob(requestedJob);
    }

    return NextResponse.json({
      data: {
        job: requestedJob || 'all',
        refunds: allResult?.refunds ?? 0,
        outbox: {
          pending: allResult?.outboxPending ?? 0,
          processing: allResult?.outboxProcessing ?? 0,
        },
        scheduler: 'running',
        message: requestedJob
          ? `Job '${requestedJob}' executed`
          : 'All jobs executed (drain-outbox + refund-retries + expire-stale + hourly)',
      },
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[cron] job failed');
    const { status, body } = toErrorEnvelope(err, requestId);
    return NextResponse.json(body, { status });
  }
}

export async function GET_cron_jobs() {
  return {
    data: [
      { name: 'drain-outbox', route: '/api/v1/cron/run?job=drain-outbox', intervalMs: 30_000 },
      { name: 'refund-retries', route: '/api/v1/cron/run?job=refund-retries', intervalMs: 60_000 },
      { name: 'expire-stale', route: '/api/v1/cron/run?job=expire-stale', intervalMs: 300_000 },
      { name: 'hourly', route: '/api/v1/cron/run?job=hourly', intervalMs: 3_600_000 },
      { name: 'all', route: '/api/v1/cron/run', intervalMs: 0, note: 'Runs every job sequentially — use a low-frequency cron.' },
    ],
  };
}
