import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'bun:test';
import { PrismaClient, Prisma } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'db/race-test.db');
process.env.DATABASE_URL = `file:${TEST_DB}`;
process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'race-test-auth-secret-32-chars-minimum-length';
process.env.CRON_SECRET = process.env.CRON_SECRET || 'race-test-cron-secret-32-chars-minimum';
process.env.NODE_ENV = 'development';

const db = new PrismaClient();

const TIMEOUT = 30000;

beforeAll(async () => {
  spawnSync('bunx', ['prisma', 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'], {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
    stdio: 'pipe',
  }, TIMEOUT);
}, TIMEOUT);

afterAll(async () => {
  await db.$disconnect();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try { rmSync(`${TEST_DB}${suffix}`); } catch {}
  }
}, TIMEOUT);

beforeEach(async () => {
  // Disable FK enforcement during cleanup so order doesn't matter.
  await db.$executeRawUnsafe('PRAGMA foreign_keys=OFF');
  const tables = [
    'ride', 'seatClaim', 'seatRelease', 'refundRetry', 'telebirrNotifyEvent',
    'payment', 'subscription', 'notification', 'outboxEvent', 'supportTicket',
    'ticketMessage', 'session', 'idempotencyRecord', 'auditLog',
    'corporateInvite', 'corporateMember', 'corporate', 'contractorDocument',
    'uploadedFile', 'trip', 'routeAssignment', 'pickupLocation', 'shuttle',
    'route', 'subscriptionPlan', 'faqArticle', 'otpCode', 'tosAcceptance',
    'contractorProfile', 'riderProfile', 'user',
  ];
  for (const t of tables) {
    try { await (db as any)[t].deleteMany({}); } catch {}
  }
  await db.$executeRawUnsafe('PRAGMA foreign_keys=ON');
}, TIMEOUT);

async function createPlan(opts: { id?: string; ridesIncluded?: number; isTrial?: boolean; priceCents?: number } = {}) {
  return db.subscriptionPlan.create({
    data: {
      id: opts.id ?? 'plan-test',
      slug: opts.isTrial ? 'trial-test' : `plan-${Date.now()}`,
      name: 'Test Plan',
      description: 'test',
      priceCents: opts.priceCents ?? 150000,
      ridesIncluded: opts.ridesIncluded ?? 30,
      durationDays: 30,
      isTrial: opts.isTrial ?? false,
      isActive: true,
      sortOrder: 0,
    },
  }, TIMEOUT);
}

async function createRoute() {
  return db.route.create({
    data: { origin: 'Bole', destination: 'Merkato', distanceKm: 10, durationMin: 60, fareCents: 500, isActive: true },
  }, TIMEOUT);
}

async function createShuttle(contractorId: string, capacity = 30) {
  return db.shuttle.create({
    data: { contractorId, plate: `AA-${Date.now()}`, model: 'Coaster', vehicleType: 'coaster', capacity, year: 2020, isActive: true },
  }, TIMEOUT);
}

async function createTrip(routeId: string, shuttleId: string, opts: { departureAt?: Date; capacity?: number } = {}) {
  const shuttle = await db.shuttle.findUnique({ where: { id: shuttleId } });
  return db.trip.create({
    data: {
      routeId,
      shuttleId,
      driverId: shuttle?.contractorId,
      departureAt: opts.departureAt ?? new Date(Date.now() + 24 * 3600_000),
      window: 'morning',
      status: 'scheduled',
    },
  }, TIMEOUT);
}

async function createUser(role: string = 'rider') {
  return db.user.create({
    data: {
      phone: `+251922${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`,
      passwordHash: '$2a$12$dummy',
      name: 'Test User',
      role,
      phoneVerified: true,
      tosVersion: '2026-01-01',
    },
  }, TIMEOUT);
}

