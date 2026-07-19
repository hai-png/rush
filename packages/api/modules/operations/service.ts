import { and, eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { NotFoundError, ConflictError, BadRequestError } from '@addis/shared';
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
        .returning({ id: schema.rides.id, subscriptionId: schema.rides.subscriptionId, seatClaimId: schema.rides.seatClaimId });

      await tx.update(schema.rides)
        .set({ status: 'no_show', updatedAt: new Date() })
        .where(and(eq(schema.rides.tripId, tripId), eq(schema.rides.status, 'booked')));

      for (const r of boarded) {
        if (r.subscriptionId) await subscriptionRepo.incrementRidesUsed(tx, r.subscriptionId);
        if (r.seatClaimId) await tx.update(schema.seatClaims).set({ status: 'used', updatedAt: new Date() }).where(eq(schema.seatClaims.id, r.seatClaimId));
      }
      await tx.insert(schema.outboxEvents).values({ channel: 'audit', payload: { action: 'trip.completed', entityId: tripId } });
      return trip;
    });
  },

  async bookRide(riderId: string, input: { tripId: string; subscriptionId?: string | undefined; seatClaimId?: string | undefined; pickupStop?: string | undefined }) {
    const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, input.tripId));
    if (!trip || trip.status !== 'scheduled') throw new BadRequestError('Trip not open for booking');
    try {
      const [ride] = await db.insert(schema.rides).values({ riderId, ...input, status: 'booked' }).returning();
      await db.update(schema.trips).set({ seatsBooked: trip.seatsBooked + 1 }).where(eq(schema.trips.id, trip.id));
      return ride;
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictError('Already booked on this trip');
      throw e;
    }
  },

  async board(riderId: string, rideId: string) {
    const [ride] = await db.update(schema.rides)
      .set({ status: 'boarded', updatedAt: new Date() })
      .where(and(eq(schema.rides.id, rideId), eq(schema.rides.riderId, riderId), eq(schema.rides.status, 'booked')))
      .returning();
    if (!ride) throw new ConflictError('Ride cannot be boarded in its current state');
    return ride;
  },

  /** Atomic GPS upsert w/ dedup + min-distance guard. Redis cache managed by caller. */
  async reportPosition(shuttleId: string, pos: { lat: number; lng: number; heading?: number | undefined; speed?: number | undefined }) {
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
