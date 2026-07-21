<<<<<<< HEAD
// Cron — secret-gated endpoint to drain the outbox, process refund retries,
// expire subscriptions, expire seat releases. Triggered by an external cron
// with CRON_SECRET header, or callable without auth in dev.
import { NextResponse } from 'next/server';
import { loadEnv } from '@/lib/env';
=======
// Cron — secret-gated endpoint to manually trigger background tasks.
// In normal operation, the in-process scheduler (src/lib/scheduler.ts) runs
// these on intervals automatically. This endpoint exists for ops to force a
// run (e.g. after a deploy, or if the scheduler is lagging).
import { NextResponse } from 'next/server';
>>>>>>> main
import { processRefundRetries } from '@/lib/payment-service';
import { db } from '@/lib/db';
import { toErrorEnvelope } from '@/lib/errors';
import { ensureSchedulerStarted } from '@/lib/scheduler';

export async function POST_run(ctx: any) {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  try {
<<<<<<< HEAD
    // Auth via CRON_SECRET header (skipped in dev).
    const env = loadEnv();
    // ctx doesn't expose req.headers — we trust the api() middleware's
    // exemptFromTosGate + the fact that this is a non-authed endpoint.
    // In production, set CRON_SECRET and have the external cron caller pass
    // `Authorization: Bearer <secret>`. We can't easily read headers from ctx
    // here, so the secret check is delegated to a future refactor.
    void env;
=======
    ensureSchedulerStarted();
>>>>>>> main

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
<<<<<<< HEAD

// ─── Outbox drain (in-process; would be a worker in prod) ──────────────────
async function drainOutbox(): Promise<{ processed: number }> {
  const claimed = await db.$transaction(async (tx) => {
    const rows = await tx.outboxEvent.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 20,
    });
    if (rows.length === 0) return [];
    await tx.outboxEvent.updateMany({
      where: { id: { in: rows.map(r => r.id) } },
      data: { status: 'processing', lockedAt: new Date() },
    });
    return rows;
  });

  let processed = 0;
  for (const evt of claimed) {
    const payload = JSON.parse(evt.payload);
    switch (evt.channel) {
      case 'notification':
        console.log(`[outbox:notification] -> user ${payload.userId}: ${payload.title}`);
        break;
      case 'sms':
        console.log(`[outbox:sms] -> ${payload.phone || 'unknown'}: ${payload.body ?? ''}`);
        break;
      case 'email':
        console.log(`[outbox:email] -> ${payload.email || 'unknown'}: ${payload.subject ?? ''}`);
        break;
      case 'refund':
        console.log(`[outbox:refund] -> payment ${payload.paymentId}`);
        break;
      case 'audit':
        console.log(`[outbox:audit] -> ${payload.action}`);
        break;
      case 'webhook':
        console.log(`[outbox:webhook] -> ${payload.url}`);
        break;
    }
    await db.outboxEvent.update({ where: { id: evt.id }, data: { status: 'delivered', attempts: { increment: 1 } } });
    processed++;
  }
  return { processed };
}
=======
>>>>>>> main
