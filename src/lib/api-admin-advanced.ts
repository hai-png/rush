import { db } from '@/lib/db';
import { z } from 'zod';
import { Money } from '@/lib/money';
import { NotFoundError, BadRequestError, ForbiddenError, ConflictError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { scheduleRefund } from '@/lib/payment-service';
import { enqueueNotification } from '@/lib/outbox';
import { issueSession } from '@/lib/auth';
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
    await db.user.update({ where: { id: params.id }, data: { isActive: false } });
    await audit({ actorId: session.id, action: 'user.suspended', entityType: 'user', entityId: params.id, ipAddress, userAgent });
  } else if (input.action === 'reactivate') {
    await db.user.update({ where: { id: params.id }, data: { isActive: true, deletedAt: null } });
    await audit({ actorId: session.id, action: 'user.reactivated', entityType: 'user', entityId: params.id, ipAddress, userAgent });
  } else if (input.action === 'change_role') {
    if (!input.role) throw new BadRequestError('role is required for change_role');
    await db.user.update({ where: { id: params.id }, data: { role: input.role } });
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
  await db.payment.update({ where: { id: params.id }, data: { status: 'completed' } });
  if (payment.subscriptionId) {
    const sub = await db.subscription.findUnique({ where: { id: payment.subscriptionId } });
    if (sub && sub.status === 'pending_payment') {
      await db.subscription.update({ where: { id: sub.id }, data: { status: 'active' } });
      await enqueueNotification({ userId: sub.userId, type: 'subscription_expiring', title: 'Subscription activated', body: `Your subscription is now active until ${new Date(sub.endDate).toLocaleDateString()}.`, link: '/dashboard/rider' });
    }
  }
  await audit({ actorId: session.id, action: 'payment.manually_verified', entityType: 'payment', entityId: params.id, ipAddress, userAgent });
  return { data: { id: params.id, status: 'completed' } };
}

const RefundInput = z.object({ paymentId: z.string().min(1), amount: z.number().positive(), reason: z.string().min(1).max(500) });

export async function POST_admin_refund({ session, body, ipAddress, userAgent }: any) {
  const input = RefundInput.parse(body);
  await scheduleRefund(input.paymentId, Money.fromETB(input.amount), input.reason);
  await audit({ actorId: session.id, action: 'refund.requested', entityType: 'payment', entityId: input.paymentId, after: input, ipAddress, userAgent });
  return { status: 202, data: { ok: true } };
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
  for (const row of rows) {
    csvLines.push(headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'object') return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
  }
  await audit({ actorId: session.id, action: 'admin.csv_export', entityType: 'export', entityId: resource, after: { rowCount: rows.length } });
  return { data: { csv: csvLines.join('\n'), rowCount: rows.length, resource } };
}

export async function DELETE_route({ session, params, ipAddress, userAgent }: any) {
  const route = await db.route.findUnique({ where: { id: params.id } });
  if (!route) throw new NotFoundError('Route not found');
  await db.route.update({ where: { id: params.id }, data: { isActive: false } });
  await audit({ actorId: session.id, action: 'route.deleted', entityType: 'route', entityId: params.id, ipAddress, userAgent });
  return { data: { id: params.id, isActive: false } };
}

export async function DELETE_shuttle({ session, params, ipAddress, userAgent }: any) {
  const shuttle = await db.shuttle.findUnique({ where: { id: params.id } });
  if (!shuttle) throw new NotFoundError('Shuttle not found');
  await db.shuttle.update({ where: { id: params.id }, data: { isActive: false } });
  await audit({ actorId: session.id, action: 'shuttle.deleted', entityType: 'shuttle', entityId: params.id, ipAddress, userAgent });
  return { data: { id: params.id, isActive: false } };
}

// ─── System settings ────────────────────────────────────────────────────────
const SettingsInput = z.object({
  key: z.string().min(1).max(100),
  value: z.string(),
});

export async function GET_settings() {
  const settings = await db.auditLog.findFirst({ where: { action: 'system.settings' }, orderBy: { createdAt: 'desc' } });
  return { data: settings ? JSON.parse(settings.after ?? '{}') : {} };
}

export async function PUT_settings({ session, body, ipAddress, userAgent }: any) {
  const input = SettingsInput.parse(body);
  await audit({ actorId: session.id, action: 'system.settings', entityType: 'system', entityId: 'settings', after: input, ipAddress, userAgent });
  return { data: input };
}

// ─── Bulk operations ────────────────────────────────────────────────────────
const BulkExpireInput = z.object({ subscriptionIds: z.array(z.string()).min(1).max(100) });

export async function POST_bulk_expire({ session, body, ipAddress, userAgent }: any) {
  const input = BulkExpireInput.parse(body);
  const result = await db.subscription.updateMany({ where: { id: { in: input.subscriptionIds }, status: 'active' }, data: { status: 'expired' } });
  await audit({ actorId: session.id, action: 'admin.bulk_expire', entityType: 'subscription', after: { count: result.count }, ipAddress, userAgent });
  return { data: { expired: result.count } };
}

const BulkSuspendInput = z.object({ userIds: z.array(z.string()).min(1).max(100) });

export async function POST_bulk_suspend({ session, body, ipAddress, userAgent }: any) {
  const input = BulkSuspendInput.parse(body);
  const result = await db.user.updateMany({ where: { id: { in: input.userIds }, role: { not: 'platform_admin' } }, data: { isActive: false } });
  await audit({ actorId: session.id, action: 'admin.bulk_suspend', entityType: 'user', after: { count: result.count }, ipAddress, userAgent });
  return { data: { suspended: result.count } };
}

// ─── Price management ───────────────────────────────────────────────────────
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
