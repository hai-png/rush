// Corporate endpoints:
//   POST /api/v1/corporate/onboard   — rider becomes corporate_admin + creates a corporate
//   POST /api/v1/corporate/invites   — corporate_admin generates an invite code
//   GET  /api/v1/corporate/invites   — list invites for the current corporate
//   POST /api/v1/corporate/signup    — rider joins a corporate via invite code (status: pending)
//   GET  /api/v1/corporate/members   — corporate_admin lists their members
//   POST /api/v1/corporate/members/:id/approve — approve a pending member
//   POST /api/v1/corporate/members/:id/reject  — reject a pending member
//   GET  /api/v1/corporate           — get the current corporate_admin's corporate
<<<<<<< HEAD
//
// Subsidy model: corporate has a subsidy_percent (0-100) + monthly_seat_allowance.
// When a rider subscribes via corporate code, the corporate pays the subsidized
// portion; the rider pays the rest. (For MVP, we just record the corporate
// association on the subscription; the subsidy math is the corporate's problem
// to reconcile off-platform.)
=======
>>>>>>> main

import { db } from '@/lib/db';
import { z } from 'zod';
import { BadRequestError, NotFoundError, ForbiddenError, ConflictError } from '@/lib/errors';
import { audit } from '@/lib/audit';
<<<<<<< HEAD
import { createId } from '@/lib/id';
=======
>>>>>>> main

const OnboardInput = z.object({
  name: z.string().min(2).max(100),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(8),
  subsidyPercent: z.number().int().min(0).max(100).default(50),
  monthlySeatAllowance: z.number().int().min(1).max(1000).default(20),
});

export async function POST_onboard({ session, body, ipAddress, userAgent }: any) {
  if (session.role !== 'rider' && session.role !== 'platform_admin') {
    throw new ForbiddenError('Only riders can onboard a corporate');
  }
  const input = OnboardInput.parse(body);

<<<<<<< HEAD
  // Check the user isn't already a corporate_admin
  const existing = await db.corporate.findUnique({ where: { adminUserId: session.id } });
  if (existing) throw new ConflictError('You already admin a corporate');

  // Generate a unique corporate code
  const code = await generateUniqueCode();

  // Promote the user to corporate_admin + create the corporate in one tx
=======
  const existing = await db.corporate.findUnique({ where: { adminUserId: session.id } });
  if (existing) throw new ConflictError('You already admin a corporate');

  const code = await generateUniqueCode();

>>>>>>> main
  const corp = await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: session.id }, data: { role: 'corporate_admin' } });
    return tx.corporate.create({
      data: {
        code,
        name: input.name,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        subsidyPercent: input.subsidyPercent,
        monthlySeatAllowance: input.monthlySeatAllowance,
        adminUserId: session.id,
      },
    });
  });

<<<<<<< HEAD
  // Auto-approve the admin as a member so they can subscribe at the subsidized rate too.
=======
>>>>>>> main
  await db.corporateMember.create({
    data: {
      corporateId: corp.id,
      userId: session.id,
      employeeId: 'ADMIN',
      approvalStatus: 'approved',
    },
  });

  await audit({
    actorId: session.id,
    action: 'corporate.onboarded',
    entityType: 'corporate',
    entityId: corp.id,
    after: { code, name: input.name },
    ipAddress, userAgent,
  });

  return {
    status: 201,
    data: { corporate: corp, message: 'You are now a corporate admin. Share the invite code with your employees.' },
  };
}

async function generateUniqueCode(): Promise<string> {
<<<<<<< HEAD
  // 8-char alphanumeric, no ambiguous chars (no 0/O/1/I)
=======
>>>>>>> main
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = '';
    for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    const existing = await db.corporate.findUnique({ where: { code }, select: { id: true } });
    if (!existing) return code;
  }
  throw new Error('Failed to generate unique corporate code');
}

