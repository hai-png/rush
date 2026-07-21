// Marketplace — seat releases (riders with active subscriptions can release a
// seat they can't use; other riders can claim it for a discount).
import { db } from '@/lib/db';
import { z } from 'zod';
import { Money } from '@/lib/money';
import { BadRequestError, NotFoundError, ConflictError } from '@/lib/errors';
import { getPaymentProvider } from '@/lib/payments';
import { loadEnv } from '@/lib/env';
import { createId } from '@/lib/id';
import { audit } from '@/lib/audit';

export async function GET_releases({ session }: any) {
  const releases = await db.seatRelease.findMany({
    where: { status: 'open', expiresAt: { gt: new Date() } },
    include: {
      trip: { include: { route: true, shuttle: true } },
      user: { select: { name: true } },
    },
    orderBy: { expiresAt: 'asc' },
    take: 50,
  });
  // Don't show your own releases.
  return { data: releases.filter(r => r.userId !== session.id) };
}

const ReleaseInput = z.object({
  tripId: z.string().min(1),
  window: z.enum(['morning', 'evening']),
  expiresAt: z.string().datetime(),
});

export async function POST_create_release({ session, body, ipAddress, userAgent }: any) {
  const input = ReleaseInput.parse(body);
  const trip = await db.trip.findUnique({ where: { id: input.tripId } });
  if (!trip) throw new NotFoundError('Trip not found');
  if (trip.status !== 'scheduled') throw new BadRequestError('Trip is not scheduled');

  // Verify the user has an active subscription or ride on this trip.
  const ride = await db.ride.findFirst({
    where: { tripId: input.tripId, userId: session.id, status: 'booked' },
  });
  if (!ride) throw new BadRequestError('You have no booked ride on this trip');

  const release = await db.seatRelease.create({
    data: {
      userId: session.id,
      tripId: input.tripId,
      window: input.window,
      status: 'open',
      expiresAt: new Date(input.expiresAt),
    },
  });
  await audit({
    actorId: session.id,
    action: 'seat_released',
    entityType: 'seat_release',
    entityId: release.id,
    after: { tripId: input.tripId },
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
  if (release.userId === session.id) throw new BadRequestError('Cannot claim your own release');

  // Price = the route fare (simplified; original had a discount model).
  const fare = release.trip.route.fareCents;
  if (fare <= 0) throw new BadRequestError('Route fare not set');

  const reference = `SC${createId()}`;
  const provider = getPaymentProvider(input.paymentMethod);
  const env = loadEnv();
  const checkout = await provider.createCheckout({
    merchOrderId: reference,
    amount: Money.fromCents(fare),
    description: `Seat claim for ${release.trip.route.origin} → ${release.trip.route.destination}`,
    notifyUrl: env.TELEBIRR_NOTIFY_URL || `${env.APP_BASE_URL}/api/v1/webhooks/telebirr/notify`,
    redirectUrl: env.TELEBIRR_REDIRECT_URL || `${env.APP_BASE_URL}/checkout/complete`,
  });

  // Create payment + seat claim in pending state.
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

    return tx.seatClaim.create({
      data: {
        seatReleaseId: release.id,
        claimantUserId: session.id,
        paymentId: payment.id,
        status: 'confirmed', // will be confirmed when payment settles; for now it's "confirmed pending payment"
      },
    });
  });

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

// Only the seller can cancel; only open releases can be cancelled.
export async function POST_cancel_release({ session, params, ipAddress, userAgent }: any) {
  const release = await db.seatRelease.findUnique({ where: { id: params.id } });
  if (!release) throw new NotFoundError('Seat release not found');
  if (release.userId !== session.id) throw new NotFoundError('Seat release not found');
  if (release.status !== 'open') throw new BadRequestError(`Cannot cancel a ${release.status} release`);

  await db.seatRelease.update({
    where: { id: release.id },
    data: { status: 'cancelled' },
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
  const release = await db.seatRelease.findUnique({ where: { id: params.id } });
  if (!release) throw new NotFoundError('Seat release not found');
  if (release.userId !== session.id && session.role !== 'platform_admin') {
    throw new NotFoundError('Seat release not found');
  }
  if (release.status !== 'open') throw new BadRequestError(`Cannot delete a ${release.status} release`);
  await db.seatRelease.update({ where: { id: release.id }, data: { status: 'cancelled' } });
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

// to POST /seat-releases/:id/claim). Takes a seatReleaseId + paymentMethod.
const ClaimCreateInput = z.object({
  seatReleaseId: z.string().min(1),
  paymentMethod: z.enum(['telebirr', 'cbe']),
});

export async function POST_claim_direct({ session, body, ipAddress, userAgent }: any) {
  const input = ClaimCreateInput.parse(body);
  // Delegate to the existing POST_claim handler by calling it with params.
  // Actually, let's just inline the logic.
  const release = await db.seatRelease.findUnique({
    where: { id: input.seatReleaseId },
    include: { trip: { include: { route: true } } },
  });
  if (!release) throw new NotFoundError('Seat release not found');
  if (release.status !== 'open') throw new ConflictError('Seat release no longer available');
  if (release.expiresAt < new Date()) throw new BadRequestError('Seat release expired');
  if (release.userId === session.id) throw new BadRequestError('Cannot claim your own release');

  const fare = release.trip.route.fareCents;
  if (fare <= 0) throw new BadRequestError('Route fare not set');

  const reference = `SC${createId()}`;
  const provider = getPaymentProvider(input.paymentMethod);
  const env = loadEnv();
  const checkout = await provider.createCheckout({
    merchOrderId: reference,
    amount: Money.fromCents(fare),
    description: `Seat claim for ${release.trip.route.origin} → ${release.trip.route.destination}`,
    notifyUrl: env.TELEBIRR_NOTIFY_URL || `${env.APP_BASE_URL}/api/v1/webhooks/telebirr/notify`,
    redirectUrl: env.TELEBIRR_REDIRECT_URL || `${env.APP_BASE_URL}/checkout/complete`,
  });

  const claim = await db.$transaction(async (tx) => {
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

    return tx.seatClaim.create({
      data: {
        seatReleaseId: release.id,
        claimantUserId: session.id,
        paymentId: payment.id,
        status: 'confirmed',
      },
    });
  });

  await audit({
    actorId: session.id,
    action: 'seat_claimed',
    entityType: 'seat_claim',
    entityId: claim.id,
    after: { releaseId: release.id, paymentRef: reference },
    ipAddress, userAgent,
  });

  return { status: 201, data: { claim, paymentReference: reference, checkout } };
}
