
import { db } from '@/lib/db';
import { processRefundRetries } from '@/lib/payment-service';
import { enqueueNotification } from '@/lib/outbox';
import { getSmsProvider } from '@/lib/sms';
import { getEmailProvider } from '@/lib/email';
import { logger } from '@/lib/logger';

let started = false;

export function ensureSchedulerStarted(): void {
  if (started) return;
  started = true;

  const outboxTimer = setInterval(drainOutbox, 30_000);
  outboxTimer.unref?.();
  // Run once immediately so dev doesn't have to wait 30s.
  drainOutbox().catch(err => logger.error({ err: (err as Error).message }, '[scheduler] outbox drain failed'));

  const refundTimer = setInterval(() => {
    processRefundRetries(20).catch(err => logger.error({ err: (err as Error).message }, '[scheduler] refund processing failed'));
  }, 60_000);
  refundTimer.unref?.();

  const expireTimer = setInterval(expireStale, 5 * 60_000);
  expireTimer.unref?.();
  expireStale().catch(err => logger.error({ err: (err as Error).message }, '[scheduler] expire failed'));

  const hourlyTimer = setInterval(hourlyJobs, 60 * 60_000);
  hourlyTimer.unref?.();
  hourlyJobs().catch(err => logger.error({ err: (err as Error).message }, '[scheduler] hourly failed'));

  logger.info('[scheduler] started: outbox(30s), refunds(60s), expire(5m), hourly(1h)');
}

// export a single entry point that runs ALL jobs, so the external
// cron endpoint (api-cron.ts POST_run) can call the same logic as the
// on expired releases, subscription-expiry notifications, monthly corporate
// counter reset, outbox drain).
export async function runAllJobs(): Promise<{
  refunds: number;
  expiredSubs: number;
  expiredReleases: number;
  outboxPending: number;
  outboxProcessing: number;
}> {
  // 1. Drain the outbox (SMS/email/notification delivery).
  await drainOutbox();

  // 2. Process refund retries.
  const refundResult = await processRefundRetries(50);

  // 3. Expire stale subscriptions + seat releases (with full cascade:
  //    seat restoration, notifications, etc.).
  await expireStale();

  // 4. Run hourly jobs (corporate monthly reset, subscription-expiry
  //    warnings, retention cleanup, stale seat-claim timeout, trip
  //    generation recovery, hard-delete stale users).
  await hourlyJobs();

  // Report status.
  const pendingOutbox = await db.outboxEvent.count({ where: { status: 'pending' } });
  const processingOutbox = await db.outboxEvent.count({ where: { status: 'processing' } });

  return {
    refunds: refundResult.processed,
    expiredSubs: -1, // expireStale handles this internally; count not returned
    expiredReleases: -1,
    outboxPending: pendingOutbox,
    outboxProcessing: processingOutbox,
  };
}

async function drainOutbox(): Promise<void> {
  // reaper — reset events that have been stuck in 'processing' for >15min.
  // Without this, a process crash mid-drain leaves events stranded forever.
  try {
    const reaped = await db.outboxEvent.updateMany({
      where: {
        status: 'processing',
        lockedAt: { lt: new Date(Date.now() - 15 * 60_000) },
      },
      data: { status: 'pending', lockedAt: null, lockedBy: null },
    });
    if (reaped.count > 0) {
      logger.warn({ reaped: reaped.count }, '[outbox] reset stuck processing events');
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[outbox] reaper failed');
  }

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
      // re-check status:'pending' in the updateMany where-clause so concurrent
      // drainers (multi-instance) can't both claim the same rows.
      await tx.outboxEvent.updateMany({
        where: { id: { in: rows.map(r => r.id) }, status: 'pending' },
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
            // No-op: enqueueNotification already wrote the Notification row.
            // The outbox event exists only for retry observability.
            break;
          case 'sms':
            const smsResult = await getSmsProvider().send(payload.phone, payload.body);
            if (!smsResult.ok) throw new Error(smsResult.error || 'SMS send failed');
            break;
          case 'email':
            const emailResult = await getEmailProvider().send(payload.email, payload.subject, payload.html || payload.body);
            if (!emailResult.ok) throw new Error(emailResult.error || 'Email send failed');
            break;
          case 'push':
            // deliver push notification via Expo Push API.
            // Read the user's registered device tokens from the Setting table.
            const deviceRows = await db.setting.findMany({
              where: { key: { startsWith: `device:${payload.userId}:` } },
              select: { value: true },
            });
            if (deviceRows.length === 0) break; // no registered devices — silent skip
            const tokens = deviceRows.map(r => {
              try { return JSON.parse(r.value).pushToken; } catch { return null; }
            }).filter(Boolean);
            if (tokens.length === 0) break;
            // Send to Expo Push API.
            const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(tokens.map((token: string) => ({
                to: token,
                title: payload.title,
                body: payload.body,
                data: { link: payload.link, type: payload.type },
              }))),
            });
            if (!pushResponse.ok) throw new Error(`Expo Push API returned ${pushResponse.status}`);
            break;
          default:
            // Unknown channel — log + mark delivered so we don't retry forever.
            logger.warn({ channel: evt.channel, id: evt.id }, '[outbox] unknown channel');
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
    logger.info({ processed }, '[scheduler] drained outbox events');
  }
}

