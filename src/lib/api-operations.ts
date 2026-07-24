import { db } from '@/lib/db';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { BadRequestError, NotFoundError, ConflictError, ForbiddenError } from '@/lib/errors';
import { consumeRide, releaseRide } from '@/lib/subscription';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { enqueueNotification } from '@/lib/outbox';

const BOARD_WINDOW_MS = 30 * 60_000;
const BOOK_AFTER_DEPARTURE_MS = 0;

export async function GET_rides({ session, query }: any) {
  const { parsePagination, paginatedResponse } = await import('@/lib/pagination');
  const page = parsePagination(query);
  const where: any = session.role === 'platform_admin' ? {} : { userId: session.id };
  if (query?.status) where.status = query.status;
  if (query?.tripId) where.tripId = query.tripId;
  const [rides, total] = await Promise.all([
    db.ride.findMany({
      where,
      include: { trip: { include: { route: true, shuttle: true } } },
      orderBy: { createdAt: 'desc' },
      ...page.findManyArgs,
    }),
    db.ride.count({ where }),
  ]);
  return paginatedResponse(rides, total, page);
}

export async function GET_ride({ session, params }: any) {
  const ride = await db.ride.findUnique({
    where: { id: params.id },
    include: { trip: { include: { route: true, shuttle: true } } },
  });
  if (!ride) throw new NotFoundError('Ride not found');
  if (ride.userId !== session.id && session.role !== 'platform_admin') {
    if (ride.trip?.driverId !== session.id) {
      throw new NotFoundError('Ride not found');
    }
  }
  return { data: ride };
}

const RideInput = z.object({
  tripId: z.string().min(1),
  subscriptionId: z.string().optional(),
  seatClaimId: z.string().optional(),
  pickupLocationId: z.string().optional(),
}).refine(v => v.subscriptionId || v.seatClaimId, 'Either subscriptionId or seatClaimId is required');

