import { db } from '@/lib/db';
import { z } from 'zod';
import { Money } from '@/lib/money';
import { NotFoundError, BadRequestError, ForbiddenError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { verifyAuditChain } from '@/lib/audit';
import { scheduleRefund } from '@/lib/payment-service';
import { enqueueNotification } from '@/lib/outbox';

export async function GET_users({ session }: any) {
  const users = await db.user.findMany({
    select: { id: true, phone: true, email: true, name: true, role: true, isActive: true, deletedAt: true, createdAt: true, phoneVerified: true, twoFactorEnabled: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return { data: users };
}

export async function GET_payments() {
  const payments = await db.payment.findMany({
    include: { user: { select: { name: true, phone: true } }, subscription: { include: { plan: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return { data: payments };
}

export async function GET_audit_logs() {
  const logs = await db.auditLog.findMany({
    include: { actor: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return { data: logs };
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

const TripInput = z.object({
  routeId: z.string().min(1),
  shuttleId: z.string().min(1),
  departureAt: z.string().datetime(),
  window: z.enum(['morning', 'evening']),
});

export async function POST_trips({ body, session, ipAddress, userAgent }: any) {
  const input = TripInput.parse(body);

  const shuttle = await db.shuttle.findUnique({ where: { id: input.shuttleId } });
  if (!shuttle) throw new NotFoundError('Shuttle not found');
  if (session.role === 'contractor' && shuttle.contractorId !== session.id) {
    throw new BadRequestError('You can only create trips on your own shuttles');
  }

  const route = await db.route.findUnique({ where: { id: input.routeId } });
  if (!route || !route.isActive) throw new NotFoundError('Route not found');

  const trip = await db.trip.create({
    data: {
      routeId: input.routeId,
      shuttleId: input.shuttleId,
      driverId: shuttle.contractorId,
      departureAt: new Date(input.departureAt),
      window: input.window,
      status: 'scheduled',
    },
    include: { route: true, shuttle: true },
  });
  await audit({ actorId: session.id, action: 'trip.created', entityType: 'trip', entityId: trip.id, after: input, ipAddress, userAgent });
  return { status: 201, data: trip };
}

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
  category: z.enum(['general', 'billing', 'routes', 'shuttle', 'account', 'corporate']),
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
