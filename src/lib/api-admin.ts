import { db } from '@/lib/db';
import { z } from 'zod';
import { Money } from '@/lib/money';
import { NotFoundError, BadRequestError, ForbiddenError } from '@/lib/errors';
import { audit, verifyAuditChain } from '@/lib/audit';
import { scheduleRefund } from '@/lib/payment-service';
import { enqueueNotification } from '@/lib/outbox';
import { parsePagination, paginatedResponse } from '@/lib/pagination';

export async function GET_users({ session, query }: any) {
  // P1-56: cursor-based pagination.
  const page = parsePagination(query);
  const where: any = {};
  if (query?.role) where.role = query.role;
  if (query?.isActive !== undefined) where.isActive = query.isActive === 'true';
  if (query?.q) {
    where.OR = [
      { phone: { contains: query.q } },
      { name: { contains: query.q } },
      { email: { contains: query.q } },
    ];
  }
  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      select: { id: true, phone: true, email: true, name: true, role: true, isActive: true, deletedAt: true, createdAt: true, phoneVerified: true, twoFactorEnabled: true },
      orderBy: { createdAt: 'desc' },
      ...page.findManyArgs,
    }),
    db.user.count({ where }),
  ]);
  return paginatedResponse(users, total, page);
}

export async function GET_payments({ query }: any) {
  const page = parsePagination(query);
  const where: any = {};
  if (query?.status) where.status = query.status;
  if (query?.method) where.method = query.method;
  if (query?.userId) where.userId = query.userId;
  const [payments, total] = await Promise.all([
    db.payment.findMany({
      where,
      include: { user: { select: { name: true, phone: true } }, subscription: { include: { plan: true } } },
      orderBy: { createdAt: 'desc' },
      ...page.findManyArgs,
    }),
    db.payment.count({ where }),
  ]);
  return paginatedResponse(payments, total, page);
}

export async function GET_audit_logs({ query }: any) {
  const page = parsePagination(query);
  const where: any = {};
  if (query?.actorId) where.actorId = query.actorId;
  if (query?.action) where.action = { contains: query.action };
  if (query?.entityType) where.entityType = query.entityType;
  if (query?.entityId) where.entityId = query.entityId;
  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { actor: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      ...page.findManyArgs,
    }),
    db.auditLog.count({ where }),
  ]);
  return paginatedResponse(logs, total, page);
}

export async function GET_plans() {
  const plans = await db.subscriptionPlan.findMany({ orderBy: { sortOrder: 'asc' } });
  return { data: plans };
}

const PlanInput = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  priceCents: z.number().int().nonnegative(),
  ridesIncluded: z.number().int(),
  durationDays: z.number().int().positive(),
  isTrial: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
}).refine(v => !(v.isTrial && v.ridesIncluded === -1), 'Trial plans cannot be unlimited');

export async function POST_plans({ body, ipAddress, userAgent }: any) {
  const input = PlanInput.parse(body);
  const plan = await db.subscriptionPlan.create({ data: input });
  await audit({ action: 'plan.created', entityType: 'subscription_plan', entityId: plan.id, after: input, ipAddress, userAgent });
  return { status: 201, data: plan };
}

