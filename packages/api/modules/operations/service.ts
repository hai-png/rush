import { and, eq, sql } from 'drizzle-orm';
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
    // New safety checks the previous implementation skipped:
    //   1. Shuttle must be active (a deactivated shuttle shouldn't run trips).
    //   2. departTime must be in the future (no back-dating trips).
    //   3. No existing in_transit trip for the same shuttle (no double-driving).
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
      // CAS update: only complete a trip that is currently in_transit.
      // The previous implementation had this guard, but only for the
      // contractorId match — it didn't enforce ridesUsed increment only
      // on active subscriptions.
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

      for (const r of boarded) {
        // Only increment ridesUsed if the subscription is still active and
        // (for limited plans) hasn't exceeded its ride quota. The previous
        // implementation called incrementRidesUsed unconditionally — a rider
        // whose subscription expired mid-trip still got ridesUsed bumped,
        // and a rider could exceed their plan's ridesIncluded silently.
        if (r.subscriptionId) {
          const [sub] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, r.subscriptionId));
          if (sub && sub.status === 'active') {
            const [plan] = await tx.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.id, sub.planId));
            // plan.ridesIncluded === -1 means unlimited
            if (plan && (plan.ridesIncluded === -1 || sub.ridesUsed < plan.ridesIncluded)) {
              await subscriptionRepo.incrementRidesUsed(tx, r.subscriptionId);
            }
          }
        }
        if (r.seatClaimId) await tx.update(schema.seatClaims).set({ status: 'used', updatedAt: new Date() }).where(eq(schema.seatClaims.id, r.seatClaimId));
      }
      await tx.insert(schema.outboxEvents).values({ channel: 'audit', payload: { action: 'trip.completed', entityId: tripId } });
      return trip;
    });
  },

  /**
   * Book a ride on a scheduled trip.
   *
   * The previous implementation had multiple IDOR / race-condition bugs:
   *   1. No ownership check on subscriptionId/seatClaimId — a rider could
   *      pass another rider's IDs and exhaust their subscription or
   *      consume their seat claim.
   *   2. No capacity check — `seatsBooked = trip.seatsBooked + 1` was a
   *      non-atomic read-then-write (race) AND had no comparison to
   *      shuttle.capacity (overbooking silently allowed).
   *   3. Allowed booking with NEITHER subscriptionId NOR seatClaimId —
   *      a free ride.
   *   4. `riderId` was passed through raw — same FK mismatch as elsewhere.
   * Now: ownership is verified, capacity is enforced atomically, and at
   * least one entitlement is required.
   */
  async bookRide(riderId: string, input: { tripId: string; subscriptionId?: string; seatClaimId?: string; pickupStop?: string }) {
    if (!input.subscriptionId && !input.seatClaimId) {
      throw new BadRequestError('A subscriptionId or seatClaimId is required to book a ride');
    }
    const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId));
    if (!trip || trip.status !== 'scheduled') throw new BadRequestError('Trip not open for booking');
    const [shuttle] = await db.select().from(schema.shuttles).where(eq(schema.shuttles.id, trip.shuttleId));

    // Verify ownership of subscriptionId and seatClaimId.
    if (input.subscriptionId) {
      const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, input.subscriptionId));
      if (!sub || sub.riderId !== riderId) throw new ForbiddenError('Subscription does not belong to this rider');
      if (sub.status !== 'active') throw new BadRequestError('Subscription is not active');
      // Enforce ride quota at booking time too, not just at completion.
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
      // Atomic capacity check + increment. The CAS update only succeeds if
      // the current seatsBooked is still under capacity — concurrent
      // bookers race-safely: only N<=capacity of them win.
      const capacity = shuttle?.capacity ?? 0;
      const updated = await db.update(schema.trips)
        .set({ seatsBooked: sql`${schema.trips.seatsBooked} + 1`, updatedAt: new Date() })
        .where(and(
          eq(schema.trips.id, trip.id),
          eq(schema.trips.status, 'scheduled'),
          sql`${schema.trips.seatsBooked} < ${capacity}`,
        ))
        .returning();
      if (updated.length === 0) {
        throw new ConflictError('Trip is full');
      }
      const [ride] = await db.insert(schema.rides).values({ riderId, ...input, status: 'booked' }).returning();
      return ride;
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictError('Already booked on this trip');
      throw e;
    }
  },

  /**
   * Board a ride. The previous CAS update only checked the RIDE's status
   * ('booked'); it didn't check the TRIP's status. A rider could board a
   * ride for a trip that was 'scheduled' (not started) or 'completed'/
   * 'cancelled'. Now we also require the trip to be 'in_transit'.
   */
  async board(riderId: string, rideId: string) {
    const [ride] = await db.update(schema.rides)
      .set({ status: 'boarded', updatedAt: new Date() })
      .where(and(eq(schema.rides.id, rideId), eq(schema.rides.riderId, riderId), eq(schema.rides.status, 'booked')))
      .returning();
    if (!ride) throw new ConflictError('Ride cannot be boarded in its current state');
    // Verify the trip is in_transit.
    const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, ride.tripId));
    if (!trip || trip.status !== 'in_transit') {
      // Revert the boarding — the trip isn't active.
      await db.update(schema.rides).set({ status: 'booked', updatedAt: new Date() }).where(eq(schema.rides.id, rideId));
      throw new ConflictError('Trip is not in transit; cannot board');
    }
    return ride;
  },

  /** Atomic GPS upsert w/ dedup + min-distance guard. Redis cache managed by caller. */
  async reportPosition(shuttleId: string, pos: { lat: number; lng: number; heading?: number; speed?: number }) {
    // Validate lat/lng ranges — the previous implementation accepted
    // `lat: 999, lng: 999` and stored NaN in the haversine computation.
    if (!Number.isFinite(pos.lat) || pos.lat < -90 || pos.lat > 90) throw new BadRequestError('lat must be in [-90, 90]');
    if (!Number.isFinite(pos.lng) || pos.lng < -180 || pos.lng > 180) throw new BadRequestError('lng must be in [-180, 180]');

    const [existing] = await db.select().from(schema.shuttlePositions).where(eq(schema.shuttlePositions.shuttleId, shuttleId));
    if (existing && haversineMeters([existing.lat, existing.lng], [pos.lat, pos.lng]) < MIN_GPS_MOVE_METERS) {
      return existing; // dedup: no meaningful movement
    }
    const [row] = await db.insert(schema.shuttlePositions)
      .values({ shuttleId, ...pos, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.shuttlePositions.shuttleId, set: { ...pos, updatedAt: new Date() } })
      .returning();
    return row;
  },
};
