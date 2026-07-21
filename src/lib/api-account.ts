// Account — data export + soft-delete (with hard-delete blocked by app code).
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { enqueueNotification } from '@/lib/outbox';

export async function GET_export({ session }: any) {
  const [user, subs, payments, rides, tickets, notifications, sessions] = await Promise.all([
    db.user.findUnique({ where: { id: session.id }, include: { riderProfile: true, contractorProfile: true } }),
    db.subscription.findMany({ where: { userId: session.id }, include: { plan: true } }),
    db.payment.findMany({ where: { userId: session.id } }),
    db.ride.findMany({ where: { userId: session.id }, include: { trip: { include: { route: true } } } }),
    db.supportTicket.findMany({ where: { userId: session.id } }),
    db.notification.findMany({ where: { userId: session.id } }),
    db.session.findMany({ where: { userId: session.id } }),
  ]);
  if (!user) throw new Error('User not found');
  const { passwordHash: _, twoFactorSecret: __, ...safeUser } = user;
  return {
    data: {
      exportedAt: new Date().toISOString(),
      user: safeUser,
      subscriptions: subs,
      payments,
      rides,
      tickets,
      notifications,
      sessions,
    },
  };
}

export async function POST_delete({ session, ipAddress, userAgent }: any) {
  // Soft-delete only. Hard-delete is blocked because FKs would cascade unexpectedly.
  // Anonymize PII but keep the row for audit/financial integrity.
  await db.user.update({
    where: { id: session.id },
    data: {
      isActive: false,
      deletedAt: new Date(),
      phone: `deleted-${session.id}`,
      email: null,
      name: 'Deleted User',
      tokenVersion: { increment: 1 },
    },
  });
  await audit({
    actorId: session.id,
    action: 'user.deleted',
    entityType: 'user',
    entityId: session.id,
    ipAddress, userAgent,
  });
  await enqueueNotification({
    userId: session.id,
    type: 'general',
    title: 'Account scheduled for deletion',
    body: 'Your account has been deactivated. Data will be anonymized after 30 days.',
  });
  return { data: { ok: true } };
}