async function createActiveSubscription(userId: string, planId: string, opts: { ridesUsed?: number; corporateId?: string } = {}) {
  const now = new Date();
  return db.subscription.create({
    data: {
      userId,
      planId,
      corporateId: opts.corporateId,
      status: 'active',
      startDate: now,
      endDate: new Date(now.getTime() + 30 * 24 * 3600_000),
      ridesUsed: opts.ridesUsed ?? 0,
    },
  }, TIMEOUT);
}

describe('P0-1: double-book prevention', () => {
  it('rejects a second booked ride for the same user on the same trip', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const route = await createRoute();
    const shuttle = await createShuttle(user.id);
    const trip = await createTrip(route.id, shuttle.id);
    const sub = await createActiveSubscription(user.id, plan.id);

    const { POST_ride } = await import('../src/lib/api-operations');

    const ctx = { session: { id: user.id, role: 'rider' }, ipAddress: '127.0.0.1', userAgent: 'test' };

    const r1 = await POST_ride({ ...ctx, body: { tripId: trip.id, subscriptionId: sub.id } });
    expect(r1.status).toBe(201);
    expect(r1.data.status).toBe('booked');

    let secondError: any;
    try {
      await POST_ride({ ...ctx, body: { tripId: trip.id, subscriptionId: sub.id } });
    } catch (e) {
      secondError = e;
    }
    expect(secondError).toBeDefined();
    expect(secondError.message).toContain('already have a booked ride');

    const rides = await db.ride.findMany({ where: { tripId: trip.id, userId: user.id } });
    expect(rides.length).toBe(1);

    const freshSub = await db.subscription.findUnique({ where: { id: sub.id } });
    expect(freshSub?.ridesUsed).toBe(1);

    const freshTrip = await db.trip.findUnique({ where: { id: trip.id } });
    expect(freshTrip?.seatsBooked).toBe(1);
  }, TIMEOUT);

  it('handles parallel booking attempts — only one succeeds, the other is rejected', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const route = await createRoute();
    const shuttle = await createShuttle(user.id);
    const trip = await createTrip(route.id, shuttle.id);
    const sub = await createActiveSubscription(user.id, plan.id);

    const { POST_ride } = await import('../src/lib/api-operations');
    const ctx = { session: { id: user.id, role: 'rider' }, ipAddress: '127.0.0.1', userAgent: 'test' };
    const body = { tripId: trip.id, subscriptionId: sub.id };

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => POST_ride({ ...ctx, body })),
    );

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(4);

    const rides = await db.ride.findMany({ where: { tripId: trip.id, userId: user.id } });
    expect(rides.length).toBe(1);

    const freshSub = await db.subscription.findUnique({ where: { id: sub.id } });
    expect(freshSub?.ridesUsed).toBe(1);

    const freshTrip = await db.trip.findUnique({ where: { id: trip.id } });
    expect(freshTrip?.seatsBooked).toBe(1);
  }, TIMEOUT);
});

describe('P0-19: corporate seat allowance enforcement', () => {
  it('enforces the monthly seat allowance via CAS on ridesUsedThisMonth', async () => {
    const admin = await createUser('corporate_admin');
    const corp = await db.corporate.create({
      data: {
        code: 'CORP-TEST',
        name: 'Test Corp',
        contactEmail: 'admin@test.et',
        contactPhone: '+251911000099',
        subsidyPercent: 50,
        monthlySeatAllowance: 3,
        adminUserId: admin.id,
        isActive: true,
      },
    });

    const rider = await createUser('rider');
    const member = await db.corporateMember.create({
      data: {
        corporateId: corp.id,
        userId: rider.id,
        employeeId: 'EMP-1',
        approvalStatus: 'approved',
        isActive: true,
        ridesUsedThisMonth: 0,
      },
    });

    const plan = await createPlan();
    const route = await createRoute();
    const shuttle = await createShuttle(admin.id);
    const trip = await createTrip(route.id, shuttle.id);
    const sub = await createActiveSubscription(rider.id, plan.id, { corporateId: corp.id });

    const { POST_ride } = await import('../src/lib/api-operations');
    const ctx = { session: { id: rider.id, role: 'rider' }, ipAddress: '127.0.0.1', userAgent: 'test' };

    for (let i = 0; i < 3; i++) {
      const t = await createTrip(route.id, shuttle.id, { departureAt: new Date(Date.now() + (i + 2) * 24 * 3600_000) });
      const r = await POST_ride({ ...ctx, body: { tripId: t.id, subscriptionId: sub.id } });
      expect(r.status).toBe(201);
    }

    const trip4 = await createTrip(route.id, shuttle.id, { departureAt: new Date(Date.now() + 5 * 24 * 3600_000) });
    let err: any;
    try {
      await POST_ride({ ...ctx, body: { tripId: trip4.id, subscriptionId: sub.id } });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.message).toContain('Corporate monthly seat allowance');

    const freshMember = await db.corporateMember.findUnique({ where: { id: member.id } });
    expect(freshMember?.ridesUsedThisMonth).toBe(3);
  }, TIMEOUT);
});