export async function POST_ride({ session, body, ipAddress, userAgent }: any) {
  const input = RideInput.parse(body);
  const trip = await db.trip.findUnique({ where: { id: input.tripId }, include: { shuttle: true, route: true } });
  if (!trip) throw new NotFoundError('Trip not found');
  if (trip.status !== 'scheduled') throw new BadRequestError('Trip is not schedulable');
  if (trip.departureAt.getTime() + BOOK_AFTER_DEPARTURE_MS < Date.now()) {
    throw new BadRequestError('Trip has already departed');
  }

  if (input.subscriptionId) {
    const sub = await db.subscription.findUnique({ where: { id: input.subscriptionId } });
    if (!sub) throw new NotFoundError('Subscription not found');
    if (sub.userId !== session.id) throw new ForbiddenError('Not your subscription');
    if (sub.status !== 'active') throw new BadRequestError('Subscription not active');
  }
  let farePaidCents: number | null = trip.route?.fareCents ?? null;
  if (input.seatClaimId) {
    const claim = await db.seatClaim.findUnique({
      where: { id: input.seatClaimId },
      include: { seatRelease: true, payment: { select: { amountCents: true } } },
    });
    if (!claim) throw new NotFoundError('Seat claim not found');
    if (claim.claimantUserId !== session.id) throw new ForbiddenError('Not your seat claim');
    if (claim.status !== 'confirmed') throw new BadRequestError('Seat claim is not confirmed');
    if (claim.seatRelease.tripId !== input.tripId) throw new BadRequestError('Seat claim is for a different trip');
    if (claim.payment?.amountCents) farePaidCents = claim.payment.amountCents;
  }

  const ride = await db.$transaction(async (tx) => {
    // prevent double-booking the same trip by the same user.
    const existing = await tx.ride.findFirst({
      where: {
        tripId: input.tripId,
        userId: session.id,
        status: { in: ['booked', 'boarded'] },
      },
      select: { id: true },
    });
    if (existing) throw new ConflictError('You already have a booked ride on this trip');

    const updated = await tx.trip.updateMany({
      where: { id: trip.id, seatsBooked: { lt: trip.shuttle.capacity } },
      data: { seatsBooked: { increment: 1 } },
    });
    if (updated.count === 0) throw new ConflictError('Trip is full');

    if (input.subscriptionId) {
      await consumeRide(tx, input.subscriptionId);
    }
    if (input.seatClaimId) {
      const claimUpdate = await tx.seatClaim.updateMany({
        where: { id: input.seatClaimId, status: 'confirmed' },
        data: { status: 'used' },
      });
      if (claimUpdate.count === 0) throw new ConflictError('Seat claim is no longer confirmed');
    }
    return tx.ride.create({
      data: {
        tripId: input.tripId,
        userId: session.id,
        subscriptionId: input.subscriptionId,
        seatClaimId: input.seatClaimId,
        pickupLocationId: input.pickupLocationId,
        assignmentId: trip.assignmentId,
        farePaidCents, // snapshot at booking time
        status: 'booked',
      },
    });
  }, { timeout: 15000, maxWait: 20000 });

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
  if (trip.departureAt.getTime() - Date.now() > BOARD_WINDOW_MS) {
    throw new BadRequestError('Too early to board — boarding opens 30 minutes before departure');
  }
  if (session.role !== 'platform_admin' && trip.driverId !== session.id) {
    throw new ForbiddenError('Not your trip');
  }

  const before = { ...trip };

  // Wrap in a transaction; CAS on trip.status prevents concurrent boards.
  await db.$transaction(async (tx) => {
    const tripCas = await tx.trip.updateMany({
      where: { id: trip.id, status: 'scheduled' },
      data: { status: 'in_transit' },
    });
    if (tripCas.count === 0) throw new ConflictError('Trip is no longer in a boardable state');

    const boardableRideIds = await tx.ride.findMany({
      where: { tripId: trip.id, status: 'booked' },
      select: { id: true, subscriptionId: true, subscription: { select: { status: true } } },
    });
    const validRideIds = boardableRideIds
      .filter(r => !r.subscriptionId || r.subscription?.status === 'active')
      .map(r => r.id);

    if (validRideIds.length > 0) {
      await tx.ride.updateMany({
        where: { id: { in: validRideIds } },
        data: { status: 'boarded' },
      });
    }
  }, { timeout: 15000, maxWait: 20000 });
  await audit({
    actorId: session.id,
    action: 'trip.boarded',
    entityType: 'trip',
    entityId: trip.id,
    before,
    after: { status: 'in_transit' },
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

  const boardedCount = await db.ride.count({
    where: { tripId: trip.id, status: 'boarded' },
  });
  if (boardedCount === 0) {
    throw new BadRequestError('Cannot complete a trip with no boarded rides. Cancel the trip instead.');
  }

  const before = { ...trip };

  await db.$transaction(async (tx) => {
    const tripCas = await tx.trip.updateMany({
      where: { id: trip.id, status: 'in_transit' },
      data: { status: 'completed' },
    });
    if (tripCas.count === 0) throw new ConflictError('Trip is no longer in transit');

    const boardedCount = await tx.ride.count({ where: { tripId: trip.id, status: 'boarded' } });
    if (boardedCount === 0) throw new BadRequestError('Cannot complete a trip with no boarded rides');

    await tx.ride.updateMany({ where: { tripId: trip.id, status: 'boarded' }, data: { status: 'completed' } });
    const noShowResult = await tx.ride.updateMany({ where: { tripId: trip.id, status: 'booked' }, data: { status: 'no_show' } });
    if (noShowResult.count > 0) {
      await tx.trip.updateMany({
        where: { id: trip.id, seatsBooked: { gte: noShowResult.count } },
        data: { seatsBooked: { decrement: noShowResult.count } },
      });
    }
    await tx.ride.updateMany({ where: { tripId: trip.id, status: 'released' }, data: { status: 'cancelled' } });
  }, { timeout: 15000, maxWait: 20000 });
  await audit({
    actorId: session.id,
    action: 'trip.completed',
    entityType: 'trip',
    entityId: trip.id,
    before,
    after: { status: 'completed' },
    ipAddress, userAgent,
  });
  if (trip.driverId) {
    try {
      const { recomputeContractorRating } = await import('@/lib/api-admin');
      const profile = await db.contractorProfile.findUnique({ where: { userId: trip.driverId } });
      if (profile) await recomputeContractorRating(profile.userId)  // H-1 fix: pass User.id, not ContractorProfile.id;
    } catch (err) {
      logger.error({ err: (err as Error).message }, '[trip.complete] recompute rating failed');
    }
  }
  return { data: { id: trip.id, status: 'completed' } };
}

export async function POST_trip_cancel({ session, params, body, ipAddress, userAgent }: any) {
  const trip = await db.trip.findUnique({
    where: { id: params.id },
    include: { route: true },
  });
  if (!trip) throw new NotFoundError('Trip not found');
  if (session.role !== 'platform_admin' && trip.driverId !== session.id) {
    throw new ForbiddenError('Not your trip');
  }
  if (trip.status === 'completed' || trip.status === 'cancelled') {
    throw new BadRequestError(`Trip is already ${trip.status}`);
  }

  const reason = (body?.reason && typeof body.reason === 'string' && body.reason.length <= 500)
    ? body.reason
    : 'Trip cancelled';

  const before = { ...trip };

  const affected = await db.$transaction(async (tx) => {
    const tripCas = await tx.trip.updateMany({
      where: { id: trip.id, status: { in: ['scheduled', 'in_transit'] } },
      data: { status: 'cancelled' },
    });
    if (tripCas.count === 0) throw new ConflictError('Trip is no longer in a cancellable state');

    const rides = await tx.ride.findMany({
      where: { tripId: trip.id, status: { in: ['booked', 'boarded'] } },
      select: { id: true, userId: true, subscriptionId: true, seatClaimId: true, status: true },
    });

    if (rides.length > 0) {
      await tx.ride.updateMany({
        where: { id: { in: rides.map(r => r.id) } },
        data: { status: 'cancelled' },
      });
    }

    await tx.trip.update({ where: { id: trip.id }, data: { seatsBooked: 0 } });

    return rides;
  }, { timeout: 15000, maxWait: 20000 });

  for (const r of affected) {
    if (r.subscriptionId) {
      try { await releaseRide(r.subscriptionId); } catch (err) {
        logger.error({ err: (err as Error).message, subscriptionId: r.subscriptionId }, '[trip.cancel] releaseRide failed');
      }
    }
    try {
      await enqueueNotification({
        userId: r.userId,
        type: 'trip_cancelled',
        title: 'Trip cancelled',
        body: `Your trip on ${trip.route?.origin ?? 'route'} → ${trip.route?.destination ?? ''} was cancelled. ${reason}`,
        link: '/dashboard/rider',
      });
    } catch (err) {
      logger.error({ err: (err as Error).message }, '[trip.cancel] notify failed');
    }
  }

  await audit({
    actorId: session.id,
    action: 'trip.cancelled',
    entityType: 'trip',
    entityId: trip.id,
    before,
    after: { reason, affectedRides: affected.length },
    ipAddress, userAgent,
  });
  return { data: { id: trip.id, status: 'cancelled', affectedRides: affected.length } };
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
  if (session.role !== 'platform_admin' && trip.driverId !== session.id) {
    throw new ForbiddenError('Not your trip');
  }
  if (input.driverId && input.driverId !== trip.driverId) {
    if (session.role !== 'platform_admin') {
      throw new ForbiddenError('Only platform admins can reassign drivers');
    }
    const contractor = await db.contractorProfile.findUnique({
      where: { userId: input.driverId },
      select: { verificationStatus: true },
    });
    if (!contractor || contractor.verificationStatus !== 'verified') {
      throw new BadRequestError('New driver is not a verified contractor');
    }
  }
  const before = trip;
  const updated = await db.trip.update({
    where: { id: params.id },
    data: {
      ...(input.status && { status: input.status }),
      ...(input.departureAt && { departureAt: new Date(input.departureAt) }),
      ...(input.driverId && { driverId: input.driverId }),
    },
    include: { route: true, shuttle: true },
  });
  await audit({ actorId: session.id, action: 'trip.updated', entityType: 'trip', entityId: params.id, before, after: input, ipAddress, userAgent });
  return { data: updated };
}

const RIDE_TRANSITIONS: Record<string, Set<string>> = {
  booked: new Set(['boarded', 'no_show', 'cancelled', 'released']),
  boarded: new Set(['completed']),
  no_show: new Set(),          // terminal
  completed: new Set(),        // terminal
  cancelled: new Set(),        // terminal
  // H-15 fix: removed 'booked' from released transitions. Previously, a
  released: new Set(['cancelled']),
};

function assertRideTransition(from: string, to: string): void {
  const allowed = RIDE_TRANSITIONS[from];
  if (!allowed || !allowed.has(to)) {
    throw new ConflictError(`Illegal ride status transition: ${from} → ${to}`);
  }
}

const RideUpdateInput = z.object({
  status: z.enum(['booked', 'boarded', 'completed', 'no_show', 'cancelled', 'released']).optional(),
});

export async function PATCH_ride({ session, params, body, ipAddress, userAgent }: any) {
  const input = RideUpdateInput.parse(body);
  const ride = await db.ride.findUnique({ where: { id: params.id } });
  if (!ride) throw new NotFoundError('Ride not found');

  let isDriver = false;
  if (session.role !== 'platform_admin' && ride.userId !== session.id) {
    const trip = await db.trip.findUnique({ where: { id: ride.tripId } });
    if (!trip || trip.driverId !== session.id) {
      throw new ForbiddenError('Not your ride');
    }
    isDriver = true;
  }

  if (input.status && input.status !== ride.status) {
    assertRideTransition(ride.status, input.status);

    if (!isDriver && session.role !== 'platform_admin') {
      if (input.status !== 'cancelled') {
        throw new ForbiddenError('Riders can only cancel their own rides');
      }
      if (ride.status !== 'booked') {
        throw new BadRequestError('Riders can only cancel rides that have not yet boarded');
      }
    }
  }

  const before = ride;

  const shouldReleaseSeat = input.status === 'cancelled' && (ride.status === 'booked' || ride.status === 'boarded');

  const updated = await db.$transaction(async (tx) => {
    if (shouldReleaseSeat) {
      await tx.trip.updateMany({
        where: { id: ride.tripId, seatsBooked: { gt: 0 } },
        data: { seatsBooked: { decrement: 1 } },
      });
    }
    return tx.ride.update({
      where: { id: params.id },
      data: input,
      include: { trip: { include: { route: true } } },
    });
  }, { timeout: 15000, maxWait: 20000 });

  if (shouldReleaseSeat && ride.subscriptionId) {
    try { await releaseRide(ride.subscriptionId); } catch (err) {
      logger.error({ err: (err as Error).message }, '[ride.patch] releaseRide failed');
    }
  }

  await audit({ actorId: session.id, action: 'ride.updated', entityType: 'ride', entityId: params.id, before, after: input, ipAddress, userAgent });
  return { data: updated };
}

export async function POST_ride_cancel({ session, params, ipAddress, userAgent }: any) {
  return PATCH_ride({ session, params, body: { status: 'cancelled' }, ipAddress, userAgent });
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
  // H-26 fix: removed the duplicate verification check above (it threw
  if (session.role === 'contractor') {
    const profile = await db.contractorProfile.findUnique({
      where: { userId: session.id },
      select: { verificationStatus: true },
    });
    if (!profile || profile.verificationStatus !== 'verified') {
      throw new ForbiddenError('Your contractor account is not verified. You cannot create trips until an admin approves your documents.');
    }
  }
  const route = await db.route.findUnique({ where: { id: input.routeId } });
  if (!route || !route.isActive) throw new NotFoundError('Route not found');

  // prevent double-booking the same shuttle at overlapping times.
  const departureTime = new Date(input.departureAt);
  const bufferMs = (route.durationMin ?? 60) * 60_000;
  const overlap = await db.trip.findFirst({
    where: {
      shuttleId: input.shuttleId,
      status: { in: ['scheduled', 'in_transit'] },
      departureAt: {
        gt: new Date(departureTime.getTime() - bufferMs),
        lt: new Date(departureTime.getTime() + bufferMs),
      },
    },
    select: { id: true },
  });
  if (overlap) throw new ConflictError('Shuttle already has a trip near this departure time');

  const trip = await db.trip.create({
    data: {
      routeId: input.routeId,
      shuttleId: input.shuttleId,
      driverId: shuttle.contractorId,
      departureAt: departureTime,
      window: input.window,
      status: 'scheduled',
    },
    include: { route: true, shuttle: true },
  });
  await audit({ actorId: session.id, action: 'trip.created', entityType: 'trip', entityId: trip.id, after: input, ipAddress, userAgent });
  return { status: 201, data: trip };
}

const positions = new Map<string, { lat: number; lng: number; heading: number; speed: number; updatedAt: number }>();

setInterval(() => {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [k, v] of positions) {
    if (v.updatedAt < cutoff) positions.delete(k);
  }
}, 60_000).unref?.();

const PositionInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional(),
});

