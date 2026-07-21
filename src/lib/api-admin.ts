// Admin — users, payments, plans, contractors, shuttles, routes, tickets,
// audit logs. All routes require platform_admin role (enforced in the route table).
import { db } from '@/lib/db';
import { z } from 'zod';
import { Money } from '@/lib/money';
import { NotFoundError, BadRequestError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { verifyAuditChain } from '@/lib/audit';

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
  // Contractors can only create shuttles for themselves; admins can create for anyone.
  if (session.role === 'contractor' && input.contractorId !== session.id) {
    throw new BadRequestError('Contractors can only create shuttles for themselves');
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
  const msg = await db.$transaction(async (tx) => {
    const m = await tx.ticketMessage.create({ data: { ticketId: params.id, authorId: session.id, body: messageBody } });
    if (status) {
      await tx.supportTicket.update({ where: { id: params.id }, data: { status } });
    }
    return m;
  });
  return { status: 201, data: msg };
}

export async function POST_audit_verify() {
  const result = await verifyAuditChain();
  return { data: result };
}

// Keep Money import for future use (admin endpoints may need it).
void Money;