describe('P1-25: refund double-count prevention', () => {
  it('prevents two concurrent partial refunds from exceeding the original amount', async () => {
    const user = await createUser();
    const payment = await db.payment.create({
      data: {
        reference: `POTEST-${Date.now()}`,
        userId: user.id,
        method: 'telebirr',
        amountCents: 150000, // 1500 ETB
        status: 'completed',
      },
    });

    const { scheduleRefund } = await import('../src/lib/payment-service');
    const { Money } = await import('../src/lib/money');

    const results = await Promise.allSettled([
      scheduleRefund(payment.id, Money.fromETB(1000), 'refund 1'),
      scheduleRefund(payment.id, Money.fromETB(1000), 'refund 2'),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const freshPayment = await db.payment.findUnique({ where: { id: payment.id } });
    expect(freshPayment?.refundAmountCents).toBe(100000);
    expect(freshPayment?.status).toBe('partially_refunded');

    const retries = await db.refundRetry.findMany({ where: { paymentId: payment.id } });
    expect(retries.length).toBe(1);
  }, TIMEOUT);
});

describe('P0-1 + P0-6: ride cancel restores seat', () => {
  it('cancelling a booked ride decrements trip.seatsBooked', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const route = await createRoute();
    const shuttle = await createShuttle(user.id);
    const trip = await createTrip(route.id, shuttle.id);
    const sub = await createActiveSubscription(user.id, plan.id);

    const { POST_ride, PATCH_ride } = await import('../src/lib/api-operations');
    const ctx = { session: { id: user.id, role: 'rider' }, ipAddress: '127.0.0.1', userAgent: 'test' };

    const r = await POST_ride({ ...ctx, body: { tripId: trip.id, subscriptionId: sub.id } });
    const rideId = r.data.id;

    let t = await db.trip.findUnique({ where: { id: trip.id } });
    expect(t?.seatsBooked).toBe(1);

    await PATCH_ride({ ...ctx, params: { id: rideId }, body: { status: 'cancelled' } });

    t = await db.trip.findUnique({ where: { id: trip.id } });
    expect(t?.seatsBooked).toBe(0);

    const freshSub = await db.subscription.findUnique({ where: { id: sub.id } });
    expect(freshSub?.ridesUsed).toBe(0);
  }, TIMEOUT);
});

describe('P1-29: ride state machine', () => {
  it('rejects illegal transitions (e.g. completed → booked)', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const route = await createRoute();
    const shuttle = await createShuttle(user.id);
    const trip = await createTrip(route.id, shuttle.id);
    const sub = await createActiveSubscription(user.id, plan.id);

    const { POST_ride, PATCH_ride } = await import('../src/lib/api-operations');
    const ctx = { session: { id: user.id, role: 'rider' }, ipAddress: '127.0.0.1', userAgent: 'test' };

    const r = await POST_ride({ ...ctx, body: { tripId: trip.id, subscriptionId: sub.id } });
    const rideId = r.data.id;

    await PATCH_ride({ ...ctx, params: { id: rideId }, body: { status: 'cancelled' } });

    let err: any;
    try {
      await PATCH_ride({ ...ctx, params: { id: rideId }, body: { status: 'booked' } });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.message).toContain('Illegal ride status transition');
  }, TIMEOUT);

  it('rejects rider setting status to completed (only driver/admin can)', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const route = await createRoute();
    const shuttle = await createShuttle(user.id);
    const trip = await createTrip(route.id, shuttle.id);
    const sub = await createActiveSubscription(user.id, plan.id);

    const { POST_ride, PATCH_ride } = await import('../src/lib/api-operations');
    const ctx = { session: { id: user.id, role: 'rider' }, ipAddress: '127.0.0.1', userAgent: 'test' };

    const r = await POST_ride({ ...ctx, body: { tripId: trip.id, subscriptionId: sub.id } });
    const rideId = r.data.id;

    // Rider tries to mark their own ride as 'completed' — should be rejected.
    // Either error is acceptable — the point is the rider can't self-complete.
    let err: any;
    try {
      await PATCH_ride({ ...ctx, params: { id: rideId }, body: { status: 'completed' } });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(
      err.message.includes('Illegal ride status transition') ||
      err.message.includes('Riders can only cancel')
    ).toBe(true);
  }, TIMEOUT);
});

