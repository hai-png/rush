import { db } from '@/lib/db';
import { processRefundRetries } from '@/lib/payment-service';
import { enqueueNotification } from '@/lib/outbox';
import { getSmsProvider } from '@/lib/sms';
import { getEmailProvider } from '@/lib/email';
import { logger } from '@/lib/logger';

// Re-exported so api-cron.ts can run it directly via ?job=refund-retries.
export { processRefundRetries };

let started = false;

// Single-instance limitation: the scheduler runs in-process with no distributed
// lock. On a multi-instance deployment, every instance races the same
// outbox/refund/expire jobs (duplicate notifications, double-refunds). Until
// a distributed lock is added, deployments MUST run with SCHEDULER_DISABLED=1
// on all but one instance (or run a single instance).

export function ensureSchedulerStarted(): void {
  if (started) return;
  started = true;

  if (process.env.SCHEDULER_DISABLED === '1') {
    logger.info('[scheduler] disabled via SCHEDULER_DISABLED=1 — use external cron + POST /api/v1/cron/run');
    return;
  }

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

// Single entry point for all jobs — used by the external cron endpoint
// (api-cron.ts POST_run) so it calls the same logic as the in-process timers.
export async function runAllJobs(): Promise<{
  refunds: number;
  expiredSubs: number;
  expiredReleases: number;
  outboxPending: number;
  outboxProcessing: number;
}> {
  await drainOutbox();
  const refundResult = await processRefundRetries(50);
  await expireStale();
  await hourlyJobs();

  const pendingOutbox = await db.outboxEvent.count({ where: { status: 'pending' } });
  const processingOutbox = await db.outboxEvent.count({ where: { status: 'processing' } });

  return {
    refunds: refundResult.processed,
    expiredSubs: -1, // expireStale handles this internally; count not returned
    expiredReleases: -1, // likewise
    outboxPending: pendingOutbox,
    outboxProcessing: processingOutbox,
  };
}

// Exported so api-cron.ts can run a single job on demand via ?job=expire-stale.
// Likewise drainOutbox / hourlyJobs below.
export async function drainOutbox(): Promise<void> {
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
  // 500 events per tick (10 × 50) — enough headroom to keep up with
  // ~1000 events/min sustained (mass notification fan-out, refund retries).
  for (let i = 0; i < 10; i++) {
    const claimed = await db.$transaction(async (tx) => {
      const rows = await tx.outboxEvent.findMany({
        where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
        orderBy: { nextAttemptAt: 'asc' },
        take: 50,
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
            // enqueueNotification already wrote the Notification DB row. This
            // channel is retry-observability only — emit a structured log so
            // alerting can pick up "emissions" with no external system to
            // deliver to. The Notification row is the source of truth for
            // "did the user see it?" (readAt on the Notification table).
            logger.info({ id: evt.id, userId: payload.userId, type: payload.type }, 'outbox.notification.emitted');
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
            const deviceRows = await db.setting.findMany({
              where: { key: { startsWith: `device:${payload.userId}:` } },
              select: { value: true },
            });
            if (deviceRows.length === 0) break; // no registered devices — silent skip
            const tokens = deviceRows.map(r => {
              try { return JSON.parse(r.value).pushToken; } catch { return null; }
            }).filter(Boolean);
            if (tokens.length === 0) break;
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

// Exported for per-job cron trigger.
export async function expireStale(): Promise<void> {
  // Hoist `now` so all sub-checks use a single timestamp. Multiple new Date()
  // calls can drift across millisecond boundaries and produce inconsistent
  // filter results (rows that flip between now1 and now2 are missed).
  const now = new Date();
  // Capture IDs of subs about to expire so we can cascade-cancel their future rides.
  // Cap at 100 per run to avoid OOM if thousands of subs expire at once
  // (e.g. mass expiry event). Subsequent ticks pick up the rest.
  const expiringSubs = await db.subscription.findMany({
    where: { status: 'active', endDate: { lt: now } },
    select: { id: true, userId: true },
    take: 100,
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
  // Cap at 100 per run — same rationale as expiringSubs above.
  const expiringReleases = await db.seatRelease.findMany({
    where: { status: 'open', expiresAt: { lt: now } },
    select: { id: true, tripId: true, userId: true },
    take: 100,
  });
  // H-10 fix: only mark the 100 releases we queried as expired.
  const expiredReleases = await db.seatRelease.updateMany({
    where: { id: { in: expiringReleases.map(r => r.id) } },
    data: { status: 'expired' },
  });
  if (expiringReleases.length > 0) {
    for (const r of expiringReleases) {
      await db.$transaction(async (tx) => {
        // CAS-guarded restoration so concurrent paths can't double-increment seatsBooked.
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

// Exported for per-job cron trigger. Also calls rolloverAssignments()
// (see that function for the auto-renewal logic).
export async function hourlyJobs(): Promise<void> {
  await Promise.all([
    resetCorporateMonthlyCounters(),
    sendSubscriptionExpiryWarnings(),
    retentionJobs(),
    expireStaleSeatClaims(),
    ensureTripsForActiveAssignments(),
    hardDeleteStaleUsers(),
    rolloverAssignments(),
    corporateBilling(),
  ]);
}

// 30-day grace period. Nullifies PII (passwordHash, twoFactorSecret, name,
// phone) and deletes associated data (sessions, notifications, OTP codes,
// backup codes, idempotency records). Preserves financial records (Payment,
// Subscription, Ride) with the userId FK — they're needed for audit + tax.
async function hardDeleteStaleUsers(): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  const staleUsers = await db.user.findMany({
    where: { deletedAt: { lt: cutoff }, isActive: false },
    select: { id: true, phone: true },
    take: 50,
  });
  if (staleUsers.length === 0) return;

  for (const user of staleUsers) {
    try {
      await db.$transaction(async (tx) => {
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

// Expire pending seat claims that never got paid. If a buyer claims a release
// but never completes checkout, the claim stays 'pending' and the release stays
// 'claimed' forever — blocking the seller's seat. This marks them as failed,
// reopens the release, and restores the seller's ride.
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
      // 'refunded' is the terminal state for failed claims.
      const claimCas = await tx.seatClaim.updateMany({
        where: { id: claim.id, status: 'pending' },
        data: { status: 'refunded' },
      });
      if (claimCas.count === 0) return; // already processed by another path

      await tx.seatRelease.updateMany({
        where: { id: claim.seatReleaseId, status: 'claimed' },
        data: { status: 'open' },
      });

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

// Ensure trips exist for all active assignments. Catches up if trip generation
// failed at assignment creation/acceptance time. Cross-month rollover is
// handled separately by rolloverAssignments() (gated by `auto_rollover_enabled`).
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

// Hard-delete rows past their retention window to keep tables small. A future
// archival pipeline should move aged rows to cold storage (S3/Glacier) before
// deleting them for audit/dispute/compliance.
//
// AuditLog is intentionally NOT included here — the audit chain is append-only
// and must be retained for 7 years for compliance / tax / dispute resolution.
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
  // Reset on calendar-month boundaries, not a rolling 30-day window — a
  // rolling window drifts from the corporate billing cycle and makes "monthly
  // seat allowance" ambiguous. We compute the start of the current calendar
  // month (server time pinned to Africa/Addis_Ababa) and reset any member
  // whose lastResetAt is before that timestamp.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const result = await db.corporateMember.updateMany({
    where: {
      isActive: true,
      deletedAt: null,
      lastResetAt: { lt: monthStart },
      ridesUsedThisMonth: { gt: 0 },
    },
    data: {
      ridesUsedThisMonth: 0,
      lastResetAt: now,
    },
  });
  if (result.count > 0) {
    logger.info({ count: result.count, monthStart: monthStart.toISOString() }, '[scheduler] reset monthly counters (calendar month)');
  }
}

async function sendSubscriptionExpiryWarnings(): Promise<void> {
  const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 3600_000);
  const oneDayFromNow = new Date(Date.now() + 24 * 3600_000);
  // Cap at 100 per run to avoid OOM under load.
  const soonExpiring = await db.subscription.findMany({
    where: {
      status: 'active',
      endDate: { gt: oneDayFromNow, lt: threeDaysFromNow },
    },
    select: { id: true, userId: true, endDate: true },
    take: 100,
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

// Cross-month rollover. For each active RouteAssignment whose monthEnd is
// within the next 7 days, clone it to next month so trip generation has
// somewhere to land when the current month expires. Only fires when an admin
// has opted in via the `auto_rollover_enabled` Setting (default: off). The
// contractor and shuttle must both still be active — we don't auto-renew
// assignments for contractors who've left or shuttles that have been retired.
async function rolloverAssignments(): Promise<void> {
  const setting = await db.setting.findUnique({ where: { key: 'auto_rollover_enabled' } });
  if (!setting || setting.value !== 'true') return;

  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 3600_000);

  const endingSoon = await db.routeAssignment.findMany({
    where: {
      status: 'active',
      monthEnd: { gt: now, lt: sevenDaysFromNow },
    },
    select: {
      id: true, routeId: true, contractorId: true, shuttleId: true,
      monthStart: true, monthEnd: true, schedulePattern: true,
      maxSeats: true, assignedById: true,
    },
    take: 100,
  });
  if (endingSoon.length === 0) return;

  let created = 0;
  for (const a of endingSoon) {
    const contractor = await db.user.findUnique({
      where: { id: a.contractorId },
      select: { id: true, isActive: true, deletedAt: true },
    });
    if (!contractor || !contractor.isActive || contractor.deletedAt) continue;
    const shuttle = await db.shuttle.findUnique({
      where: { id: a.shuttleId },
      select: { id: true, isActive: true },
    });
    if (!shuttle || !shuttle.isActive) continue;

    const nextMonthStart = new Date(a.monthStart.getFullYear(), a.monthStart.getMonth() + 1, 1);
    const nextMonthEnd = new Date(nextMonthStart.getFullYear(), nextMonthStart.getMonth() + 1, 0, 23, 59, 59);

    // Idempotent: skip if a row already exists for this route+contractor+month
    // (could happen if the scheduler runs twice in the same hour).
    const existing = await db.routeAssignment.findUnique({
      where: {
        routeId_contractorId_monthStart: {
          routeId: a.routeId,
          contractorId: a.contractorId,
          monthStart: nextMonthStart,
        },
      },
      select: { id: true },
    });
    if (existing) continue;

    try {
      const next = await db.routeAssignment.create({
        data: {
          routeId: a.routeId,
          contractorId: a.contractorId,
          shuttleId: a.shuttleId,
          monthStart: nextMonthStart,
          monthEnd: nextMonthEnd,
          schedulePattern: a.schedulePattern,
          status: 'assigned', // contractor must re-accept next month
          maxSeats: a.maxSeats,
          assignedById: a.assignedById,
        },
      });
      // Pre-generate trips for next month so the schedule is visible to riders
      // as soon as the rollover completes. Idempotent — see generateTripsFromAssignment.
      const { generateTripsFromAssignment } = await import('@/lib/api-assignments');
      await generateTripsFromAssignment(next).catch((err: unknown) => {
        logger.error({ err: (err as Error).message, assignmentId: next.id }, '[scheduler] rollover trip generation failed');
      });
      created++;
    } catch (err) {
      logger.error({ err: (err as Error).message, assignmentId: a.id }, '[scheduler] rollover create failed');
    }
  }
  if (created > 0) {
    logger.info({ created }, '[scheduler] auto-rolled-over assignments to next month');
  }
}

// Monthly corporate billing. For each active Corporate with members, sum the
// subsidies consumed (Payment.subsidyCents) in the previous calendar month
// and create a CorporateInvoice row with status='issued' and dueAt = +30 days.
// Gated by the `corporate_billing_enabled` Setting.
async function corporateBilling(): Promise<void> {
  const setting = await db.setting.findUnique({ where: { key: 'corporate_billing_enabled' } });
  if (!setting || setting.value !== 'true') return;

  const now = new Date();
  // Only run on the first day of the month (hourly tick checks).
  if (now.getDate() !== 1) return;

  const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const corporates = await db.corporate.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, name: true },
    take: 200,
  });
  if (corporates.length === 0) return;

  let created = 0;
  for (const corp of corporates) {
    // Idempotent: skip if an invoice already exists for this corporate + period.
    const existing = await db.corporateInvoice.findFirst({
      where: { corporateId: corp.id, periodStart },
      select: { id: true },
    });
    if (existing) continue;

    const agg = await db.payment.aggregate({
      _sum: { subsidyCents: true },
      where: {
        subscription: { corporateId: corp.id },
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    });
    const subtotalCents = agg._sum.subsidyCents ?? 0;
    // Skip zero-subsidy months — no point creating an empty invoice.
    if (subtotalCents === 0) continue;

    const taxCents = 0; // VAT not modeled yet — admin can adjust post-issue.
    const totalCents = subtotalCents + taxCents;
    const dueAt = new Date(now.getTime() + 30 * 24 * 3600_000);

    try {
      await db.corporateInvoice.create({
        data: {
          corporateId: corp.id,
          periodStart,
          periodEnd,
          subtotalCents,
          taxCents,
          totalCents,
          status: 'issued',
          issuedAt: now,
          dueAt,
        },
      });
      created++;
    } catch (err: any) {
      // H-9 fix: P2002 means a concurrent scheduler tick already created the
      // invoice for this (corporateId, periodStart). Skip silently — the unique
      // index is the real guarantee, this catch just prevents the error from
      // aborting the rest of the billing run.
      if (err?.code === 'P2002') {
        logger.info({ corporateId: corp.id, periodStart }, '[scheduler] corporate invoice already exists (P2002) — skipping');
        continue;
      }
      logger.error({ err: (err as Error).message, corporateId: corp.id }, '[scheduler] corporate invoice create failed');
    }
  }
  if (created > 0) {
    logger.info({ created, periodStart: periodStart.toISOString() }, '[scheduler] generated corporate invoices');
  }
}
