import { and, eq, sql, inArray } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { NotFoundError, ConflictError, BadRequestError, ForbiddenError } from '@addis/shared';
import { subscriptionRepo } from '../subscription/repository';

const MIN_GPS_MOVE_METERS = 5;
function haversineMeters(a: [number, number], b: [number, number]) {
  const R = 6371000, toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const operationsService = {
  async startTrip(contractorId: string, input: { shuttleId: string; routeId: string; window: 'morning' | 'evening'; departTime: Date }) {
    const [shuttle] = await db.select().from(schema.shuttles).where(eq(schema.shuttles.id, input.shuttleId));
    if (!shuttle || shuttle.contractorId !== contractorId) throw new NotFoundError('Shuttle not found');

    if (!shuttle.isActive) throw new BadRequestError('Shuttle is not active');
    if (input.departTime.getTime() < Date.now() - 60_000) throw new BadRequestError('departTime must be in the future');
    const [existing] = await db.select().from(schema.trips)
      .where(and(eq(schema.trips.shuttleId, input.shuttleId), eq(schema.trips.status, 'in_transit'))).limit(1);
    if (existing) throw new ConflictError('Shuttle already has an in-transit trip');

    const [trip] = await db.insert(schema.trips).values({ ...input, contractorId, status: 'in_transit' }).returning();
    return trip;
  },

  async completeTrip(contractorId: string, tripId: string) {
    return db.transaction(async (tx) => {

      const [trip] = await tx.update(schema.trips)
        .set({ status: 'completed', arriveTime: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.trips.id, tripId), eq(schema.trips.contractorId, contractorId), eq(schema.trips.status, 'in_transit')))
        .returning();
      if (!trip) throw new ConflictError('Trip not in a completable state');

      const boarded = await tx.update(schema.rides)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(and(eq(schema.rides.tripId, tripId), eq(schema.rides.status, 'boarded')))
        .returning({ id: schema.rides.id, subscriptionId: schema.rides.subscriptionId, seatClaimId: schema.rides.seatClaimId, riderId: schema.rides.riderId });

      await tx.update(schema.rides)
        .set({ status: 'no_show', updatedAt: new Date() })
        .where(and(eq(schema.rides.tripId, tripId), eq(schema.rides.status, 'booked')));

      const seatClaimIds = boarded.map(r => r.seatClaimId).filter((id): id is string => id != null);
      if (seatClaimIds.length > 0) {
        await tx.update(schema.seatClaims)
          .set({ status: 'used', updatedAt: new Date() })
          .where(and(inArray(schema.seatClaims.id, seatClaimIds), eq(schema.seatClaims.status, 'confirmed')));
      }
      const subIds = [...new Set(boarded.map(r => r.subscriptionId).filter((id): id is string => id != null))];
      if (subIds.length > 0) {
        const subs = await tx.select().from(schema.subscriptions)
          .where(and(inArray(schema.subscriptions.id, subIds), eq(schema.subscriptions.status, 'active')));
        const planIds = [...new Set(subs.map(s => s.planId))];
        const plans = planIds.length > 0
          ? await tx.select().from(schema.subscriptionPlans).where(inArray(schema.subscriptionPlans.id, planIds))
          : [];
        const planById = new Map(plans.map(p => [p.id, p]));
        for (const sub of subs) {
          const plan = planById.get(sub.planId);
          if (plan && (plan.ridesIncluded === -1 || sub.ridesUsed < plan.ridesIncluded)) {
            await subscriptionRepo.incrementRidesUsed(tx as any, sub.id);
          }
        }
      }
      await tx.insert(schema.outboxEvents).values({ channel: 'audit', payload: { action: 'trip.completed', entityId: tripId } });
      return trip;
    });
  },

  async bookRide(riderId: string, input: { tripId: string; subscriptionId?: string | undefined; seatClaimId?: string | undefined; pickupStop?: string | undefined }) {
    if (!input.subscriptionId && !input.seatClaimId) {
      throw new BadRequestError('A subscriptionId or seatClaimId is required to book a ride');
    }
    const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId));

    if (!trip || (trip.status !== 'scheduled' && trip.status !== 'in_transit')) {
      throw new BadRequestError('Trip not open for booking');
    }
    const [shuttle] = await db.select().from(schema.shuttles).where(eq(schema.shuttles.id, trip.shuttleId));

    if (input.subscriptionId) {
      const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, input.subscriptionId));
      if (!sub || sub.riderId !== riderId) throw new ForbiddenError('Subscription does not belong to this rider');
      if (sub.status !== 'active') throw new BadRequestError('Subscription is not active');
      const [plan] = await db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.id, sub.planId));
      if (plan && plan.ridesIncluded !== -1 && sub.ridesUsed >= plan.ridesIncluded) {
        throw new BadRequestError('Subscription ride quota exhausted');
      }
    }
    if (input.seatClaimId) {
      const [claim] = await db.select().from(schema.seatClaims).where(eq(schema.seatClaims.id, input.seatClaimId));
      if (!claim || claim.riderId !== riderId) throw new ForbiddenError('Seat claim does not belong to this rider');
      if (claim.status !== 'confirmed') throw new BadRequestError('Seat claim is not confirmed');
    }

    try {
      return await db.transaction(async (tx) => {
        const capacity = shuttle?.capacity ?? 0;
        const updated = await tx.update(schema.trips)
          .set({ seatsBooked: sql`${schema.trips.seatsBooked} + 1`, updatedAt: new Date() })
          .where(and(
            eq(schema.trips.id, trip.id),
            inArray(schema.trips.status, ['scheduled', 'in_transit']),
            sql`${schema.trips.seatsBooked} < ${capacity}`,
          ))
          .returning();
        if (updated.length === 0) throw new ConflictError('Trip is full');
        const [ride] = await tx.insert(schema.rides).values({ riderId, ...input, status: 'booked' }).returning();
        return ride;
      });
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictError('Already booked on this trip');
      throw e;
    }
  },

  async board(riderId: string, rideId: string) {
    const [ride] = await db.update(schema.rides)
      .set({ status: 'boarded', updatedAt: new Date() })
      .where(and(
        eq(schema.rides.id, rideId),
        eq(schema.rides.riderId, riderId),
        eq(schema.rides.status, 'booked'),

        sql`EXISTS (SELECT 1 FROM ${schema.trips} WHERE ${schema.trips.id} = ${schema.rides.tripId} AND ${schema.trips.status} = 'in_transit')`,
      ))
      .returning();
    if (!ride) throw new ConflictError('Ride cannot be boarded in its current state');
    return ride;
  },

  async reportPosition(shuttleId: string, pos: { lat: number; lng: number; heading?: number | undefined; speed?: number | undefined }) {

    if (!Number.isFinite(pos.lat) || pos.lat < -90 || pos.lat > 90) throw new BadRequestError('lat must be in [-90, 90]');
    if (!Number.isFinite(pos.lng) || pos.lng < -180 || pos.lng > 180) throw new BadRequestError('lng must be in [-180, 180]');

    const [existing] = await db.select().from(schema.shuttlePositions).where(eq(schema.shuttlePositions.shuttleId, shuttleId));
    if (existing && haversineMeters([existing.lat, existing.lng], [pos.lat, pos.lng]) < MIN_GPS_MOVE_METERS) {
      return existing;
    }
    const [row] = await db.insert(schema.shuttlePositions)
      .values({ shuttleId, ...pos, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.shuttlePositions.shuttleId, set: { ...pos, updatedAt: new Date() } })
      .returning();
    return row!;
  },
};
