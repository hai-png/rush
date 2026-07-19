import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and, desc } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import * as schema from '@addis/db/schema';
import { Money } from '@addis/shared';

/**
 * Integration test wiring fix:
 *
 * The services under test (settlePayment, processRefundRetries, etc.) import
 * `db` from `@addis/db` — a singleton wired to `process.env.DATABASE_URL`.
 * Without mocking, the services would query the singleton DB (likely empty
 * or non-existent in CI) while the test seeds the testcontainer DB — two
 * different databases, so the assertions would fail.
 *
 * Fix: use vi.mock('@addis/db') to replace the singleton with the testcontainer
 * drizzle instance. The mock is set up in beforeAll() after the container
 * starts. vi.doMock allows us to set the mock dynamically (the container URI
 * isn't known until startup).
 */

let container: StartedPostgreSqlContainer;
let db: ReturnType<typeof drizzle>;
// These are imported AFTER the mock is set up (via dynamic import inside tests).
let settlePayment: typeof import('./service').settlePayment;
let failPayment: typeof import('./service').failPayment;
let scheduleRefund: typeof import('./service').scheduleRefund;
let processRefundRetries: typeof import('./service').processRefundRetries;
let marketplaceService: typeof import('../marketplace/service').marketplaceService;
let transitionSubscription: typeof import('../subscription/state').transitionSubscription;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const client = postgres(container.getConnectionUri());
  db = drizzle(client, { schema });
  // Path is relative to this file's directory (packages/api/modules/payment/).
  // packages/db/migrations is 3 levels up: payment → modules → api → packages
  await migrate(db, { migrationsFolder: '../../../packages/db/migrations' });

  // Mock @addis/db so all service imports use the testcontainer db.
  vi.doMock('@addis/db', () => ({ db, schema, Db: undefined as any, DbOrTx: undefined as any }));

  // Now import the services — they'll get the mocked @addis/db.
  const serviceMod = await import('./service');
  settlePayment = serviceMod.settlePayment;
  failPayment = serviceMod.failPayment;
  scheduleRefund = serviceMod.scheduleRefund;
  processRefundRetries = serviceMod.processRefundRetries;
  const marketplaceMod = await import('../marketplace/service');
  marketplaceService = marketplaceMod.marketplaceService;
  const stateMod = await import('../subscription/state');
  transitionSubscription = stateMod.transitionSubscription;
}, 60_000);

afterAll(async () => { vi.doUnmock('@addis/db'); await container.stop(); });

function addDays(d: Date, n: number) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }

async function seedSubscription() {
  const [user] = await db.insert(schema.users).values({
    phone: `+251911${Math.random().toString(10).slice(2, 8)}`,
    name: 'Test Rider',
    passwordHash: 'hash',
    role: 'rider',
  }).returning();
  const [riderProfile] = await db.insert(schema.riderProfiles).values({ userId: user.id, homeArea: 'Bole', workArea: 'Merkato' }).returning();
  const [plan] = await db.insert(schema.subscriptionPlans).values({
    name: `Test Plan ${Date.now()}`, durationDays: 30, ridesIncluded: 10, priceETB: '500.00', description: 'Test',
  }).returning();
  const [route] = await db.insert(schema.routes).values({
    name: `Test Route ${Date.now()}`, origin: 'A', destination: 'B',
    distanceKm: 10, durationMin: 30, fare: '50.00',
    stops: [], polyline: [], originLatLng: [9, 38.7], destLatLng: [9.03, 38.75],
    morningWindow: { start: '06:30', end: '09:00' }, eveningWindow: { start: '16:30', end: '19:30' },
  }).returning();
  const [sub] = await db.insert(schema.subscriptions).values({
    riderId: riderProfile.id, planId: plan.id, routeId: route.id, status: 'pending_payment',
    startDate: new Date(), endDate: addDays(new Date(), 30),
  }).returning();
  const ref = `REF${createId()}`;
  const [payment] = await db.insert(schema.payments).values({
    riderId: riderProfile.id, subscriptionId: sub.id, amount: '500.00',
    method: 'telebirr', reference: ref, status: 'pending',
    retentionExpiresAt: addDays(new Date(), 365 * 7),
  }).returning();
  return { user, riderProfile, plan, route, sub, payment, ref };
}

