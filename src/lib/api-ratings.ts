// POST /rides/:id/rating — rider rates a completed ride.
//
// A rider may rate a ride after it's `completed`. One rating per (ride, rider)
// — the @@unique on RideRating enforces this at the DB layer so we also pre-check
// here for a clean 409 instead of letting P2002 surface. After a successful
// insert we recompute the contractor's aggregate rating.
//
// Auth: the caller must be the rider who took the ride. We accept either a
// direct Ride (Ride.riderId === session.id) or a subscription-booked ride
// (Subscription.riderId === session.id via Ride.subscriptionId).

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

  // Verify the caller actually took this ride. Direct rides have
  // Ride.userId === session.id; subscription-booked rides belong to the
  // subscription's owner.
  const isRider =
    ride.userId === session.id ||
    (ride.subscriptionId !== null && ride.subscription?.userId === session.id);
  if (!isRider) {
    throw new NotFoundError('Ride not found');
  }

  // Only completed rides can be rated.
  if (ride.status !== 'completed') {
    throw new BadRequestError(`Cannot rate a ride that is ${ride.status} (must be completed)`);
  }

  // Resolve the contractor (driver) who took the rider. The trip's driverId
  // is the contractor's User.id.
  const contractorId = ride.trip?.driverId;
  if (!contractorId) {
    throw new BadRequestError('Cannot rate a ride with no assigned driver');
  }

  // Pre-check for an existing rating so we can raise a clean 409. The
  // @@unique([rideId, riderId]) on RideRating is the actual guarantee.
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

  // Recompute the contractor's aggregate rating so the new score is reflected.
  try {
    const { recomputeContractorRating } = await import('@/lib/api-admin');
    const profile = await db.contractorProfile.findUnique({ where: { userId: contractorId } });
    if (profile) await recomputeContractorRating(profile.id);
  } catch (err) {
    // Non-fatal — the rating row is already committed. The next recompute
    // (e.g. after the next trip completion) will pick up this rating.
    logger.error({ err: (err as Error).message, contractorId }, '[rating] recompute failed');
  }

  return { status: 201, data: rating };
}