export async function POST_shuttle_position({ session, body }: any) {
  const input = PositionInput.parse(body);
  if (session.role !== 'contractor' && session.role !== 'platform_admin') {
    throw new ForbiddenError('Contractor only');
  }
  let shuttleId: string | null = null;
  if (session.role === 'contractor') {
    if (body.shuttleId) {
      const owns = await db.shuttle.findFirst({
        where: { id: body.shuttleId, contractorId: session.id },
        select: { id: true, isActive: true },
      });
      if (!owns) throw new ForbiddenError('You do not own this shuttle');
      if (!owns.isActive) throw new BadRequestError('This shuttle is not active');
      shuttleId = owns.id;
    } else {
      const owns = await db.shuttle.findFirst({
        where: { contractorId: session.id, isActive: true },
        select: { id: true },
      });
      if (!owns) throw new ForbiddenError('You have no active shuttle');
      shuttleId = owns.id;
    }
  } else {
    shuttleId = body.shuttleId ?? null;
    if (!shuttleId) throw new BadRequestError('shuttleId is required for platform_admin');
    const exists = await db.shuttle.findUnique({ where: { id: shuttleId }, select: { id: true } });
    if (!exists) throw new NotFoundError('Shuttle not found');
  }
  const pos = {
    lat: input.lat,
    lng: input.lng,
    heading: input.heading ?? 0,
    speed: input.speed ?? 0,
    updatedAt: Date.now(),
    shuttleId,
  };
  try {
    const { redisSetPosition } = await import('@/lib/redis');
    await redisSetPosition(shuttleId, pos, 300); // 5-min TTL
  } catch {
    positions.set(shuttleId, pos);
  }
  return { data: { ok: true } };
}

