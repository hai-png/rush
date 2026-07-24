import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { BadRequestError, ConflictError } from '@/lib/errors';

type TxClient = Prisma.TransactionClient;

// the corporate monthly seat allowance via a CAS on CorporateMember.ridesUsedThisMonth.
export async function consumeRide(
  tx: TxClient | typeof db,
  subscriptionId: string,
): Promise<void> {
  const sub = await tx.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, corporate: { select: { monthlySeatAllowance: true } } },
  });
  if (!sub) throw new BadRequestError('Subscription not found');
  if (sub.status !== 'active') throw new BadRequestError('Subscription not active');

  if (sub.corporateId && sub.corporate) {
    const allowance = sub.corporate.monthlySeatAllowance;
    const member = await tx.corporateMember.findUnique({
      where: { corporateId_userId: { corporateId: sub.corporateId, userId: sub.userId } },
      select: { id: true, isActive: true, deletedAt: true, approvalStatus: true, ridesUsedThisMonth: true },
    });
    if (member && member.isActive && !member.deletedAt && member.approvalStatus === 'approved') {
      const memberCas = await tx.corporateMember.updateMany({
        where: {
          id: member.id,
          ridesUsedThisMonth: { lt: allowance },
        },
        data: { ridesUsedThisMonth: { increment: 1 } },
      });
      if (memberCas.count === 0) {
        throw new ConflictError(`Corporate monthly seat allowance (${allowance}) reached`);
      }
    }
  }

  if (sub.plan.ridesIncluded === -1) {
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
    const fresh = await tx.subscription.findUnique({ where: { id: subscriptionId }, select: { status: true, ridesUsed: true, plan: { select: { ridesIncluded: true } } } });
    if (fresh && fresh.status !== 'active') throw new BadRequestError('Subscription is no longer active');
    throw new BadRequestError('No rides remaining in subscription');
  }
}

export async function releaseRide(subscriptionId: string): Promise<void> {
  if (!subscriptionId) return;
  const sub = await db.subscription.findUnique({
    where: { id: subscriptionId },
    select: { userId: true, corporateId: true },
  });
  if (!sub) return;
  await db.subscription.updateMany({
    where: { id: subscriptionId, ridesUsed: { gt: 0 } },
    data: { ridesUsed: { decrement: 1 } },
  });
  if (sub.corporateId) {
    await db.corporateMember.updateMany({
      where: {
        corporateId: sub.corporateId,
        userId: sub.userId,
        ridesUsedThisMonth: { gt: 0 },
      },
      data: { ridesUsedThisMonth: { decrement: 1 } },
    }).catch(() => {});
  }
}