export async function GET_contractors() {
  const contractors = await db.contractorProfile.findMany({
    include: { user: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return { data: contractors };
}

export async function POST_verify_contractor({ params, body, session, ipAddress, userAgent }: any) {
  const { status, reason } = z.object({
    status: z.enum(['verified', 'rejected']),
    reason: z.string().optional(),
  }).parse(body);
  const profile = await db.contractorProfile.findUnique({ where: { id: params.id } });
  if (!profile) throw new NotFoundError('Contractor not found');
  await db.contractorProfile.update({
    where: { id: params.id },
    data: { verificationStatus: status, verificationReason: reason, verifiedById: session.id, verifiedAt: new Date() },
  });
  await audit({ actorId: session.id, action: 'contractor.verified', entityType: 'contractor_profile', entityId: params.id, after: { status, reason }, ipAddress, userAgent });
  return { data: { id: params.id, status } };
}

export async function GET_shuttles() {
  const shuttles = await db.shuttle.findMany({
    include: { contractor: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return { data: shuttles };
}

const ShuttleInput = z.object({
  contractorId: z.string().min(1),
  plate: z.string().min(1),
  model: z.string().min(1),
  vehicleType: z.enum(['coaster', 'minibus', 'van', 'sedan']),
  capacity: z.number().int().min(1).max(100),
  year: z.number().int().min(1990).max(new Date().getFullYear() + 1),
});

export async function POST_shuttles({ body, session, ipAddress, userAgent }: any) {
  const input = ShuttleInput.parse(body);
  if (session.role === 'contractor') {
    input.contractorId = session.id;
  } else if (!input.contractorId) {
    throw new BadRequestError('contractorId is required');
  }
  const shuttle = await db.shuttle.create({ data: input });
  await audit({ actorId: session.id, action: 'shuttle.created', entityType: 'shuttle', entityId: shuttle.id, after: input, ipAddress, userAgent });
  return { status: 201, data: shuttle };
}

export async function GET_routes() {
  const routes = await db.route.findMany({ orderBy: { origin: 'asc' } });
  return { data: routes };
}

const RouteInput = z.object({
  origin: z.string().min(1),
  destination: z.string().min(1),
  distanceKm: z.number().positive(),
  durationMin: z.number().int().positive(),
  fareCents: z.number().int().nonnegative(),
});

export async function POST_routes({ body, session, ipAddress, userAgent }: any) {
  const input = RouteInput.parse(body);
  const route = await db.route.create({ data: input });
  await audit({ actorId: session.id, action: 'route.created', entityType: 'route', entityId: route.id, after: input, ipAddress, userAgent });
  return { status: 201, data: route };
}

export async function GET_tickets() {
  const tickets = await db.supportTicket.findMany({
    include: { user: { select: { name: true, phone: true } }, _count: { select: { messages: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return { data: tickets };
}

export async function POST_ticket_message({ session, params, body }: any) {
  const { body: messageBody, status } = z.object({
    body: z.string().min(1).max(10_000),
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  }).parse(body);

  const ticket = await db.supportTicket.findUnique({ where: { id: params.id } });
  if (!ticket) throw new NotFoundError('Ticket not found');

  const msg = await db.$transaction(async (tx) => {
    const m = await tx.ticketMessage.create({ data: { ticketId: params.id, authorId: session.id, body: messageBody } });
    if (status) {
      await tx.supportTicket.update({ where: { id: params.id }, data: { status } });
    }
    return m;
  });

  if (ticket.userId !== session.id) {
    await enqueueNotification({
      userId: ticket.userId,
      type: 'support_reply',
      title: 'New reply on your ticket',
      body: messageBody.slice(0, 100),
      link: `/tickets/${ticket.id}`,
    });
  }

  return { status: 201, data: msg };
}

export async function POST_audit_verify() {
  const result = await verifyAuditChain();
  return { data: result };
}

export async function GET_payment({ params }: any) {
  const payment = await db.payment.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { id: true, name: true, phone: true, email: true } },
      subscription: { include: { plan: true } },
      seatClaim: { include: { seatRelease: { include: { trip: { include: { route: true } } } } } },
      refundRetries: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!payment) throw new NotFoundError('Payment not found');
  return { data: payment };
}

const RefundInput = z.object({
  amount: z.number().positive(),
  reason: z.string().min(1).max(500),
});

export async function POST_refund({ session, params, body, ipAddress, userAgent }: any) {
  const input = RefundInput.parse(body);
  // P0-18 / BIZ-013: admins cannot refund their own payments — conflict of interest
  // and a direct self-enrichment vector if the admin has a personal subscription.
  const payment = await db.payment.findUnique({ where: { id: params.id }, select: { userId: true } });
  if (!payment) throw new NotFoundError('Payment not found');
  if (payment.userId === session.id) {
    throw new ForbiddenError('Cannot refund your own payment');
  }
  await scheduleRefund(params.id, Money.fromETB(input.amount), input.reason);
  await audit({
    actorId: session.id,
    action: 'refund.admin_triggered',
    entityType: 'payment',
    entityId: params.id,
    after: { amount: input.amount, reason: input.reason },
    ipAddress, userAgent,
  });
  return { status: 202, data: { ok: true, message: 'Refund scheduled' } };
}

const PlanUpdateInput = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  priceCents: z.number().int().nonnegative().optional(),
  ridesIncluded: z.number().int().optional(),
  durationDays: z.number().int().positive().optional(),
  isTrial: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH_plan({ session, params, body, ipAddress, userAgent }: any) {
  const input = PlanUpdateInput.parse(body);
  const existing = await db.subscriptionPlan.findUnique({ where: { id: params.id } });
  if (!existing) throw new NotFoundError('Plan not found');
  if (input.isTrial === true && (input.ridesIncluded ?? existing.ridesIncluded) === -1) {
    throw new BadRequestError('Trial plans cannot be unlimited');
  }
  const updated = await db.subscriptionPlan.update({ where: { id: params.id }, data: input });
  await audit({ actorId: session.id, action: 'plan.updated', entityType: 'subscription_plan', entityId: params.id, after: input, ipAddress, userAgent });
  return { data: updated };
}

const RouteUpdateInput = z.object({
  origin: z.string().min(1).optional(),
  destination: z.string().min(1).optional(),
  distanceKm: z.number().positive().optional(),
  durationMin: z.number().int().positive().optional(),
  fareCents: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH_route({ session, params, body, ipAddress, userAgent }: any) {
  const input = RouteUpdateInput.parse(body);
  const existing = await db.route.findUnique({ where: { id: params.id } });
  if (!existing) throw new NotFoundError('Route not found');
  const updated = await db.route.update({ where: { id: params.id }, data: input });
  await audit({ actorId: session.id, action: 'route.updated', entityType: 'route', entityId: params.id, after: input, ipAddress, userAgent });
  return { data: updated };
}

const ShuttleUpdateInput = z.object({
  model: z.string().min(1).optional(),
  vehicleType: z.enum(['coaster', 'minibus', 'van', 'sedan']).optional(),
  capacity: z.number().int().min(1).max(100).optional(),
  year: z.number().int().min(1990).max(new Date().getFullYear() + 1).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH_shuttle({ session, params, body, ipAddress, userAgent }: any) {
  const input = ShuttleUpdateInput.parse(body);
  const existing = await db.shuttle.findUnique({ where: { id: params.id } });
  if (!existing) throw new NotFoundError('Shuttle not found');
  const updated = await db.shuttle.update({ where: { id: params.id }, data: input });
  await audit({ actorId: session.id, action: 'shuttle.updated', entityType: 'shuttle', entityId: params.id, after: input, ipAddress, userAgent });
  return { data: updated };
}

// Trip creation is handled by POST /trips in api-operations.ts.
// The previous POST /admin/trips duplicate was removed.

export async function GET_my_shuttles({ session }: any) {
  if (session.role !== 'contractor') throw new ForbiddenError('Contractor only');
  const shuttles = await db.shuttle.findMany({ where: { contractorId: session.id }, orderBy: { plate: 'asc' } });
  return { data: shuttles };
}

export async function GET_my_trips({ session }: any) {
  if (session.role !== 'contractor') throw new ForbiddenError('Contractor only');
  const trips = await db.trip.findMany({
    where: { driverId: session.id },
    include: { route: true, shuttle: true },
    orderBy: { departureAt: 'desc' },
    take: 50,
  });
  return { data: trips };
}

export async function recomputeContractorRating(contractorId: string): Promise<void> {
  const completedRides = await db.ride.count({
    where: { status: 'completed', trip: { driverId: contractorId } },
  });
  if (completedRides === 0) return;
  const cancelledRides = await db.ride.count({
    where: { status: 'cancelled', trip: { driverId: contractorId } },
  });
  const totalRides = completedRides + cancelledRides;
  if (totalRides === 0) return;
  const ratio = cancelledRides / totalRides;
  const rating = Math.max(3.0, Math.min(5.0, 5.0 - ratio * 2));
  await db.contractorProfile.update({
    where: { id: contractorId },
    data: { rating },
  });
}

const FaqInput = z.object({
  category: z.enum(['general', 'billing', 'route', 'shuttle', 'account', 'corporate', 'other']).default('general'),
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(5000),
  sortOrder: z.number().int().default(0),
});

export async function POST_faq({ session, body, ipAddress, userAgent }: any) {
  const input = FaqInput.parse(body);
  const faq = await db.faqArticle.create({ data: input });
  await audit({ actorId: session.id, action: 'faq.created', entityType: 'faq_article', entityId: faq.id, after: input, ipAddress, userAgent });
  return { status: 201, data: faq };
}

// P1 / API-017: soft-delete a plan (set isActive=false). Blocks if there are
// active subscriptions on it.
export async function DELETE_plan({ session, params, ipAddress, userAgent }: any) {
  const plan = await db.subscriptionPlan.findUnique({ where: { id: params.id } });
  if (!plan) throw new NotFoundError('Plan not found');
  const activeSubs = await db.subscription.count({ where: { planId: params.id, status: 'active' } });
  if (activeSubs > 0) {
    throw new BadRequestError(`Cannot delete plan with ${activeSubs} active subscription(s).`);
  }
  const before = plan;
  await db.subscriptionPlan.update({ where: { id: params.id }, data: { isActive: false } });
  await audit({ actorId: session.id, action: 'plan.deleted', entityType: 'subscription_plan', entityId: params.id, before, after: { isActive: false }, ipAddress, userAgent });
  return { data: { id: params.id, isActive: false } };
}

// P1 / API-017: hard-delete a FAQ (no FK dependencies).
export async function DELETE_faq({ session, params, ipAddress, userAgent }: any) {
  const faq = await db.faqArticle.findUnique({ where: { id: params.id } });
  if (!faq) throw new NotFoundError('FAQ not found');
  const before = faq;
  await db.faqArticle.delete({ where: { id: params.id } });
  await audit({ actorId: session.id, action: 'faq.deleted', entityType: 'faq_article', entityId: params.id, before, ipAddress, userAgent });
  return { data: { id: params.id, deleted: true } };
}

// ─── Holiday management ─────────────────────────────────────────────────────

export async function GET_holidays() {
  const holidays = await db.holiday.findMany({ where: { isActive: true }, orderBy: { date: 'asc' } });
  return { data: holidays };
}

const HolidayInput = z.object({
  date: z.string().datetime(),
  name: z.string().min(1).max(200),
});

export async function POST_holiday({ session, body, ipAddress, userAgent }: any) {
  const input = HolidayInput.parse(body);
  const date = new Date(input.date);
  date.setHours(0, 0, 0, 0); // normalize to midnight
  const holiday = await db.holiday.upsert({
    where: { date },
    update: { name: input.name, isActive: true },
    create: { date, name: input.name },
  });
  await audit({ actorId: session.id, action: 'holiday.created', entityType: 'holiday', entityId: holiday.id, after: input, ipAddress, userAgent });
  return { status: 201, data: holiday };
}

export async function DELETE_holiday({ session, params, ipAddress, userAgent }: any) {
  const holiday = await db.holiday.findUnique({ where: { id: params.id } });
  if (!holiday) throw new NotFoundError('Holiday not found');
  const before = holiday;
  await db.holiday.update({ where: { id: params.id }, data: { isActive: false } });
  await audit({ actorId: session.id, action: 'holiday.deleted', entityType: 'holiday', entityId: params.id, before, ipAddress, userAgent });
  return { data: { id: params.id, isActive: false } };
}