export async function GET_shuttle_positions({ session, query }: any) {
  let allowedShuttleIds: Set<string> | null = null;
  if (session?.role === 'rider') {
    const rides = await db.ride.findMany({
      where: {
        userId: session.id,
        status: 'booked',
        trip: { status: { in: ['scheduled', 'in_transit'] } },
      },
      select: { trip: { select: { shuttleId: true } } },
    });
    allowedShuttleIds = new Set(rides.map(r => r.trip?.shuttleId).filter(Boolean) as string[]);
  } else if (session?.role === 'contractor') {
    const ownShuttles = await db.shuttle.findMany({
      where: { contractorId: session.id, isActive: true },
      select: { id: true },
    });
    allowedShuttleIds = new Set(ownShuttles.map(s => s.id));
  }

  let tripShuttleIds: Set<string> | null = null;
  if (query?.tripId || query?.routeId) {
    const trips = await db.trip.findMany({
      where: {
        ...(query?.tripId ? { id: query.tripId } : {}),
        ...(query?.routeId ? { routeId: query.routeId } : {}),
      },
      select: { id: true, shuttleId: true },
    });
    tripShuttleIds = new Set(trips.map(t => t.shuttleId));
  }

  const filterFn = (shuttleId: string | undefined): boolean => {
    if (!shuttleId) return false;
    if (allowedShuttleIds && !allowedShuttleIds.has(shuttleId)) return false;
    if (tripShuttleIds && !tripShuttleIds.has(shuttleId)) return false;
    return true;
  };

  try {
    const { redisGetAllPositions } = await import('@/lib/redis');
    const redisResult = await redisGetAllPositions('pos:*');
    if (redisResult.length > 0 || (await import('@/lib/redis')).isRedisAvailable()) {
      return { data: redisResult.filter((p: any) => filterFn(p.shuttleId)) };
    }
  } catch {  }
  const result: Array<{ lat: number; lng: number; heading: number; speed: number; updatedAt: number }> = [];
  for (const [, pos] of positions) {
    if (Date.now() - pos.updatedAt < 5 * 60_000 && filterFn((pos as any).shuttleId)) {
      result.push(pos);
    }
  }
  return { data: result };
}