describe('P0-5: trip board transactional + departure check', () => {
  it('rejects boarding a trip more than 30 minutes before departure', async () => {
    const user = await createUser('contractor');
    const route = await createRoute();
    const shuttle = await createShuttle(user.id);
    const trip = await createTrip(route.id, shuttle.id, { departureAt: new Date(Date.now() + 2 * 3600_000) });

    const { POST_board } = await import('../src/lib/api-operations');
    const ctx = { session: { id: user.id, role: 'contractor' }, ipAddress: '127.0.0.1', userAgent: 'test' };

    let err: any;
    try {
      await POST_board({ ...ctx, params: { id: trip.id } });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.message).toContain('Too early to board');

    const t = await db.trip.findUnique({ where: { id: trip.id } });
    expect(t?.status).toBe('scheduled');
  }, TIMEOUT);
});

describe('P0-3: subscription cancel cascades to rides', () => {
  it('cancelling a subscription cancels future booked rides and restores seats', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const route = await createRoute();
    const shuttle = await createShuttle(user.id);
    const trip1 = await createTrip(route.id, shuttle.id, { departureAt: new Date(Date.now() + 24 * 3600_000) });
    const trip2 = await createTrip(route.id, shuttle.id, { departureAt: new Date(Date.now() + 48 * 3600_000) });
    const sub = await createActiveSubscription(user.id, plan.id);

    const { POST_ride } = await import('../src/lib/api-operations');
    const { POST_cancel } = await import('../src/lib/api-subscriptions');
    const ctx = { session: { id: user.id, role: 'rider' }, ipAddress: '127.0.0.1', userAgent: 'test' };

    await POST_ride({ ...ctx, body: { tripId: trip1.id, subscriptionId: sub.id } });
    await POST_ride({ ...ctx, body: { tripId: trip2.id, subscriptionId: sub.id } });

    expect((await db.trip.findUnique({ where: { id: trip1.id } }))?.seatsBooked).toBe(1);
    expect((await db.trip.findUnique({ where: { id: trip2.id } }))?.seatsBooked).toBe(1);

    const result = await POST_cancel({ ...ctx, params: { id: sub.id } });
    expect(result.data.status).toBe('cancelled');
    expect(result.data.cancelledRides).toBe(2);

    const rides = await db.ride.findMany({ where: { subscriptionId: sub.id } });
    expect(rides.length).toBe(2);
    expect(rides.every(r => r.status === 'cancelled')).toBe(true);

    expect((await db.trip.findUnique({ where: { id: trip1.id } }))?.seatsBooked).toBe(0);
    expect((await db.trip.findUnique({ where: { id: trip2.id } }))?.seatsBooked).toBe(0);
  }, TIMEOUT);
});
