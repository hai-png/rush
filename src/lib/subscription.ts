
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { BadRequestError } from '@/lib/errors';

type TxClient = Prisma.TransactionClient;

// consumeRide atomically increments subscription.ridesUsed with a CAS guard
// so two concurrent POST /rides calls can't both consume the last ride.
// P2-75 fix: include status:'active' in the CAS where-clause so a sub that
// was cancelled or expired between the read and the CAS still fails cleanly.
export async function consumeRide(
  tx: TxClient | typeof db,
  subscriptionId: string,
): Promise<void> {
  const sub = await tx.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  });
  if (!sub) throw new BadRequestError('Subscription not found');
  if (sub.status !== 'active') throw new BadRequestError('Subscription not active');
  if (sub.plan.ridesIncluded === -1) {
    // Unlimited plan — no cap to enforce, just increment for reporting.
    await tx.subscription.update({
      where: { id: subscriptionId },
      data: { ridesUsed: { increment: 1 } },
    });
    return;
  }
  // Atomic CAS: only increment if we haven't hit the cap AND the sub is still active.
  const updated = await tx.subscription.updateMany({
    where: {
      id: subscriptionId,
      ridesUsed: { lt: sub.plan.ridesIncluded },
      status: 'active',
    },
    data: { ridesUsed: { increment: 1 } },
  });
  if (updated.count === 0) {
    // Re-read to give a more accurate error.
    const fresh = await tx.subscription.findUnique({ where: { id: subscriptionId }, select: { status: true, ridesUsed: true, plan: { select: { ridesIncluded: true } } } });
    if (fresh && fresh.status !== 'active') throw new BadRequestError('Subscription is no longer active');
    throw new BadRequestError('No rides remaining in subscription');
  }
}

// releaseRide atomically decrements subscription.ridesUsed when a ride is cancelled.
// Safe to call outside a transaction (uses its own atomic updateMany).
// Never decrements below zero (CAS guard).
export async function releaseRide(subscriptionId: string): Promise<void> {
  if (!subscriptionId) return;
  await db.subscription.updateMany({
    where: { id: subscriptionId, ridesUsed: { gt: 0 } },
    data: { ridesUsed: { decrement: 1 } },
  });
}