export async function handleShuttlePositionStream(req: NextRequest, session: any, params: any, ctx: { requestId: string }): Promise<NextResponse> {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  if (!session) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Sign in required', requestId } },
      { status: 401, headers: { 'x-request-id': requestId } }
    );
  }
  const url = new URL(req.url);
  const query = {
    tripId: url.searchParams.get('tripId') ?? undefined,
    routeId: url.searchParams.get('routeId') ?? undefined,
  };

  let allowedShuttleIds: Set<string> | null = null;
  if (session.role === 'rider') {
    const rides = await db.ride.findMany({
      where: {
        userId: session.id,
        status: 'booked',
        trip: { status: { in: ['scheduled', 'in_transit'] } },
      },
      select: { trip: { select: { shuttleId: true } } },
    });
    allowedShuttleIds = new Set(rides.map(r => r.trip?.shuttleId).filter(Boolean) as string[]);
  } else if (session.role === 'contractor') {
    const ownShuttles = await db.shuttle.findMany({
      where: { contractorId: session.id, isActive: true },
      select: { id: true },
    });
    allowedShuttleIds = new Set(ownShuttles.map(s => s.id));
  }

  let tripShuttleIds: Set<string> | null = null;
  if (query.tripId || query.routeId) {
    const trips = await db.trip.findMany({
      where: {
        ...(query.tripId ? { id: query.tripId } : {}),
        ...(query.routeId ? { routeId: query.routeId } : {}),
      },
      select: { id: true, shuttleId: true },
    });
    tripShuttleIds = new Set(trips.map(t => t.shuttleId));
  }

  const filterFn = (shuttleId: string | undefined): boolean => {
    if (!shuttleId) return false;
    if (allowedShuttleIds && !allowedShuttleIds.has(shuttleId)) return false;
    if (tripShuttleIds && !tripShuttleIds.has(shuttleId)) return false;
    return true;
  };

  const result: Array<{ lat: number; lng: number; heading: number; speed: number; updatedAt: number }> = [];
  for (const [, pos] of positions) {
    if (Date.now() - pos.updatedAt < 5 * 60_000 && filterFn((pos as any).shuttleId)) {
      result.push(pos);
    }
  }
  return NextResponse.json({ data: result }, { headers: { 'x-request-id': requestId } });
}