describe('settlePayment', () => {
  it('transitions pending payment to completed and activates subscription', async () => {
    const { sub, payment, ref } = await seedSubscription();
    const result = await settlePayment(ref);
    expect(result).toBe(true);
    const [p] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    expect(p!.status).toBe('completed');
    const [s] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, sub.id));
    expect(s!.status).toBe('active');
  });

  it('returns false on second call (idempotent)', async () => {
    const { ref } = await seedSubscription();
    const first = await settlePayment(ref);
    expect(first).toBe(true);
    const second = await settlePayment(ref);
    expect(second).toBe(false);
  });

  it('fails payment on amount mismatch', async () => {
    const { payment, ref } = await seedSubscription();
    const result = await settlePayment(ref, Money.fromDecimal('400.00'));
    expect(result).toBe(false);
    const [p] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    expect(p!.status).toBe('failed');
  });

  it('fails payment on zero amount', async () => {
    const { payment, ref } = await seedSubscription();
    const result = await settlePayment(ref, Money.ZERO);
    expect(result).toBe(false);
    const [p] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    expect(p!.status).toBe('failed');
  });

  it('no-ops on unknown reference', async () => {
    const result = await settlePayment(`NONEXISTENT_${createId()}`);
    expect(result).toBe(false);
  });
});

describe('processRefundRetries', () => {
  it('processes a due refund retry and marks it succeeded', async () => {
    const { payment, ref } = await seedSubscription();
    await settlePayment(ref);
    const [completed] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    const refundAmount = Money.fromDecimal('50.00');
    await scheduleRefund(payment.id, refundAmount, 'test refund');
    // Bump next_attempt_at to past so it's picked up
    await db.update(schema.refundRetries).set({ nextAttemptAt: new Date(0) }).where(eq(schema.refundRetries.paymentId, payment.id));
    const result = await processRefundRetries(10);
    expect(result.processed).toBeGreaterThanOrEqual(1);
    const [retry] = await db.select().from(schema.refundRetries).where(eq(schema.refundRetries.paymentId, payment.id));
    expect(retry!.status).toBe('succeeded');
    const [p] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    expect(p!.refundAmount).toBe('50.00');
    expect(p!.status).toBe('partially_refunded');
  });

  it('accumulates refundAmount across multiple partial refunds', async () => {
    const { payment, ref } = await seedSubscription();
    await settlePayment(ref);
    await scheduleRefund(payment.id, Money.fromDecimal('30.00'), 'first partial');
    await db.update(schema.refundRetries).set({ nextAttemptAt: new Date(0) }).where(eq(schema.refundRetries.paymentId, payment.id));
    await processRefundRetries(10);
    await scheduleRefund(payment.id, Money.fromDecimal('20.00'), 'second partial');
    await db.update(schema.refundRetries).set({ nextAttemptAt: new Date(0) }).where(eq(schema.refundRetries.paymentId, payment.id));
    await processRefundRetries(10);
    const [p] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    expect(p!.refundAmount).toBe('50.00');
    expect(p!.status).toBe('partially_refunded');
  });

  it('marks payment refunded when total refund equals amount', async () => {
    const { payment, ref } = await seedSubscription();
    await settlePayment(ref);
    await scheduleRefund(payment.id, Money.fromDecimal('500.00'), 'full');
    await db.update(schema.refundRetries).set({ nextAttemptAt: new Date(0) }).where(eq(schema.refundRetries.paymentId, payment.id));
    await processRefundRetries(10);
    const [p] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    expect(p!.status).toBe('refunded');
    expect(p!.refundAmount).toBe('500.00');
  });
});

