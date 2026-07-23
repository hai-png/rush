import { db } from '@/lib/db';
import { z } from 'zod';
import { Money } from '@/lib/money';
import { BadRequestError, NotFoundError, ConflictError } from '@/lib/errors';
import { getPaymentProvider } from '@/lib/payments';
import { loadEnv } from '@/lib/env';
import { createId } from '@/lib/id';
import { audit } from '@/lib/audit';

export async function GET_releases({ session, query }: any) {
  const { parsePagination, paginatedResponse } = await import('@/lib/pagination');
  const page = parsePagination(query);
  const where: any = { status: 'open', expiresAt: { gt: new Date() }, userId: { not: session.id } };
  if (query?.tripId) where.tripId = query.tripId;
  if (query?.window) where.window = query.window;
  const [releases, total] = await Promise.all([
    db.seatRelease.findMany({
      where,
      include: {
        trip: { include: { route: true, shuttle: true } },
        user: { select: { name: true } },
      },
      orderBy: { expiresAt: 'asc' },
      ...page.findManyArgs,
    }),
    db.seatRelease.count({ where }),
  ]);
  return paginatedResponse(releases, total, page);
}

const ReleaseInput = z.object({
  tripId: z.string().min(1),
  window: z.enum(['morning', 'evening']),
  expiresAt: z.string().datetime(),
});

export async function POST_create_release({ session, body, ipAddress, userAgent }: any) {
  const input = ReleaseInput.parse(body);
  const trip = await db.trip.findUnique({ where: { id: input.tripId }, include: { shuttle: true } });
  if (!trip) throw new NotFoundError('Trip not found');
  if (trip.status !== 'scheduled') throw new BadRequestError('Trip is not scheduled');
  // cannot release a seat on a trip that has already departed.
  if (trip.departureAt.getTime() < Date.now()) {
    throw new BadRequestError('Cannot release a seat on a trip that has already departed');
  }
  // expiresAt must be before trip departure (otherwise the
  // release outlives the trip and a buyer could pay for a seat they can't use).
  const expiresAtDate = new Date(input.expiresAt);
  if (expiresAtDate > trip.departureAt) {
    throw new BadRequestError('Release expiry must be before trip departure');
  }
  // window must match the trip's window.
  if (input.window !== trip.window) {
    throw new BadRequestError(`Release window (${input.window}) does not match trip window (${trip.window})`);
  }

  const ride = await db.ride.findFirst({
    where: { tripId: input.tripId, userId: session.id, status: 'booked' },
  });
  if (!ride) throw new BadRequestError('You have no booked ride on this trip');

  const release = await db.$transaction(async (tx) => {
    // Mark the seller's ride as 'released' and decrement trip.seatsBooked
    // so the freed seat is visible to other riders. The buyer will later
    // re-occupy it via POST_claim with a fresh Ride row + re-increment.
    // CAS-guarded so concurrent releases can't double-decrement.
    const rideCas = await tx.ride.updateMany({
      where: { id: ride.id, status: 'booked' },
      data: { status: 'released' },
    });
    if (rideCas.count === 0) throw new ConflictError('Ride is no longer booked (already released or cancelled)');
    // CAS-guarded decrement with lower bound.
    const tripCas = await tx.trip.updateMany({
      where: { id: trip.id, seatsBooked: { gt: 0 } },
      data: { seatsBooked: { decrement: 1 } },
    });
    if (tripCas.count === 0) throw new ConflictError('Trip seatsBooked was already 0 — refusing to go negative');
    return tx.seatRelease.create({
      data: {
        userId: session.id,
        tripId: input.tripId,
        window: input.window,
        status: 'open',
        expiresAt: expiresAtDate,
      },
    });
  });
  await audit({
    actorId: session.id,
    action: 'seat_released',
    entityType: 'seat_release',
    entityId: release.id,
    after: { tripId: input.tripId, rideId: ride.id },
    ipAddress, userAgent,
  });
  return { status: 201, data: release };
}

const ClaimInput = z.object({
  paymentMethod: z.enum(['telebirr', 'cbe']),
});

