import { db } from '@/lib/db';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { BadRequestError, NotFoundError, ConflictError, ForbiddenError } from '@/lib/errors';

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
  if (!user) throw new NotFoundError('User not found');
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
  // Soft-delete: nullify PII immediately. Hard-delete runs after 30-day grace
  // period via the scheduler's hardDeleteStaleUsers job.
  await db.user.update({
    where: { id: session.id },
    data: {
      isActive: false,
      deletedAt: new Date(),
      phone: `deleted-${session.id}`,
      email: null,
      name: 'Deleted User',
      passwordHash: 'DELETED',
      tokenVersion: { increment: 1 },
      // also scrub 2FA secret + disable 2FA + clear lockout state.
      twoFactorSecret: null,
      twoFactorEnabled: false,
      phoneVerified: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  // Also delete 2FA backup codes immediately.
  await db.twoFactorBackupCode.deleteMany({ where: { userId: session.id } }).catch(() => {});
  await audit({
    actorId: session.id,
    action: 'user.deleted',
    entityType: 'user',
    entityId: session.id,
    ipAddress, userAgent,
  });
  // No notification enqueued — the user can no longer log in to see it.
  return { data: { ok: true } };
}

export async function GET_account({ session }: any) {
  const user = await db.user.findUnique({
    where: { id: session.id },
    include: { riderProfile: true, contractorProfile: true },
  });
  if (!user) throw new NotFoundError('User not found');
  const { passwordHash: _, twoFactorSecret: __, ...safe } = user;
  return { data: safe };
}


const UpdateAccountInput = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional().nullable(),
  // #4: optional rider profile fields. If provided, we upsert the RiderProfile
  // (creating it if missing) so riders can record their home/work areas for
  // route matching.
  homeArea: z.string().min(1).max(100).optional(),
  workArea: z.string().min(1).max(100).optional(),
});

export async function PATCH_account({ session, body, ipAddress, userAgent }: any) {
  const input = UpdateAccountInput.parse(body);
  const user = await db.user.findUnique({
    where: { id: session.id },
    include: { riderProfile: true },
  });
  if (!user) throw new NotFoundError('User not found');

  if (input.email !== undefined && input.email !== user.email) {
    if (input.email) {
      const existing = await db.user.findFirst({ where: { email: input.email, NOT: { id: session.id } } });
      // H-23 fix: don't reveal that the email is already registered via a
      // 409/400 error — an authenticated insider could enumerate the user base.
      // Instead, silently ignore the change and return 200. The caller can't
      // tell whether the email was taken or successfully updated. (A proper fix
      // would send a verification email to the new address and only swap after
      // verification, but that's a larger feature.)
      if (existing) {
        // Drop the email from the update payload so it's not written.
        input.email = user.email;
      }
    }
  }

  // #4: if homeArea or workArea provided, upsert the rider profile.
  const profileData: Record<string, string> = {};
  if (input.homeArea !== undefined) profileData.homeArea = input.homeArea;
  if (input.workArea !== undefined) profileData.workArea = input.workArea;
  if (Object.keys(profileData).length > 0) {
    // When creating, both fields are required by the schema — fall back to
    // empty string if only one is supplied on first creation.
    if (!user.riderProfile) {
      await db.riderProfile.create({
        data: {
          userId: session.id,
          homeArea: input.homeArea ?? '',
          workArea: input.workArea ?? '',
        },
      });
    } else {
      await db.riderProfile.update({
        where: { userId: session.id },
        data: profileData,
      });
    }
  }

  const before = user;
  const updated = await db.user.update({
    where: { id: session.id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.email !== undefined && { email: input.email }),
    },
    include: { riderProfile: true, contractorProfile: true },
  });
  await audit({
    actorId: session.id,
    action: 'account.updated',
    entityType: 'user',
    entityId: session.id,
    before: { name: before.name, email: before.email },
    after: input,
    ipAddress, userAgent,
  });
  const { passwordHash: _, twoFactorSecret: __, ...safe } = updated;
  return { data: safe };
}

// #5: PATCH /contractor/profile — contractor self-edits their profile.
// licenseNumber is unique; experienceYears must be non-negative; vehicleType
// is free-form (kept consistent with Shuttle.vehicleType values).
const ContractorProfileInput = z.object({
  licenseNumber: z.string().min(1).max(100).optional(),
  experienceYears: z.number().int().min(0).max(80).optional(),
  vehicleType: z.enum(['coaster', 'minibus', 'van', 'sedan']).optional(),
});

export async function PATCH_contractor_profile({ session, body, ipAddress, userAgent }: any) {
  if (session.role !== 'contractor' && session.role !== 'platform_admin') {
    throw new ForbiddenError('Contractor only');
  }
  const input = ContractorProfileInput.parse(body);

  const profile = await db.contractorProfile.findUnique({ where: { userId: session.id } });
  if (!profile) throw new NotFoundError('Contractor profile not found');

  // licenseNumber is @unique — check for collisions BEFORE updating so we can
  // raise a clean 409 instead of letting Prisma throw P2002.
  if (input.licenseNumber !== undefined && input.licenseNumber !== profile.licenseNumber) {
    const clash = await db.contractorProfile.findUnique({ where: { licenseNumber: input.licenseNumber } });
    if (clash) throw new ConflictError('License number already in use');
  }

  const before = profile;
  const updated = await db.contractorProfile.update({
    where: { userId: session.id },
    data: {
      ...(input.licenseNumber !== undefined && { licenseNumber: input.licenseNumber }),
      ...(input.experienceYears !== undefined && { experienceYears: input.experienceYears }),
      // L fix: vehicleType was in the Zod schema but never written to the DB.
      ...(input.vehicleType !== undefined && { vehicleType: input.vehicleType }),
    },
  });
  await audit({
    actorId: session.id,
    action: 'contractor.profile_updated',
    entityType: 'contractor_profile',
    entityId: profile.id,
    before: { licenseNumber: before.licenseNumber, experienceYears: before.experienceYears },
    after: input,
    ipAddress, userAgent,
  });
  return { data: updated };
}