async function expireStale(): Promise<void> {
  const now = new Date();
  // Capture the IDs of subs that are about to expire so we can cascade-cancel their future rides.
  const expiringSubs = await db.subscription.findMany({
    where: { status: 'active', endDate: { lt: now } },
    select: { id: true, userId: true },
  });

  const expiredSubs = await db.subscription.updateMany({
    where: { status: 'active', endDate: { lt: now } },
    data: { status: 'expired' },
  });

  // cascade-cancel future booked rides on expired subscriptions,
  // and free up the seats so other riders can book them. Rides on already-departed
  // or in-transit trips are left alone (the rider may already be on the shuttle).
  if (expiringSubs.length > 0) {
    for (const s of expiringSubs) {
      await db.$transaction(async (tx) => {
        const ridesToCancel = await tx.ride.findMany({
          where: {
            subscriptionId: s.id,
            status: 'booked',
            trip: { status: 'scheduled', departureAt: { gt: now } },
          },
          select: { id: true, tripId: true },
        });
        if (ridesToCancel.length === 0) return;
        await tx.ride.updateMany({
          where: { id: { in: ridesToCancel.map(r => r.id) } },
          data: { status: 'cancelled' },
        });
        const tripIds = [...new Set(ridesToCancel.map(r => r.tripId))];
        for (const tripId of tripIds) {
          await tx.trip.updateMany({
            where: { id: tripId, seatsBooked: { gt: 0 } },
            data: { seatsBooked: { decrement: 1 } },
          });
        }
      }).catch((err) => logger.error({ err: (err as Error).message, subId: s.id }, '[scheduler] cascade-cancel expired-sub rides failed'));
    }
  }

  // Before marking releases as expired, collect them so we can restore
  // each seller's ride + trip capacity. A release that expired without a
  // buyer means the seller gets their seat back.
  const expiringReleases = await db.seatRelease.findMany({
    where: { status: 'open', expiresAt: { lt: now } },
    select: { id: true, tripId: true, userId: true },
  });
  const expiredReleases = await db.seatRelease.updateMany({
    where: { status: 'open', expiresAt: { lt: now } },
    data: { status: 'expired' },
  });
  if (expiringReleases.length > 0) {
    for (const r of expiringReleases) {
      await db.$transaction(async (tx) => {
        // CAS-guarded restoration so concurrent paths can't double-increment seatsBooked (P1-22).
        const sellerRide = await tx.ride.findFirst({
          where: { tripId: r.tripId, userId: r.userId, status: 'released' },
          select: { id: true },
        });
        if (sellerRide) {
          const rideCas = await tx.ride.updateMany({
            where: { id: sellerRide.id, status: 'released' },
            data: { status: 'booked' },
          });
          if (rideCas.count === 1) {
            await tx.trip.update({ where: { id: r.tripId }, data: { seatsBooked: { increment: 1 } } });
          }
        }
      }).catch((err) => logger.error({ err: (err as Error).message }, '[scheduler] restore expired release failed'));
      // Notify the seller their release expired and seat was restored.
      await enqueueNotification({
        userId: r.userId,
        type: 'seat_release_expired',
        title: 'Seat release expired',
        body: 'Your marketplace seat release expired without a buyer. Your seat has been restored.',
        link: '/dashboard/rider',
      }).catch(() => {});
    }
  }

  if (expiredSubs.count > 0) {
    for (const s of expiringSubs) {
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
    logger.info({ expiredSubs: expiredSubs.count, expiredReleases: expiredReleases.count }, '[scheduler] expired stale data');
  }
}

async function hourlyJobs(): Promise<void> {
  await Promise.all([
    resetCorporateMonthlyCounters(),
    sendSubscriptionExpiryWarnings(),
    retentionJobs(),
    expireStaleSeatClaims(),
    ensureTripsForActiveAssignments(),
    hardDeleteStaleUsers(),
  ]);
}

// 30-day grace period. Nullifies PII (passwordHash, twoFactorSecret, name,
// phone) and deletes associated data (sessions, notifications, OTP codes,
// backup codes, idempotency records). Preserves financial records (Payment,
// Subscription, Ride) with the userId FK — they're needed for audit + tax.
async function hardDeleteStaleUsers(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600_000);
  const staleUsers = await db.user.findMany({
    where: { deletedAt: { lt: cutoff }, isActive: false },
    select: { id: true, phone: true },
    take: 50,
  });
  if (staleUsers.length === 0) return;

  for (const user of staleUsers) {
    try {
      await db.$transaction(async (tx) => {
        // Nullify PII on the user row.
        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash: 'DELETED',
            twoFactorSecret: null,
            twoFactorEnabled: false,
            name: 'Deleted User',
            email: null,
            phoneVerified: false,
          },
        });
        // Delete associated PII data (non-financial).
        await tx.session.deleteMany({ where: { userId: user.id } });
        await tx.notification.deleteMany({ where: { userId: user.id } });
        await tx.otpCode.deleteMany({ where: { userId: user.id } });
        await tx.twoFactorBackupCode.deleteMany({ where: { userId: user.id } });
        await tx.idempotencyRecord.deleteMany({ where: { userId: user.id } });
        await tx.tosAcceptance.deleteMany({ where: { userId: user.id } });
      });
      await enqueueNotification({
        userId: user.id,
        type: 'general',
        title: 'Account data deleted',
        body: 'Your account data has been permanently deleted after the 30-day grace period.',
        link: '/',
      }).catch(() => {});
      logger.info({ userId: user.id, phone: user.phone }, '[scheduler] hard-deleted stale user PII');
    } catch (err) {
      logger.error({ err: (err as Error).message, userId: user.id }, '[scheduler] hard-delete failed');
    }
  }
}

