// Operations — rides (rider books a ride against a subscription or seat claim),
// trips (contractor boards/completes).
import { db } from '@/lib/db';
import { z } from 'zod';
import { BadRequestError, NotFoundError, ConflictError, ForbiddenError } from '@/lib/errors';
import { consumeRide } from '@/lib/subscription';
import { audit } from '@/lib/audit';

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

  const updated = await db.trip.updateMany({
    where: { id: trip.id, seatsBooked: { lt: trip.shuttle.capacity } },
    data: { seatsBooked: { increment: 1 } },
  });
  if (updated.count === 0) throw new ConflictError('Trip is full');

  const ride = await db.$transaction(async (tx) => {
    if (input.subscriptionId) {
      await consumeRide(tx, input.subscriptionId);
    }
    return tx.ride.create({
      data: {
        tripId: input.tripId,
        userId: session.id,
        subscriptionId: input.subscriptionId,
        seatClaimId: input.seatClaimId,
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
  return { data: { id: trip.id, status: 'completed' } };
}
