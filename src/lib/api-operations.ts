import { db } from '@/lib/db';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { BadRequestError, NotFoundError, ConflictError, ForbiddenError } from '@/lib/errors';
import { consumeRide } from '@/lib/subscription';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';

export async function GET_rides({ session }: any) {
  const rides = await db.ride.findMany({
    where: session.role === 'platform_admin' ? {} : { userId: session.id },
    include: { trip: { include: { route: true, shuttle: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { data: rides };
}

const RideInput = z.object({
  tripId: z.string().min(1),
  subscriptionId: z.string().optional(),
  seatClaimId: z.string().optional(),
  pickupLocationId: z.string().optional(),
}).refine(v => v.subscriptionId || v.seatClaimId, 'Either subscriptionId or seatClaimId is required');

export async function POST_ride({ session, body, ipAddress, userAgent }: any) {
  const input = RideInput.parse(body);
  const trip = await db.trip.findUnique({ where: { id: input.tripId }, include: { shuttle: true } });
  if (!trip) throw new NotFoundError('Trip not found');
  if (trip.status !== 'scheduled') throw new BadRequestError('Trip is not schedulable');

  // Atomically increment seatsBooked if there's room (CAS UPDATE).
  if (input.subscriptionId) {
    const sub = await db.subscription.findUnique({ where: { id: input.subscriptionId } });
    if (!sub) throw new NotFoundError('Subscription not found');
    if (sub.userId !== session.id) throw new ForbiddenError('Not your subscription');
    if (sub.status !== 'active') throw new BadRequestError('Subscription not active');
  }

  if (input.seatClaimId) {
    const claim = await db.seatClaim.findUnique({
      where: { id: input.seatClaimId },
      include: { seatRelease: true },
    });
    if (!claim) throw new NotFoundError('Seat claim not found');
    if (claim.claimantUserId !== session.id) throw new ForbiddenError('Not your seat claim');
    if (claim.status !== 'confirmed') throw new BadRequestError('Seat claim is not confirmed');
    if (claim.seatRelease.tripId !== input.tripId) throw new BadRequestError('Seat claim is for a different trip');
  }

  const ride = await db.$transaction(async (tx) => {
    const updated = await tx.trip.updateMany({
      where: { id: trip.id, seatsBooked: { lt: trip.shuttle.capacity } },
      data: { seatsBooked: { increment: 1 } },
    });
    if (updated.count === 0) throw new ConflictError('Trip is full');

    if (input.subscriptionId) {
      await consumeRide(tx, input.subscriptionId);
    }
    if (input.seatClaimId) {
      // Mark the claim as 'used' so it can't be reused for another ride.
      await tx.seatClaim.update({
        where: { id: input.seatClaimId },
        data: { status: 'used' },
      });
    }
    return tx.ride.create({
      data: {
        tripId: input.tripId,
        userId: session.id,
        subscriptionId: input.subscriptionId,
        seatClaimId: input.seatClaimId,
        pickupLocationId: input.pickupLocationId,
        assignmentId: trip.assignmentId,
        status: 'booked',
      },
    });
  });

  await audit({
    actorId: session.id,
    action: 'ride.booked',
    entityType: 'ride',
    entityId: ride.id,
    after: { tripId: input.tripId },
    ipAddress, userAgent,
  });
  return { status: 201, data: ride };
}

export async function POST_board({ session, params, ipAddress, userAgent }: any) {
  const trip = await db.trip.findUnique({ where: { id: params.id } });
  if (!trip) throw new NotFoundError('Trip not found');
  if (trip.status !== 'scheduled') throw new BadRequestError('Trip is not scheduled');
  // Only the assigned driver (or an admin) can board a trip.
  if (session.role !== 'platform_admin' && trip.driverId !== session.id) {
    throw new ForbiddenError('Not your trip');
  }

  await db.trip.update({ where: { id: trip.id }, data: { status: 'in_transit' } });
  await db.ride.updateMany({ where: { tripId: trip.id, status: 'booked' }, data: { status: 'boarded' } });
  await audit({
    actorId: session.id,
    action: 'trip.boarded',
    entityType: 'trip',
    entityId: trip.id,
    ipAddress, userAgent,
  });
  return { data: { id: trip.id, status: 'in_transit' } };
}

export async function POST_complete({ session, params, ipAddress, userAgent }: any) {
  const trip = await db.trip.findUnique({ where: { id: params.id } });
  if (!trip) throw new NotFoundError('Trip not found');
  if (trip.status !== 'in_transit') throw new BadRequestError('Trip is not in transit');
  if (session.role !== 'platform_admin' && trip.driverId !== session.id) {
    throw new ForbiddenError('Not your trip');
  }

  await db.$transaction(async (tx) => {
    await tx.trip.update({ where: { id: trip.id }, data: { status: 'completed' } });
    await tx.ride.updateMany({ where: { tripId: trip.id, status: 'boarded' }, data: { status: 'completed' } });
  });
  await audit({
    actorId: session.id,
    action: 'trip.completed',
    entityType: 'trip',
    entityId: trip.id,
    ipAddress, userAgent,
  });
  // Recompute the contractor's rating after trip completion.
  if (trip.driverId) {
    try {
      const { recomputeContractorRating } = await import('@/lib/api-admin');
      const profile = await db.contractorProfile.findUnique({ where: { userId: trip.driverId } });
      if (profile) await recomputeContractorRating(profile.id);
    } catch (err) {
      logger.error({ err: (err as Error).message }, '[trip.complete] recompute rating failed');
    }
  }
  return { data: { id: trip.id, status: 'completed' } };
}


const TripUpdateInput = z.object({
  status: z.enum(['scheduled', 'in_transit', 'completed', 'cancelled']).optional(),
  departureAt: z.string().datetime().optional(),
  driverId: z.string().optional(),
});

export async function PATCH_trip({ session, params, body, ipAddress, userAgent }: any) {
  const input = TripUpdateInput.parse(body);
  const trip = await db.trip.findUnique({ where: { id: params.id } });
  if (!trip) throw new NotFoundError('Trip not found');
  // Only the driver or admin can update.
  if (session.role !== 'platform_admin' && trip.driverId !== session.id) {
    throw new ForbiddenError('Not your trip');
  }
  const updated = await db.trip.update({
    where: { id: params.id },
    data: {
      ...(input.status && { status: input.status }),
      ...(input.departureAt && { departureAt: new Date(input.departureAt) }),
      ...(input.driverId && { driverId: input.driverId }),
    },
    include: { route: true, shuttle: true },
  });
  await audit({ actorId: session.id, action: 'trip.updated', entityType: 'trip', entityId: params.id, after: input, ipAddress, userAgent });
  return { data: updated };
}

const RideUpdateInput = z.object({
  status: z.enum(['booked', 'boarded', 'completed', 'no_show', 'cancelled']).optional(),
});

export async function PATCH_ride({ session, params, body, ipAddress, userAgent }: any) {
  const input = RideUpdateInput.parse(body);
  const ride = await db.ride.findUnique({ where: { id: params.id } });
  if (!ride) throw new NotFoundError('Ride not found');
  // The rider themselves, the trip's driver, or admin can update.
  if (session.role !== 'platform_admin' && ride.userId !== session.id) {
    // Check if session user is the driver of this ride's trip.
    const trip = await db.trip.findUnique({ where: { id: ride.tripId } });
    if (!trip || trip.driverId !== session.id) {
      throw new ForbiddenError('Not your ride');
    }
  }
  const updated = await db.ride.update({ where: { id: params.id }, data: input, include: { trip: { include: { route: true } } } });
  await audit({ actorId: session.id, action: 'ride.updated', entityType: 'ride', entityId: params.id, after: input, ipAddress, userAgent });
  return { data: updated };
}

const TripCreateInput = z.object({
  routeId: z.string().min(1),
  shuttleId: z.string().min(1),
  departureAt: z.string().datetime(),
  window: z.enum(['morning', 'evening']),
});

export async function POST_trip({ session, body, ipAddress, userAgent }: any) {
  const input = TripCreateInput.parse(body);
  const shuttle = await db.shuttle.findUnique({ where: { id: input.shuttleId } });
  if (!shuttle) throw new NotFoundError('Shuttle not found');
  if (!shuttle.isActive) throw new BadRequestError('Shuttle is not active');
  if (session.role === 'contractor' && shuttle.contractorId !== session.id) {
    throw new BadRequestError('You can only create trips on your own shuttles');
  }
  const route = await db.route.findUnique({ where: { id: input.routeId } });
  if (!route || !route.isActive) throw new NotFoundError('Route not found');

  const trip = await db.trip.create({
    data: {
      routeId: input.routeId,
      shuttleId: input.shuttleId,
      driverId: shuttle.contractorId,
      departureAt: new Date(input.departureAt),
      window: input.window,
      status: 'scheduled',
    },
    include: { route: true, shuttle: true },
  });
  await audit({ actorId: session.id, action: 'trip.created', entityType: 'trip', entityId: trip.id, after: input, ipAddress, userAgent });
  return { status: 201, data: trip };
}

const positions = new Map<string, { lat: number; lng: number; heading: number; speed: number; updatedAt: number }>();

const PositionInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional(),
});

export async function POST_shuttle_position({ session, body }: any) {
  const input = PositionInput.parse(body);
  // The contractor's shuttle — find it from their account.
  if (session.role !== 'contractor' && session.role !== 'platform_admin') {
    throw new ForbiddenError('Contractor only');
  }
  // For MVP, key the position by userId. In production, key by shuttleId.
  positions.set(session.id, {
    lat: input.lat,
    lng: input.lng,
    heading: input.heading ?? 0,
    speed: input.speed ?? 0,
    updatedAt: Date.now(),
  });
  return { data: { ok: true } };
}

export async function GET_shuttle_positions({ session }: any) {
  // Return all positions (anonymized — no userId).
  const result: Array<{ lat: number; lng: number; heading: number; speed: number; updatedAt: number }> = [];
  for (const [, pos] of positions) {
    // Only include positions updated in the last 5 minutes.
    if (Date.now() - pos.updatedAt < 5 * 60_000) {
      result.push(pos);
    }
  }
  return { data: result };
}


export async function handleShuttlePositionStream(req: NextRequest, session: any): Promise<NextResponse> {
  if (!session) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, { status: 401 });
  }
  // For MVP, return a simple polling response (not a real SSE stream).
  const result: Array<{ lat: number; lng: number; heading: number; speed: number; updatedAt: number }> = [];
  for (const [, pos] of positions) {
    if (Date.now() - pos.updatedAt < 5 * 60_000) result.push(pos);
  }
  return NextResponse.json({ data: result });
}