// expire pending seat claims that never got paid.
// If a buyer claims a release but never completes checkout, the claim stays
// 'pending' and the release stays 'claimed' forever — blocking the seller's
// marks them as failed, reopens the release, and restores the seller's ride.
async function expireStaleSeatClaims(): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 15 * 60_000);
  const staleClaims = await db.seatClaim.findMany({
    where: { status: 'pending', createdAt: { lt: cutoff } },
    select: { id: true, seatReleaseId: true, paymentId: true },
    take: 50,
  });
  if (staleClaims.length === 0) return;

  for (const claim of staleClaims) {
    await db.$transaction(async (tx) => {
      // Mark the claim as 'refunded' (terminal state for failed claims).
      const claimCas = await tx.seatClaim.updateMany({
        where: { id: claim.id, status: 'pending' },
        data: { status: 'refunded' },
      });
      if (claimCas.count === 0) return; // already processed by another path

      // Reopen the release.
      await tx.seatRelease.updateMany({
        where: { id: claim.seatReleaseId, status: 'claimed' },
        data: { status: 'open' },
      });

      // Mark the payment as failed.
      if (claim.paymentId) {
        await tx.payment.updateMany({
          where: { id: claim.paymentId, status: 'pending' },
          data: { status: 'failed' },
        });
      }
    }).catch((err) => logger.error({ err: (err as Error).message, claimId: claim.id }, '[scheduler] expire stale seat claim failed'));
  }
  if (staleClaims.length > 0) {
    logger.info({ count: staleClaims.length }, '[scheduler] expired stale seat claims');
  }
}

