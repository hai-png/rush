
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { BadRequestError } from '@/lib/errors';

type TxClient = Prisma.TransactionClient;

// consumeRide atomically increments subscription.ridesUsed with a CAS guard
// so two concurrent POST /rides calls can't both consume the last ride.
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
  // Atomic CAS: only increment if we haven't hit the cap.
  const updated = await tx.subscription.updateMany({
    where: { id: subscriptionId, ridesUsed: { lt: sub.plan.ridesIncluded } },
    data: { ridesUsed: { increment: 1 } },
  });
  if (updated.count === 0) {
    throw new BadRequestError('No rides remaining in subscription');
  }
}
