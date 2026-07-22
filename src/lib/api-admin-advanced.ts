import { db } from '@/lib/db';
import { z } from 'zod';
import { NotFoundError, BadRequestError, ForbiddenError, ConflictError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { issueSession, assertTwoFactorEnabled } from '@/lib/auth';
import { createId } from '@/lib/id';

export async function GET_dashboard() {
  const [users, payments, subs, tickets, auditLogs, contractors, corporates, rides] = await Promise.all([
    db.user.count(),
    db.payment.count(),
    db.subscription.count(),
    db.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
    db.auditLog.count(),
    db.contractorProfile.count({ where: { verificationStatus: 'pending' } }),
    db.corporate.count({ where: { isActive: true } }),
    db.ride.count(),
  ]);
  const revenueResult = await db.payment.aggregate({ _sum: { amountCents: true }, where: { status: 'completed' } });
  const revenueCents = revenueResult._sum.amountCents ?? 0;
  return { data: { counts: { users, payments, subs, tickets, auditLogs, contractors, corporates, rides }, revenueCents, revenueETB: revenueCents / 100 } };
}

const UserActionInput = z.object({
  action: z.enum(['suspend', 'reactivate', 'change_role']).optional(),
  role: z.enum(['rider', 'contractor', 'corporate_admin', 'platform_admin']).optional(),
});

export async function PATCH_user({ session, params, body, ipAddress, userAgent }: any) {
  const input = UserActionInput.parse(body);
  const user = await db.user.findUnique({ where: { id: params.id } });
  if (!user) throw new NotFoundError('User not found');
  if (user.id === session.id) throw new BadRequestError('Cannot modify your own account');
  if (input.action === 'suspend') {
    await db.user.update({ where: { id: params.id }, data: { isActive: false, tokenVersion: { increment: 1 } } });
    await db.session.updateMany({ where: { userId: params.id, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => {});
    await audit({ actorId: session.id, action: 'user.suspended', entityType: 'user', entityId: params.id, ipAddress, userAgent });
  } else if (input.action === 'reactivate') {
    await db.user.update({ where: { id: params.id }, data: { isActive: true, deletedAt: null } });
    await audit({ actorId: session.id, action: 'user.reactivated', entityType: 'user', entityId: params.id, ipAddress, userAgent });
  } else if (input.action === 'change_role') {
    if (!input.role) throw new BadRequestError('role is required for change_role');
    // Enforce the 2FA + phone-verification gate for privileged roles —
    // same invariant as POST /corporate/onboard. Without this, an admin
    // could promote a non-2FA user to platform_admin and bypass the gate.
    if (input.role === 'corporate_admin' || input.role === 'platform_admin') {
      await assertTwoFactorEnabled(params.id, input.role);
    }
    if (input.role !== 'platform_admin') {
      const adminCount = await db.user.count({ where: { role: 'platform_admin', isActive: true } });
      const target = await db.user.findUnique({ where: { id: params.id } });
      if (target?.role === 'platform_admin' && adminCount <= 1) {
        throw new BadRequestError('Cannot demote the last platform admin');
      }
    }
    await db.user.update({ where: { id: params.id }, data: { role: input.role, tokenVersion: { increment: 1 } } });
    // Revoke existing sessions — the new role may have different access.
    await db.session.updateMany({ where: { userId: params.id, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => {});
    await audit({ actorId: session.id, action: 'user.role_changed', entityType: 'user', entityId: params.id, after: { role: input.role }, ipAddress, userAgent });
  } else {
    throw new BadRequestError('Unknown action');
  }
  return { data: { id: params.id, action: input.action } };
}

export async function POST_impersonate({ session, params, ipAddress, userAgent }: any) {
  if (session.role !== 'platform_admin') throw new ForbiddenError('Admin only');
  const target = await db.user.findUnique({ where: { id: params.id } });
  if (!target) throw new NotFoundError('User not found');
  if (target.role === 'platform_admin') throw new BadRequestError('Cannot impersonate another admin');
  const { token, jti } = await issueSession(target, { userAgent, ipAddress });
  await db.session.update({ where: { jti }, data: { userAgent: `impersonated-by:${session.id}` } });
  await audit({ actorId: session.id, action: 'user.impersonated', entityType: 'user', entityId: params.id, after: { jti }, ipAddress, userAgent });
  return { data: { accessToken: token, impersonated: true, targetUser: { id: target.id, phone: target.phone, role: target.role } } };
}

export async function GET_pending_contractors() {
  const contractors = await db.contractorProfile.findMany({ where: { verificationStatus: 'pending' }, include: { user: { select: { name: true, phone: true, email: true } } }, orderBy: { updatedAt: 'asc' } });
  return { data: contractors };
}

export async function POST_reject_contractor({ session, params, body, ipAddress, userAgent }: any) {
  const { reason } = z.object({ reason: z.string().min(1).max(500) }).parse(body);
  const profile = await db.contractorProfile.findUnique({ where: { id: params.id } });
  if (!profile) throw new NotFoundError('Contractor not found');
  await db.contractorProfile.update({ where: { id: params.id }, data: { verificationStatus: 'rejected', verificationReason: reason, verifiedById: session.id, verifiedAt: new Date() } });
  await audit({ actorId: session.id, action: 'contractor.rejected', entityType: 'contractor_profile', entityId: params.id, after: { reason }, ipAddress, userAgent });
  return { data: { id: params.id, status: 'rejected' } };
}

export async function GET_pending_corporates() {
  const corporates = await db.corporate.findMany({ where: { isActive: true, deletedAt: null }, include: { _count: { select: { members: true, subscriptions: true } } }, orderBy: { createdAt: 'desc' } });
  return { data: corporates };
}

export async function POST_activate_corporate({ session, params, ipAddress, userAgent }: any) {
  const corp = await db.corporate.findUnique({ where: { id: params.id } });
  if (!corp) throw new NotFoundError('Corporate not found');
  await db.corporate.update({ where: { id: params.id }, data: { isActive: true, deletedAt: null } });
  await audit({ actorId: session.id, action: 'corporate.activated', entityType: 'corporate', entityId: params.id, ipAddress, userAgent });
  return { data: { id: params.id, isActive: true } };
}

export async function GET_admin_subscriptions() {
  const subs = await db.subscription.findMany({ include: { user: { select: { name: true, phone: true, email: true } }, plan: true, corporate: { select: { name: true } }, _count: { select: { payments: true, rides: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  return { data: subs };
}

export async function POST_verify_payment({ session, params, body, ipAddress, userAgent }: any) {
  const { verifiedAmountCents } = z.object({ verifiedAmountCents: z.number().int().positive() }).parse(body);
  const payment = await db.payment.findUnique({ where: { id: params.id } });
  if (!payment) throw new NotFoundError('Payment not found');
  if (payment.status !== 'pending') throw new ConflictError('Payment is not pending');
  if (verifiedAmountCents !== payment.amountCents) {
    await db.payment.update({ where: { id: params.id }, data: { status: 'failed' } });
    await audit({ actorId: session.id, action: 'payment.amount_mismatch', entityType: 'payment', entityId: params.id, after: { expected: payment.amountCents, verified: verifiedAmountCents }, ipAddress, userAgent });
    throw new ConflictError('Verified amount does not match expected amount; payment marked failed');
  }
  // Delegate to settlePayment so seat-claim promotion, subscription activation,
  // notifications, and audit are all handled consistently with the webhook path.
  const { settlePayment } = await import('@/lib/payment-service');
  const { Money } = await import('@/lib/money');
  await settlePayment(payment.reference, Money.fromCents(verifiedAmountCents), `manual-verify-${Date.now()}`, 'Success', { manual: true, verifiedBy: session.id });
  await audit({ actorId: session.id, action: 'payment.manually_verified', entityType: 'payment', entityId: params.id, ipAddress, userAgent });
  return { data: { id: params.id, status: 'completed' } };
}

const EXPORT_TABLES: Record<string, { model: string; label: string }> = {
  users: { model: 'user', label: 'Users' },
  payments: { model: 'payment', label: 'Payments' },
  subscriptions: { model: 'subscription', label: 'Subscriptions' },
  rides: { model: 'ride', label: 'Rides' },
  tickets: { model: 'supportTicket', label: 'Tickets' },
  audit_logs: { model: 'auditLog', label: 'Audit Logs' },
};

export async function GET_export_csv({ session, params }: any) {
  const resource = params.resource;
  const config = EXPORT_TABLES[resource];
  if (!config) throw new BadRequestError('Unknown export resource');
  const model = (db as any)[config.model];
  const rows = await model.findMany({ take: 10000 });
  if (rows.length === 0) return { data: { csv: '', rowCount: 0 } };
  const headers = Object.keys(rows[0]);
  const csvLines = [headers.join(',')];
  const escapeCsv = (s: string): string => {
    // Prefix dangerous leading chars with a single quote to neutralize
    // CSV-formula injection (=cmd, +cmd, -cmd, @cmd, |cmd, \tcmd, \rcmd).
    let safe = s;
    if (/^[=+\-@\t\r]/.test(safe)) safe = `'${safe}`;
    if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
      safe = `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
  };
  for (const row of rows) {
    csvLines.push(headers.map((h: string) => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'object') return escapeCsv(JSON.stringify(v));
      return escapeCsv(String(v));
    }).join(','));
  }
  await audit({ actorId: session.id, action: 'admin.csv_export', entityType: 'export', entityId: resource, after: { rowCount: rows.length } });
  return { data: { csv: csvLines.join('\n'), rowCount: rows.length, resource } };
}

export async function DELETE_route({ session, params, ipAddress, userAgent }: any) {
  const route = await db.route.findUnique({ where: { id: params.id } });
  if (!route) throw new NotFoundError('Route not found');
  // Block soft-delete if there are upcoming trips — deactivating a route
  // mid-cycle strands riders with booked rides. Admin should cancel the
  // trips first (or wait for them to complete).
  const upcomingTrips = await db.trip.count({
    where: { routeId: params.id, status: 'scheduled', departureAt: { gt: new Date() } },
  });
  if (upcomingTrips > 0) {
    throw new BadRequestError(`Cannot deactivate route with ${upcomingTrips} upcoming scheduled trip(s). Cancel or complete them first.`);
  }
  await db.route.update({ where: { id: params.id }, data: { isActive: false } });
  await audit({ actorId: session.id, action: 'route.deleted', entityType: 'route', entityId: params.id, ipAddress, userAgent });
  return { data: { id: params.id, isActive: false } };
}

export async function DELETE_shuttle({ session, params, ipAddress, userAgent }: any) {
  const shuttle = await db.shuttle.findUnique({ where: { id: params.id } });
  if (!shuttle) throw new NotFoundError('Shuttle not found');
  // Same guard as routes — don't strand booked riders.
  const upcomingTrips = await db.trip.count({
    where: { shuttleId: params.id, status: 'scheduled', departureAt: { gt: new Date() } },
  });
  if (upcomingTrips > 0) {
    throw new BadRequestError(`Cannot deactivate shuttle with ${upcomingTrips} upcoming scheduled trip(s). Cancel or complete them first.`);
  }
  await db.shuttle.update({ where: { id: params.id }, data: { isActive: false } });
  await audit({ actorId: session.id, action: 'shuttle.deleted', entityType: 'shuttle', entityId: params.id, ipAddress, userAgent });
  return { data: { id: params.id, isActive: false } };
}

const SettingsInput = z.object({
  key: z.string().min(1).max(100),
  value: z.string(),
});

export async function GET_settings() {
  const rows = await db.setting.findMany();
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  return { data: settings };
}

export async function PUT_settings({ session, body, ipAddress, userAgent }: any) {
  const input = SettingsInput.parse(body);
  await db.setting.upsert({
    where: { key: input.key },
    update: { value: input.value },
    create: { key: input.key, value: input.value },
  });
  await audit({ actorId: session.id, action: 'system.settings', entityType: 'system', entityId: 'settings', after: input, ipAddress, userAgent });
  return { data: input };
}

const BulkExpireInput = z.object({ subscriptionIds: z.array(z.string()).min(1).max(100) });

export async function POST_bulk_expire({ session, body, ipAddress, userAgent }: any) {
  const input = BulkExpireInput.parse(body);
  const sideEffects: Array<() => Promise<void>> = [];
  const result = await db.subscription.updateMany({
    where: { id: { in: input.subscriptionIds }, status: 'active' },
    data: { status: 'expired' },
  });
  // Notify affected users + cancel their pending rides on now-expired subs.
  if (result.count > 0) {
    const expired = await db.subscription.findMany({
      where: { id: { in: input.subscriptionIds }, status: 'expired' },
      select: { id: true, userId: true },
    });
    for (const s of expired) {
      sideEffects.push(async () => {
        const { enqueueNotification } = await import('@/lib/outbox');
        await enqueueNotification({
          userId: s.userId,
          type: 'subscription_expired',
          title: 'Subscription expired',
          body: 'Your subscription has been expired by an admin. Renew to keep riding.',
          link: '/plans',
        }).catch(() => {});
      });
    }
    await db.ride.updateMany({
      where: { subscriptionId: { in: input.subscriptionIds }, status: 'booked' },
      data: { status: 'cancelled' },
    }).catch(() => {});
  }
  for (const fx of sideEffects) { try { await fx(); } catch {} }
  await audit({ actorId: session.id, action: 'admin.bulk_expire', entityType: 'subscription', after: { count: result.count }, ipAddress, userAgent });
  return { data: { expired: result.count } };
}

const BulkSuspendInput = z.object({ userIds: z.array(z.string()).min(1).max(100) });

export async function POST_bulk_suspend({ session, body, ipAddress, userAgent }: any) {
  const input = BulkSuspendInput.parse(body);
  const result = await db.user.updateMany({
    where: { id: { in: input.userIds }, role: { not: 'platform_admin' } },
    data: { isActive: false, tokenVersion: { increment: 1 } },
  });
  // Revoke all active sessions for the suspended users — otherwise their
  // existing JWTs stay valid for up to 30 days.
  if (result.count > 0) {
    await db.session.updateMany({
      where: { userId: { in: input.userIds }, revokedAt: null },
      data: { revokedAt: new Date() },
    }).catch(() => {});
  }
  await audit({ actorId: session.id, action: 'admin.bulk_suspend', entityType: 'user', after: { count: result.count }, ipAddress, userAgent });
  return { data: { suspended: result.count } };
}

const PriceUpdateInput = z.object({
  fareCents: z.number().int().nonnegative().optional(),
  distanceKm: z.number().positive().optional(),
  durationMin: z.number().int().positive().optional(),
});

export async function PATCH_route_price({ session, params, body, ipAddress, userAgent }: any) {
  const input = PriceUpdateInput.parse(body);
  const route = await db.route.findUnique({ where: { id: params.id } });
  if (!route) throw new NotFoundError('Route not found');
  const updated = await db.route.update({ where: { id: params.id }, data: input });
  await audit({ actorId: session.id, action: 'route.price_updated', entityType: 'route', entityId: params.id, after: input, ipAddress, userAgent });
  return { data: updated };
}