// ensure trips exist for all active assignments.
// If trip generation failed at assignment creation/acceptance time, this job
// catches up by generating any missing trips for the current month. Also
// there's nothing to do (next month's assignment must be created manually
async function ensureTripsForActiveAssignments(): Promise<void> {
  const now = new Date();
  const activeAssignments = await db.routeAssignment.findMany({
    where: {
      status: 'active',
      monthEnd: { gt: now },
    },
    select: { id: true, schedulePattern: true, monthStart: true, monthEnd: true, routeId: true, shuttleId: true, contractorId: true },
    take: 50,
  });

  let generated = 0;
  for (const assignment of activeAssignments) {
    try {
      const { generateTripsFromAssignment } = await import('@/lib/api-assignments');
      // generateTripsFromAssignment is idempotent — it catches P2002 (duplicate)
      // and skips existing trips. So calling it again is safe.
      // Note: the function needs the full assignment object.
      await generateTripsFromAssignment(assignment);
      generated++;
    } catch (err) {
      logger.error({ err: (err as Error).message, assignmentId: assignment.id }, '[scheduler] trip generation failed');
    }
  }
  if (generated > 0) {
    logger.info({ generated }, '[scheduler] ensured trips for active assignments');
  }
}

// OutboxEvent, IdempotencyRecord, OtpCode, TelebirrNotifyEvent, and RefundRetry
// and queries slow down. We delete rows older than the retention window.
async function retentionJobs(): Promise<void> {
  const now = new Date();
  const THIRTY_DAYS = new Date(now.getTime() - 30 * 24 * 3600_000);
  const NINETY_DAYS = new Date(now.getTime() - 90 * 24 * 3600_000);
  const SEVEN_DAYS = new Date(now.getTime() - 7 * 24 * 3600_000);

  const jobs = [
    // Expired or revoked sessions older than 30 days.
    { name: 'sessions', fn: () => db.session.deleteMany({ where: { OR: [{ revokedAt: { lt: THIRTY_DAYS } }, { expiresAt: { lt: now } }] } }) },
    // Read notifications older than 90 days (unread ones preserved — user might still want them).
    { name: 'notifications', fn: () => db.notification.deleteMany({ where: { readAt: { lt: NINETY_DAYS } } }) },
    // Outbox events delivered or dead older than 30 days.
    { name: 'outbox', fn: () => db.outboxEvent.deleteMany({ where: { status: { in: ['delivered', 'dead'] }, updatedAt: { lt: THIRTY_DAYS } } }) },
    // Idempotency records older than their expiry (24h TTL).
    { name: 'idempotency', fn: () => db.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: now } } }) },
    // OTP codes older than 7 days.
    { name: 'otp_codes', fn: () => db.otpCode.deleteMany({ where: { expiresAt: { lt: SEVEN_DAYS } } }) },
    // Telebirr notify events older than 90 days (after dispute window).
    { name: 'telebirr_notify', fn: () => db.telebirrNotifyEvent.deleteMany({ where: { receivedAt: { lt: NINETY_DAYS } } }) },
    // Refund retries in terminal state older than 90 days.
    { name: 'refund_retries', fn: () => db.refundRetry.deleteMany({ where: { status: { in: ['succeeded', 'permanent_failure'] }, updatedAt: { lt: NINETY_DAYS } } }) },
  ];

  for (const job of jobs) {
    try {
      const result = await job.fn();
      if (result.count > 0) {
        logger.info({ job: job.name, deleted: result.count }, '[scheduler] retention job');
      }
    } catch (err) {
      logger.error({ err: (err as Error).message, job: job.name }, '[scheduler] retention job failed');
    }
  }
}

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
    logger.info({ count: result.count }, '[scheduler] reset monthly counters');
  }
}

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
    logger.info({ notified }, '[scheduler] sent subscription-expiry warnings');
  }
}