export async function POST_ride_no_show({ session, params, ipAddress, userAgent }: any) {
  const ride = await db.ride.findUnique({ where: { id: params.id } });
  if (!ride) throw new NotFoundError('Ride not found');
  const trip = await db.trip.findUnique({ where: { id: ride.tripId } });
  if (!trip) throw new NotFoundError('Trip not found');
  if (session.role !== 'platform_admin' && trip.driverId !== session.id) {
    throw new ForbiddenError('Only the driver or admin can mark no-show');
  }
  if (ride.status !== 'booked') throw new BadRequestError('Only booked rides can be marked no-show');
  const before = ride;
  await db.$transaction(async (tx) => {
    const cas = await tx.ride.updateMany({ where: { id: params.id, status: 'booked' }, data: { status: 'no_show' } });
    if (cas.count === 0) throw new ConflictError('Ride is no longer booked');
    await tx.trip.updateMany({ where: { id: ride.tripId, seatsBooked: { gt: 0 } }, data: { seatsBooked: { decrement: 1 } } });
  }, { timeout: 15000, maxWait: 20000 });
  await audit({ actorId: session.id, action: 'ride.no_show', entityType: 'ride', entityId: params.id, before, after: { status: 'no_show' }, ipAddress, userAgent });
  return { data: { id: params.id, status: 'no_show' } };
}