export async function GET_current({ session }: any) {
  if (session.role !== 'corporate_admin' && session.role !== 'platform_admin') {
    throw new ForbiddenError('Corporate admin only');
  }
<<<<<<< HEAD
  const corp = await db.corporate.findUnique({
=======
  const corp = await db.corporate.findFirst({
>>>>>>> main
    where: session.role === 'platform_admin' ? {} : { adminUserId: session.id },
    include: {
      members: { include: { user: { select: { id: true, name: true, phone: true, email: true } } }, orderBy: { createdAt: 'desc' } },
      invites: { orderBy: { createdAt: 'desc' }, take: 20 },
      _count: { select: { subscriptions: true } },
    },
  });
  if (!corp) throw new NotFoundError('No corporate found');
  return { data: corp };
}

const InviteInput = z.object({
  note: z.string().max(200).optional(),
  maxUses: z.number().int().min(1).max(1000).default(50),
  expiresAt: z.string().datetime().optional(),
});

export async function POST_invite({ session, body, ipAddress, userAgent }: any) {
  if (session.role !== 'corporate_admin' && session.role !== 'platform_admin') {
    throw new ForbiddenError('Corporate admin only');
  }
  const input = InviteInput.parse(body);
  const corp = await db.corporate.findUnique({ where: { adminUserId: session.id } });
  if (!corp) throw new NotFoundError('No corporate found');

<<<<<<< HEAD
  // Generate a unique invite code (12 chars)
=======
>>>>>>> main
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 12; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];

  const invite = await db.corporateInvite.create({
    data: {
      corporateId: corp.id,
      code,
      createdById: session.id,
      note: input.note,
      maxUses: input.maxUses,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    },
  });
  await audit({
    actorId: session.id,
    action: 'corporate.invite_created',
    entityType: 'corporate_invite',
    entityId: invite.id,
    after: { code, maxUses: input.maxUses },
    ipAddress, userAgent,
  });
  return { status: 201, data: invite };
}

export async function GET_invites({ session }: any) {
  if (session.role !== 'corporate_admin' && session.role !== 'platform_admin') {
    throw new ForbiddenError('Corporate admin only');
  }
  const corp = await db.corporate.findUnique({ where: { adminUserId: session.id } });
  if (!corp) throw new NotFoundError('No corporate found');
  const invites = await db.corporateInvite.findMany({
    where: { corporateId: corp.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { data: invites };
}

const SignupInput = z.object({
  inviteCode: z.string().min(8).max(32),
  employeeId: z.string().min(1).max(50),
});

export async function POST_signup({ session, body, ipAddress, userAgent }: any) {
  if (session.role !== 'rider') {
    throw new ForbiddenError('Only riders can join a corporate');
  }
  const input = SignupInput.parse(body);

  const invite = await db.corporateInvite.findUnique({ where: { code: input.inviteCode } });
  if (!invite || !invite.isActive) throw new BadRequestError('Invalid invite code');
  if (invite.expiresAt && invite.expiresAt < new Date()) throw new BadRequestError('Invite expired');
  if (invite.usesCount >= invite.maxUses) throw new BadRequestError('Invite is full');

<<<<<<< HEAD
  // Check if the user is already a member of this (or any) corporate
=======
>>>>>>> main
  const existing = await db.corporateMember.findUnique({
    where: { corporateId_userId: { corporateId: invite.corporateId, userId: session.id } },
  });
  if (existing) {
    if (existing.approvalStatus === 'rejected') throw new ConflictError('Your previous request was rejected');
    if (existing.approvalStatus === 'approved') throw new ConflictError('You are already a member');
    throw new ConflictError('You already have a pending request');
  }

  const member = await db.$transaction(async (tx) => {
    const m = await tx.corporateMember.create({
      data: {
        corporateId: invite.corporateId,
        userId: session.id,
        employeeId: input.employeeId,
        approvalStatus: 'pending',
      },
    });
    await tx.corporateInvite.update({
      where: { id: invite.id },
      data: { usesCount: { increment: 1 } },
    });
    return m;
  });

  await audit({
    actorId: session.id,
    action: 'corporate.member_requested',
    entityType: 'corporate_member',
    entityId: member.id,
    after: { corporateId: invite.corporateId, employeeId: input.employeeId },
    ipAddress, userAgent,
  });

  return {
    status: 201,
    data: { member, message: 'Request submitted. Your corporate admin will approve you.' },
  };
}

export async function GET_members({ session }: any) {
  if (session.role !== 'corporate_admin' && session.role !== 'platform_admin') {
    throw new ForbiddenError('Corporate admin only');
  }
  const corp = await db.corporate.findUnique({ where: { adminUserId: session.id } });
  if (!corp) throw new NotFoundError('No corporate found');
  const members = await db.corporateMember.findMany({
    where: { corporateId: corp.id, deletedAt: null },
    include: { user: { select: { id: true, name: true, phone: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return { data: members };
}

export async function POST_approve({ session, params, ipAddress, userAgent }: any) {
  if (session.role !== 'corporate_admin' && session.role !== 'platform_admin') {
    throw new ForbiddenError('Corporate admin only');
  }
  const corp = await db.corporate.findUnique({ where: { adminUserId: session.id } });
  if (!corp) throw new NotFoundError('No corporate found');

  const member = await db.corporateMember.findUnique({ where: { id: params.id } });
  if (!member || member.corporateId !== corp.id) throw new NotFoundError('Member not found');
  if (member.approvalStatus !== 'pending') throw new ConflictError('Member is not pending');

  await db.corporateMember.update({
    where: { id: member.id },
    data: { approvalStatus: 'approved' },
  });
  await audit({
    actorId: session.id,
    action: 'corporate.member_approved',
    entityType: 'corporate_member',
    entityId: member.id,
    after: { userId: member.userId },
    ipAddress, userAgent,
  });
  return { data: { id: member.id, approvalStatus: 'approved' } };
}

export async function POST_reject({ session, params, ipAddress, userAgent }: any) {
  if (session.role !== 'corporate_admin' && session.role !== 'platform_admin') {
    throw new ForbiddenError('Corporate admin only');
  }
  const corp = await db.corporate.findUnique({ where: { adminUserId: session.id } });
  if (!corp) throw new NotFoundError('No corporate found');

  const member = await db.corporateMember.findUnique({ where: { id: params.id } });
  if (!member || member.corporateId !== corp.id) throw new NotFoundError('Member not found');
  if (member.approvalStatus !== 'pending') throw new ConflictError('Member is not pending');

  await db.corporateMember.update({
    where: { id: member.id },
    data: { approvalStatus: 'rejected' },
  });
  await audit({
    actorId: session.id,
    action: 'corporate.member_rejected',
    entityType: 'corporate_member',
    entityId: member.id,
    after: { userId: member.userId },
    ipAddress, userAgent,
  });
  return { data: { id: member.id, approvalStatus: 'rejected' } };
}

<<<<<<< HEAD
// Public: validate an invite code without joining (used by the signup form
// to show corporate name before the user commits).
=======
>>>>>>> main
export async function POST_validate_invite({ body }: any) {
  const { inviteCode } = z.object({ inviteCode: z.string() }).parse(body);
  const invite = await db.corporateInvite.findUnique({
    where: { code: inviteCode },
    include: { corporate: { select: { name: true, subsidyPercent: true, monthlySeatAllowance: true } } },
  });
  if (!invite || !invite.isActive) throw new NotFoundError('Invalid invite code');
  if (invite.expiresAt && invite.expiresAt < new Date()) throw new BadRequestError('Invite expired');
  if (invite.usesCount >= invite.maxUses) throw new BadRequestError('Invite is full');
  return { data: { corporateName: invite.corporate.name, subsidyPercent: invite.corporate.subsidyPercent, maxUses: invite.maxUses, usesCount: invite.usesCount } };
}
