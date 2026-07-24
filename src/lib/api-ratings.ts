import { db } from '@/lib/db';
import { z } from 'zod';
import { BadRequestError, NotFoundError, ConflictError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';

const RatingInput = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(1).max(2000).optional(),
});

export async function POST_create_rating({ session, params, body, ipAddress, userAgent }: any) {
  const input = RatingInput.parse(body);

  const ride = await db.ride.findUnique({
    where: { id: params.id },
    include: {
      trip: { select: { driverId: true } },
      subscription: { select: { userId: true } },
    },
  });
  if (!ride) throw new NotFoundError('Ride not found');

  const isRider =
    ride.userId === session.id ||
    (ride.subscriptionId !== null && ride.subscription?.userId === session.id);
  if (!isRider) {
    throw new NotFoundError('Ride not found');
  }

  if (ride.status !== 'completed') {
    throw new BadRequestError(`Cannot rate a ride that is ${ride.status} (must be completed)`);
  }

  const contractorId = ride.trip?.driverId;
  if (!contractorId) {
    throw new BadRequestError('Cannot rate a ride with no assigned driver');
  }

  const existing = await db.rideRating.findUnique({
    where: { rideId_riderId: { rideId: ride.id, riderId: session.id } },
    select: { id: true },
  });
  if (existing) throw new ConflictError('You have already rated this ride');

  const rating = await db.rideRating.create({
    data: {
      rideId: ride.id,
      riderId: session.id,
      contractorId,
      rating: input.rating,
      comment: input.comment,
    },
  });

  await audit({
    actorId: session.id,
    action: 'ride.rated',
    entityType: 'ride_rating',
    entityId: rating.id,
    after: { rideId: ride.id, contractorId, rating: input.rating },
    ipAddress, userAgent,
  });

  try {
    // H-1 fix: recomputeContractorRating expects a User.id (it queries
    const { recomputeContractorRating } = await import('@/lib/api-admin');
    const profile = await db.contractorProfile.findUnique({ where: { userId: contractorId } });
    if (profile) await recomputeContractorRating(profile.userId);
  } catch (err) {
    logger.error({ err: (err as Error).message, contractorId }, '[rating] recompute failed');
  }

  return { status: 201, data: rating };
}