export async function POST_claim({ session, body, params, ipAddress, userAgent }: any) {
  const input = ClaimInput.parse(body);
  const release = await db.seatRelease.findUnique({
    where: { id: params.id },
    include: { trip: { include: { route: true } } },
  });
  if (!release) throw new NotFoundError('Seat release not found');
  if (release.status !== 'open') throw new ConflictError('Seat release no longer available');
  if (release.expiresAt < new Date()) throw new BadRequestError('Seat release expired');
  const trip = await db.trip.findUnique({ where: { id: release.tripId } });
  if (trip && trip.departureAt < new Date()) throw new BadRequestError('Cannot cancel a release after trip departure');
  if (release.userId === session.id) throw new BadRequestError('Cannot claim your own release');

  const fare = release.trip.route.fareCents;
  if (fare <= 0) throw new BadRequestError('Route fare not set');

  const reference = `SC${createId()}`;
  const provider = getPaymentProvider(input.paymentMethod);
  const env = loadEnv();

  // create the SeatRelease claim + Payment row BEFORE calling
  // below rolled back (e.g. release already claimed by another buyer), the
  // Telebirr order had been created with no matching Payment row. When the
  // buyer completed payment at Telebirr, the webhook arrived for an unknown
  // merchOrderId and the money was stuck with no record on our side.
  const claim = await db.$transaction(async (tx) => {
    // Mark release as claimed (atomic — only if still open).
    const updated = await tx.seatRelease.updateMany({
      where: { id: release.id, status: 'open' },
      data: { status: 'claimed' },
    });
    if (updated.count === 0) throw new ConflictError('Seat release was just claimed by someone else');

    const payment = await tx.payment.create({
      data: {
        reference,
        userId: session.id,
        method: input.paymentMethod,
        amountCents: fare,
        status: 'pending',
      },
    });

    const newClaim = await tx.seatClaim.create({
      data: {
        seatReleaseId: release.id,
        claimantUserId: session.id,
        paymentId: payment.id,
        status: 'pending',
      },
    });
    // Link the payment back to the claim so settlePayment() can promote the
    // claim to 'confirmed' when the webhook arrives. Without this, the payment
    // settles but the claim stays 'pending' forever.
    await tx.payment.update({ where: { id: payment.id }, data: { seatClaimId: newClaim.id } });
    return newClaim;
  });

  // Now that the Payment row has committed, create the Telebirr checkout.
  // If this throws, mark the Payment failed + reopen the release so the
  // user can retry cleanly.
  let checkout: any;
  try {
    checkout = await provider.createCheckout({
      merchOrderId: reference,
      amount: Money.fromCents(fare),
      description: `Seat claim for ${release.trip.route.origin} → ${release.trip.route.destination}`,
      notifyUrl: env.TELEBIRR_NOTIFY_URL || `${env.APP_BASE_URL}/api/v1/webhooks/telebirr/notify`,
      redirectUrl: env.TELEBIRR_REDIRECT_URL || `${env.APP_BASE_URL}/checkout/complete`,
    });
  } catch (err) {
    // Reopen the release + fail the payment + fail the claim.
    await db.$transaction(async (tx) => {
      await tx.payment.updateMany({ where: { reference }, data: { status: 'failed' } });
      await tx.seatClaim.updateMany({ where: { id: claim.id }, data: { status: 'refunded' } });
      await tx.seatRelease.updateMany({ where: { id: release.id, status: 'claimed' }, data: { status: 'open' } });
    }).catch(() => {});
    throw err;
  }

  await audit({
    actorId: session.id,
    action: 'seat_claimed',
    entityType: 'seat_claim',
    entityId: claim.id,
    after: { releaseId: release.id, paymentRef: reference },
    ipAddress, userAgent,
  });

  return {
    status: 201,
    data: {
      claim,
      paymentReference: reference,
      checkout,
    },
  };
}