describe('marketplaceService.claim CAS guarantee', () => {
  async function seedClaimScenario() {
    const { user, riderProfile, sub, route } = await seedSubscription();
    // Activate the subscription
    const [activeSub] = await db.update(schema.subscriptions).set({ status: 'active' }).where(eq(schema.subscriptions.id, sub.id)).returning();
    const releaseDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const [release] = await db.insert(schema.seatReleases).values({
      subscriptionId: sub.id, riderId: riderProfile.id, routeId: route.id, window: 'morning',
      releaseDate, refundAmount: '50.00',
      expiresAt: addDays(new Date(), 1),
    }).returning();
    // Second rider to claim
    const [claimerUser] = await db.insert(schema.users).values({
      phone: `+251911${Math.random().toString(10).slice(2, 8)}`,
      name: 'Claimer', passwordHash: 'hash', role: 'rider',
    }).returning();
    const [claimerProfile] = await db.insert(schema.riderProfiles).values({ userId: claimerUser.id, homeArea: 'Bole', workArea: 'Merkato' }).returning();
    return { release, claimerId: claimerProfile.id, route };
  }

  it('only one concurrent claimer wins', async () => {
    const { release, claimerId } = await seedClaimScenario();
    // Simulate two concurrent claims
    const results = await Promise.allSettled([
      marketplaceService.claim(claimerId, { seatReleaseId: release.id, paymentMethod: 'telebirr' }),
      marketplaceService.claim(claimerId, { seatReleaseId: release.id, paymentMethod: 'telebirr' }),
    ]);
    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');
    expect(successes.length).toBe(1);
    expect(failures.length).toBeGreaterThanOrEqual(1);
    // Verify release is now claimed
    const [r] = await db.select().from(schema.seatReleases).where(eq(schema.seatReleases.id, release.id));
    expect(r!.status).toBe('claimed');
  });

  it('rejects expired releases', async () => {
    const { release, claimerId } = await seedClaimScenario();
    await db.update(schema.seatReleases).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.seatReleases.id, release.id));
    await expect(
      marketplaceService.claim(claimerId, { seatReleaseId: release.id, paymentMethod: 'telebirr' }),
    ).rejects.toThrow(/claimed|cancelled|expired/i);
  });

  it('rejects own release', async () => {
    const { riderProfile } = await seedSubscription();
    const releaseDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const { route } = await seedClaimScenario();
    // Create a release by riderProfile
    const sub = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.riderId, riderProfile.id)).limit(1);
    // Can't claim own release
    const [ownRelease] = await db.insert(schema.seatReleases).values({
      subscriptionId: sub[0]!.id, riderId: riderProfile.id, routeId: route.id, window: 'morning',
      releaseDate, refundAmount: '50.00', expiresAt: addDays(new Date(), 1),
    }).returning();
    await expect(
      marketplaceService.claim(riderProfile.id, { seatReleaseId: ownRelease.id, paymentMethod: 'telebirr' }),
    ).rejects.toThrow(/cannot claim your own/i);
  });
});

describe('transitionSubscription CAS race', () => {
  it('prevents double transition from concurrent calls', async () => {
    const { sub } = await seedSubscription();
    const results = await Promise.allSettled([
      transitionSubscription(db as any, sub.id, 'payment.settled'),
      transitionSubscription(db as any, sub.id, 'payment.failed'),
    ]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    const [s] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, sub.id));
    // Should be either 'active' (settled) or 'cancelled' (failed), but only one
    expect(['active', 'cancelled']).toContain(s!.status);
  });

  it('rejects invalid transition', async () => {
    const { sub } = await seedSubscription();
    await db.update(schema.subscriptions).set({ status: 'active' }).where(eq(schema.subscriptions.id, sub.id));
    await expect(
      transitionSubscription(db as any, sub.id, 'payment.settled'),
    ).rejects.toThrow(/no transition|invalid transition/i);
  });

  it('side effects are declared', async () => {
    const { sub } = await seedSubscription();
    const result = await transitionSubscription(db as any, sub.id, 'payment.settled');
    expect(result.from).toBe('pending_payment');
    expect(result.to).toBe('active');
    expect(result.sideEffects).toContain('notify.payment_received');
  });
});

describe('scheduleRefund validation', () => {
  it('rejects refund on pending payment', async () => {
    const { payment, ref } = await seedSubscription();
    await expect(
      scheduleRefund(payment.id, Money.fromDecimal('50.00'), 'test'),
    ).rejects.toThrow(/only completed payments/i);
  });

  it('rejects refund exceeding payment amount', async () => {
    const { payment, ref } = await seedSubscription();
    await settlePayment(ref);
    await expect(
      scheduleRefund(payment.id, Money.fromDecimal('999999.00'), 'too much'),
    ).rejects.toThrow(/exceed payment amount/i);
  });

  it('rejects zero amount refund', async () => {
    const { payment, ref } = await seedSubscription();
    await settlePayment(ref);
    await expect(
      scheduleRefund(payment.id, Money.ZERO, 'zero'),
    ).rejects.toThrow(/must be positive/i);
  });
});
