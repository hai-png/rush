// In-process scheduler — runs background tasks on intervals.
// In production this would be a separate worker process or external cron,
// but for the MVP slice we run it inside the Next.js dev server process.
//
// Tasks:
//   - Every 30s: drain outbox (notifications, SMS, email, audit, webhook)
//   - Every 60s: process refund retries (pending -> processing -> succeeded/failed)
//   - Every 5min: expire active subscriptions past their endDate
//   - Every 5min: expire open seat releases past their expiresAt
//   - Every 1h (at minute 0): reset corporate members' monthly ride counters
//   - Every 1h (at minute 0): send subscription-expiring-soon notifications
//
// All intervals use .unref() so the scheduler doesn't keep the process alive
// on its own (important for graceful shutdowns).
//
// The scheduler is started lazily on first API request via ensureSchedulerStarted().

import { db } from '@/lib/db';
import { processRefundRetries } from '@/lib/payment-service';
import { enqueueNotification } from '@/lib/outbox';

let started = false;

export function ensureSchedulerStarted(): void {
  if (started) return;
  started = true;

  // Drain outbox every 30s.
  const outboxTimer = setInterval(drainOutbox, 30_000);
  outboxTimer.unref?.();
  // Run once immediately so dev doesn't have to wait 30s.
  drainOutbox().catch(err => console.error('[scheduler] outbox drain failed:', err));

  // Process refund retries every 60s.
  const refundTimer = setInterval(() => {
    processRefundRetries(20).catch(err => console.error('[scheduler] refund processing failed:', err));
  }, 60_000);
  refundTimer.unref?.();

  // Expire subs + seat releases every 5min.
  const expireTimer = setInterval(expireStale, 5 * 60_000);
  expireTimer.unref?.();
  expireStale().catch(err => console.error('[scheduler] expire failed:', err));

  // Corporate monthly reset + subscription-expiry warnings every hour.
  const hourlyTimer = setInterval(hourlyJobs, 60 * 60_000);
  hourlyTimer.unref?.();
  hourlyJobs().catch(err => console.error('[scheduler] hourly failed:', err));

  console.log('[scheduler] started: outbox(30s), refunds(60s), expire(5m), hourly(1h)');
}

// ─── Drain outbox ────────────────────────────────────────────────────────────
async function drainOutbox(): Promise<void> {
  let processed = 0;
  // Loop until the queue is empty (or we hit a safety cap).
  for (let i = 0; i < 5; i++) {
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

    if (claimed.length === 0) break;

    for (const evt of claimed) {
      try {
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
        await db.outboxEvent.update({
          where: { id: evt.id },
          data: { status: 'delivered', attempts: { increment: 1 } },
        });
        processed++;
      } catch (err) {
        const attempts = evt.attempts + 1;
        if (attempts >= evt.maxAttempts) {
          await db.outboxEvent.update({
            where: { id: evt.id },
            data: { status: 'dead', attempts, lastError: (err as Error).message },
          });
        } else {
          const backoffMin = Math.min(attempts * 2, 30);
          await db.outboxEvent.update({
            where: { id: evt.id },
            data: {
              status: 'pending',
              attempts,
              lastError: (err as Error).message,
              nextAttemptAt: new Date(Date.now() + backoffMin * 60_000),
              lockedAt: null,
            },
          });
        }
      }
    }
  }
  if (processed > 0) {
    console.log(`[scheduler] drained ${processed} outbox events`);
  }
}

// ─── Expire stale subs + seat releases ──────────────────────────────────────
async function expireStale(): Promise<void> {
  const expiredSubs = await db.subscription.updateMany({
    where: { status: 'active', endDate: { lt: new Date() } },
    data: { status: 'expired' },
  });
  const expiredReleases = await db.seatRelease.updateMany({
    where: { status: 'open', expiresAt: { lt: new Date() } },
    data: { status: 'expired' },
  });

  // Notify owners of expired subs.
  if (expiredSubs.count > 0) {
    const expired = await db.subscription.findMany({
      where: { status: 'expired', updatedAt: { gt: new Date(Date.now() - 5 * 60_000) } },
      select: { id: true, userId: true },
    });
    for (const s of expired) {
      await enqueueNotification({
        userId: s.userId,
        type: 'subscription_expired',
        title: 'Subscription expired',
        body: 'Your subscription has expired. Renew to keep riding.',
        link: '/plans',
      }).catch(() => {});
    }
  }

  if (expiredSubs.count > 0 || expiredReleases.count > 0) {
    console.log(`[scheduler] expired ${expiredSubs.count} subs, ${expiredReleases.count} seat releases`);
  }
}

// ─── Hourly jobs ────────────────────────────────────────────────────────────
async function hourlyJobs(): Promise<void> {
  await Promise.all([resetCorporateMonthlyCounters(), sendSubscriptionExpiryWarnings()]);
}

// Reset corporate members' ridesUsedThisMonth counter if it's been more than
// 30 days since the last reset.
async function resetCorporateMonthlyCounters(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600_000);
  const result = await db.corporateMember.updateMany({
    where: {
      isActive: true,
      deletedAt: null,
      lastResetAt: { lt: cutoff },
      ridesUsedThisMonth: { gt: 0 },
    },
    data: {
      ridesUsedThisMonth: 0,
      lastResetAt: new Date(),
    },
  });
  if (result.count > 0) {
    console.log(`[scheduler] reset monthly counters for ${result.count} corporate members`);
  }
}

// Send "subscription expiring soon" notification 3 days before endDate.
async function sendSubscriptionExpiryWarnings(): Promise<void> {
  const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 3600_000);
  const oneDayFromNow = new Date(Date.now() + 24 * 3600_000);
  const soonExpiring = await db.subscription.findMany({
    where: {
      status: 'active',
      endDate: { gt: oneDayFromNow, lt: threeDaysFromNow },
    },
    select: { id: true, userId: true, endDate: true },
  });

  // Avoid spamming: only notify if no 'subscription_expiring' notification
  // exists for this user in the last 24h.
  let notified = 0;
  for (const s of soonExpiring) {
    const recent = await db.notification.findFirst({
      where: {
        userId: s.userId,
        type: 'subscription_expiring',
        createdAt: { gt: new Date(Date.now() - 24 * 3600_000) },
      },
      select: { id: true },
    });
    if (recent) continue;

    await enqueueNotification({
      userId: s.userId,
      type: 'subscription_expiring',
      title: 'Subscription expiring soon',
      body: `Your subscription expires on ${new Date(s.endDate).toLocaleDateString()}. Renew to keep riding.`,
      link: '/plans',
    }).catch(() => {});
    notified++;
  }
  if (notified > 0) {
    console.log(`[scheduler] sent ${notified} subscription-expiry warnings`);
  }
}