export async function GET_my_releases({ session }: any) {
  const releases = await db.seatRelease.findMany({
    where: { userId: session.id },
    include: {
      trip: { include: { route: true, shuttle: true } },
      claims: { include: { claimant: { select: { name: true, phone: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { data: releases };
}

export async function POST_cancel_release({ session, params, ipAddress, userAgent }: any) {
  const release = await db.seatRelease.findUnique({
    where: { id: params.id },
    include: { trip: true },
  });
  if (!release) throw new NotFoundError('Seat release not found');
  if (release.userId !== session.id) throw new NotFoundError('Seat release not found');
  if (release.status !== 'open') throw new BadRequestError(`Cannot cancel a ${release.status} release`);
  // BIZ-024: refuse to cancel a release after the trip has departed. Without
  // this, a seller could "restore" their seat on a trip that's already left,
  // getting credit for a ride they didn't take.
  if (release.trip && release.trip.departureAt.getTime() < Date.now()) {
    throw new BadRequestError('Cannot cancel a release after the trip has departed');
  }

  await db.$transaction(async (tx) => {
    await tx.seatRelease.update({
      where: { id: release.id },
      data: { status: 'cancelled' },
    });
    // Restore the seller's ride: flip back from 'released' to 'booked'
    // and re-increment trip.seatsBooked so the seat is occupied again.
    const sellerRide = await tx.ride.findFirst({
      where: { tripId: release.tripId, userId: release.userId, status: 'released' },
    });
    if (sellerRide) {
      await tx.ride.update({ where: { id: sellerRide.id }, data: { status: 'booked' } });
      await tx.trip.update({
        where: { id: release.tripId },
        data: { seatsBooked: { increment: 1 } },
      });
    }
  });
  await audit({
    actorId: session.id,
    action: 'seat_release.cancelled',
    entityType: 'seat_release',
    entityId: release.id,
    ipAddress, userAgent,
  });
  return { data: { id: release.id, status: 'cancelled' } };
}

export async function GET_release({ session, params }: any) {
  const release = await db.seatRelease.findUnique({
    where: { id: params.id },
    include: {
      trip: { include: { route: true, shuttle: true } },
      user: { select: { name: true } },
      claims: { include: { claimant: { select: { name: true, phone: true } } } },
    },
  });
  if (!release) throw new NotFoundError('Seat release not found');
  // Only the seller or any authenticated user can view (marketplace is open).
  return { data: release };
}

export async function DELETE_release({ session, params, ipAddress, userAgent }: any) {
  // DELETE mirrors POST_cancel_release but also allows platform_admin to
  // cancel any release (POST_cancel_release is seller-only).
  const release = await db.seatRelease.findUnique({ where: { id: params.id } });
  if (!release) throw new NotFoundError('Seat release not found');
  if (release.userId !== session.id && session.role !== 'platform_admin') {
    throw new NotFoundError('Seat release not found');
  }
  if (release.status !== 'open') throw new BadRequestError(`Cannot delete a ${release.status} release`);

  await db.$transaction(async (tx) => {
    await tx.seatRelease.update({
      where: { id: release.id },
      data: { status: 'cancelled' },
    });
    // Restore the seller's ride (same as POST_cancel_release).
    const sellerRide = await tx.ride.findFirst({
      where: { tripId: release.tripId, userId: release.userId, status: 'released' },
    });
    if (sellerRide) {
      await tx.ride.update({ where: { id: sellerRide.id }, data: { status: 'booked' } });
      await tx.trip.update({
        where: { id: release.tripId },
        data: { seatsBooked: { increment: 1 } },
      });
    }
  });
  await audit({ actorId: session.id, action: 'seat_release.deleted', entityType: 'seat_release', entityId: release.id, ipAddress, userAgent });
  return { data: { id: release.id, status: 'cancelled' } };
}

export async function GET_claims({ session }: any) {
  const claims = await db.seatClaim.findMany({
    where: { claimantUserId: session.id },
    include: {
      seatRelease: { include: { trip: { include: { route: true, shuttle: true } } } },
      payment: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { data: claims };
}

export async function GET_claim({ session, params }: any) {
  const claim = await db.seatClaim.findUnique({
    where: { id: params.id },
    include: {
      seatRelease: { include: { trip: { include: { route: true, shuttle: true } } } },
      payment: true,
    },
  });
  if (!claim) throw new NotFoundError('Seat claim not found');
  if (claim.claimantUserId !== session.id && session.role !== 'platform_admin') {
    throw new NotFoundError('Seat claim not found');
  }
  return { data: claim };
}

const ClaimCreateInput = z.object({
  seatReleaseId: z.string().min(1),
  paymentMethod: z.enum(['telebirr', 'cbe']),
});

export async function POST_claim_direct({ session, body, ipAddress, userAgent }: any) {
  // Identical to POST /marketplace/seat-releases/:id/claim — kept as a
  // convenience for clients that prefer a single endpoint with body params
  // over a path-param + body. Delegates to POST_claim to avoid drift.
  const input = ClaimCreateInput.parse(body);
  return POST_claim(
    { session, body: { paymentMethod: input.paymentMethod }, params: { id: input.seatReleaseId }, ipAddress, userAgent },
  );
}
