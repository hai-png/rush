import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { setSessionCookie, clearSessionCookie } from '@/lib/api';
import { hashPassword, verifyPassword, issueSession, verifySession, revokeSession, revokeAllSessionsForUser } from '@/lib/auth';
import { EthiopianPhone } from '@/lib/phone';
import { BadRequestError, ConflictError, UnauthorizedError, TwoFactorRequiredError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { sendOtp, verifyOtp } from '@/lib/otp';
import { audit } from '@/lib/audit';
import { CURRENT_TOS_VERSION } from '@/lib/env';
import { decryptField, encryptField } from '@/lib/crypto-field';
import { generateSecret, verifySync } from 'otplib';

const RegisterInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rider'),
    name: z.string().min(2),
    phone: z.string().refine(EthiopianPhone.isValid, 'Invalid Ethiopian phone'),
    password: z.string().min(10),
    homeArea: z.string().min(1),
    workArea: z.string().min(1),
  }),
  z.object({
    kind: z.literal('contractor'),
    name: z.string().min(2),
    phone: z.string().refine(EthiopianPhone.isValid, 'Invalid Ethiopian phone'),
    password: z.string().min(10),
    licenseNumber: z.string().min(1),
    experienceYears: z.number().int().min(0),
  }),
]);

export async function POST_register({ body, ipAddress, userAgent }: any) {
  const input = RegisterInput.parse(body);
  const phone = EthiopianPhone.normalize(input.phone);
  const existing = await db.user.findUnique({ where: { phone } });
  if (existing) throw new ConflictError('Phone already registered');

  const passwordHash = await hashPassword(input.password);

  if (input.kind === 'rider') {
    const user = await db.user.create({
      data: {
        phone, passwordHash, name: input.name, role: 'rider',
        riderProfile: { create: { homeArea: input.homeArea, workArea: input.workArea } },
      },
      include: { riderProfile: true },
    });
    await audit({ actorId: user.id, action: 'user.register', entityType: 'user', entityId: user.id, after: { role: 'rider', phone }, ipAddress, userAgent });
    return { status: 201, data: { user: { id: user.id, phone: user.phone, role: user.role, name: user.name }, profile: { id: user.riderProfile!.id } } };
  } else {
    const user = await db.user.create({
      data: {
        phone, passwordHash, name: input.name, role: 'contractor',
        contractorProfile: { create: { licenseNumber: input.licenseNumber, experienceYears: input.experienceYears } },
      },
      include: { contractorProfile: true },
    });
    await audit({ actorId: user.id, action: 'user.register', entityType: 'user', entityId: user.id, after: { role: 'contractor', phone }, ipAddress, userAgent });
    return { status: 201, data: { user: { id: user.id, phone: user.phone, role: user.role, name: user.name }, profile: { id: user.contractorProfile!.id } } };
  }
}

const LoginInput = z.object({
  phone: z.string().refine(EthiopianPhone.isValid, 'Invalid Ethiopian phone'),
  password: z.string().min(1),
  code: z.string().length(6).optional(),
});

export async function POST_token({ body, ipAddress, userAgent }: any) {
  const input = LoginInput.parse(body);
  const phone = EthiopianPhone.normalize(input.phone);

  const user = await db.user.findUnique({ where: { phone } });
  if (!user || !user.isActive || user.deletedAt) {
    throw new UnauthorizedError('Invalid credentials');
  }

  // P1-8 / API-030: account lockout. After 5 failed attempts, lock for 15 min.
  const MAX_FAILED_ATTEMPTS = 5;
  const LOCKOUT_MS = 15 * 60_000;
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const retryAfter = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    throw new UnauthorizedError(`Account locked. Try again in ${retryAfter} seconds.`);
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    // Increment failed attempts; lock if threshold reached.
    const newAttempts = user.failedLoginAttempts + 1;
    const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: newAttempts,
        ...(shouldLock ? { lockedUntil: new Date(Date.now() + LOCKOUT_MS) } : {}),
      },
    });
    if (shouldLock) {
      await audit({ actorId: user.id, action: 'user.account_locked', entityType: 'user', entityId: user.id, after: { reason: 'max_failed_attempts' }, ipAddress, userAgent });
    }
    throw new UnauthorizedError('Invalid credentials');
  }

  if (user.twoFactorEnabled) {
    if (!input.code) throw new TwoFactorRequiredError();
    if (!user.twoFactorSecret) throw new ForbiddenError('2FA enabled but no secret. Contact support.');
    // P1-6 / SEC-013: decrypt the secret before verifying the TOTP code.
    const secret = decryptField(user.twoFactorSecret);
    if (!secret) throw new ForbiddenError('2FA secret could not be decrypted. Contact support.');
    if (!verifySync({ secret, token: input.code })) {
      // 2FA failure also counts toward lockout.
      const newAttempts = user.failedLoginAttempts + 1;
      const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: newAttempts,
          ...(shouldLock ? { lockedUntil: new Date(Date.now() + LOCKOUT_MS) } : {}),
        },
      });
      throw new UnauthorizedError('Invalid 2FA code');
    }
  }

  // Successful login — reset failed attempts + clear lockout.
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  const { token } = await issueSession(user, { userAgent, ipAddress });
  await audit({ actorId: user.id, action: 'user.login', entityType: 'user', entityId: user.id, ipAddress, userAgent });

  const res = NextResponse.json({
    data: {
      accessToken: token,
      expiresIn: 30 * 24 * 3600,
      user: { id: user.id, role: user.role, phone: user.phone },
      requiresTosAcceptance: user.tosVersion !== CURRENT_TOS_VERSION,
    },
  });
  await setSessionCookie(res, token);
  return res;
}

export async function POST_logout({ session }: any) {
  if (session) await revokeSession(session.jti);
  const res = NextResponse.json({ data: { ok: true } });
  await clearSessionCookie(res);
  return res;
}

// P1 / API-011: POST /auth/logout-all — revoke every active session for the
// current user. Useful when a user suspects their account is compromised
// (e.g. lost phone) and wants to invalidate all sessions at once.
export async function POST_logout_all({ session, ipAddress, userAgent }: any) {
  if (!session) throw new UnauthorizedError();
  await revokeAllSessionsForUser(session.id);
  await audit({ actorId: session.id, action: 'user.logout_all', entityType: 'user', entityId: session.id, ipAddress, userAgent });
  const res = NextResponse.json({ data: { ok: true } });
  await clearSessionCookie(res);
  return res;
}

export async function POST_refresh({ session, ipAddress, userAgent }: any) {
  if (!session) throw new UnauthorizedError();
  const user = await db.user.findUnique({ where: { id: session.id } });
  if (!user) throw new UnauthorizedError();
  const { token } = await issueSession(user, { userAgent, ipAddress });
  const res = NextResponse.json({ data: { accessToken: token, expiresIn: 30 * 24 * 3600 } });
  await setSessionCookie(res, token);
  await revokeSession(session.jti);
  return res;
}

export async function GET_me({ session }: any) {
  const user = await db.user.findUnique({ where: { id: session!.id }, include: { riderProfile: true, contractorProfile: true } });
  if (!user) throw new UnauthorizedError();
  const { passwordHash: _, twoFactorSecret: __, ...safe } = user;
  return { data: safe };
}

export async function POST_change_password({ session, body, ipAddress, userAgent }: any) {
  const { oldPassword, newPassword } = z.object({
    oldPassword: z.string(),
    newPassword: z.string().min(10),
  }).parse(body);
  const user = await db.user.findUnique({ where: { id: session!.id } });
  if (!user) throw new UnauthorizedError();
  const ok = await verifyPassword(oldPassword, user.passwordHash);
  if (!ok) throw new UnauthorizedError('Current password incorrect');
  const passwordHash = await hashPassword(newPassword);
  await db.user.update({ where: { id: user.id }, data: { passwordHash, tokenVersion: { increment: 1 } } });
  await revokeAllSessionsForUser(user.id);
  await audit({ actorId: user.id, action: 'user.password_change', entityType: 'user', entityId: user.id, ipAddress, userAgent });
  return { data: { ok: true } };
}

export async function GET_sessions({ session }: any) {
  const rows = await db.session.findMany({ where: { userId: session!.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  return { data: rows };
}

export async function DELETE_session({ session, params }: any) {
  await db.session.updateMany({
    where: { id: params.id, userId: session!.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { status: 204 };
}

// P1 / API-012: admin endpoints to list + revoke any user's sessions.
// Useful for incident response (e.g. suspected account compromise).
export async function GET_admin_user_sessions({ session, params }: any) {
  if (session.role !== 'platform_admin') throw new ForbiddenError('Admin only');
  const rows = await db.session.findMany({
    where: { userId: params.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, jti: true, userAgent: true, ipAddress: true, createdAt: true, expiresAt: true },
  });
  return { data: rows };
}

export async function DELETE_admin_user_session({ session, params }: any) {
  if (session.role !== 'platform_admin') throw new ForbiddenError('Admin only');
  const result = await db.session.updateMany({
    where: { id: params.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) throw new NotFoundError('Session not found or already revoked');
  await audit({ actorId: session.id, action: 'admin.session_revoked', entityType: 'session', entityId: params.id });
  return { status: 204 };
}

export async function POST_otp_send({ body }: any) {
  const { phone, purpose } = z.object({
    phone: z.string().refine(EthiopianPhone.isValid, 'Invalid Ethiopian phone'),
    purpose: z.enum(['signup_verification', 'password_reset', 'phone_change']),
  }).parse(body);
  const result = await sendOtp(phone, purpose);
  return { data: result };
}

export async function POST_otp_verify({ body }: any) {
  const { phone, purpose, code } = z.object({
    phone: z.string().refine(EthiopianPhone.isValid, 'Invalid Ethiopian phone'),
    purpose: z.enum(['signup_verification', 'password_reset', 'phone_change']),
    code: z.string().length(6),
  }).parse(body);
  await verifyOtp(phone, purpose, code);
  return { status: 204 };
}

export async function POST_phone_verify({ session, body }: any) {
  const { code } = z.object({ code: z.string().length(6) }).parse(body);
  const user = await db.user.findUnique({ where: { id: session!.id } });
  if (!user) throw new UnauthorizedError();
  await verifyOtp(user.phone, 'signup_verification', code);
  await db.user.update({ where: { id: user.id }, data: { phoneVerified: true } });
  await audit({ actorId: user.id, action: 'user.phone_verified', entityType: 'user', entityId: user.id });
  return { data: { phoneVerified: true } };
}

export async function POST_password_reset({ body }: any) {
  const { phone } = z.object({ phone: z.string().refine(EthiopianPhone.isValid, 'Invalid Ethiopian phone') }).parse(body);
  const result = await sendOtp(phone, 'password_reset');
  return { data: result };
}

export async function POST_password_reset_confirm({ body, ipAddress, userAgent }: any) {
  const { phone, code, newPassword } = z.object({
    phone: z.string().refine(EthiopianPhone.isValid, 'Invalid Ethiopian phone'),
    code: z.string().length(6),
    newPassword: z.string().min(10),
  }).parse(body);
  await verifyOtp(phone, 'password_reset', code);
  const user = await db.user.findUnique({ where: { phone: EthiopianPhone.normalize(phone) } });
  if (!user) throw new UnauthorizedError();
  const passwordHash = await hashPassword(newPassword);
  await db.user.update({ where: { id: user.id }, data: { passwordHash, tokenVersion: { increment: 1 } } });
  await revokeAllSessionsForUser(user.id);
  await audit({ actorId: user.id, action: 'user.password_reset', entityType: 'user', entityId: user.id, ipAddress, userAgent });
  return { status: 204 };
}

export async function POST_2fa_setup({ session, body }: any) {
  const { password } = z.object({ password: z.string().min(1) }).parse(body);
  const user = await db.user.findUnique({ where: { id: session!.id } });
  if (!user) throw new UnauthorizedError();
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new UnauthorizedError('Password incorrect');
  const secret = generateSecret();
  const otpauth = `otpauth://totp/AddisRide:${encodeURIComponent(user.phone)}?secret=${secret}`;
  return { data: { secret, otpauth } };
}

export async function POST_2fa_enable({ session, body }: any) {
  const { secret, code } = z.object({ secret: z.string(), code: z.string().length(6) }).parse(body);
  if (!verifySync({ secret, token: code })) throw new BadRequestError('Invalid code');
  // P1-6 / SEC-013: encrypt the secret at rest so DB read access (admin,
  // backup, SQL injection, CSV export) cannot recover the raw TOTP seed.
  const encrypted = encryptField(secret);
  await db.user.update({ where: { id: session!.id }, data: { twoFactorSecret: encrypted, twoFactorEnabled: true } });
  await audit({ actorId: session!.id, action: 'user.2fa_enabled', entityType: 'user', entityId: session!.id });
  return { data: { enabled: true } };
}

export async function POST_2fa_disable({ session, body }: any) {
  const { password, code } = z.object({ password: z.string(), code: z.string().length(6).optional() }).parse(body);
  const user = await db.user.findUnique({ where: { id: session!.id } });
  if (!user) throw new UnauthorizedError();
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new UnauthorizedError('Password incorrect');
  if (user.twoFactorEnabled) {
    if (!code) throw new BadRequestError('2FA code is required to disable 2FA');
    if (!user.twoFactorSecret) throw new BadRequestError('Invalid 2FA code');
    // P1-6: decrypt before verifying.
    const secret = decryptField(user.twoFactorSecret);
    if (!secret || !verifySync({ secret, token: code })) {
      throw new BadRequestError('Invalid 2FA code');
    }
  }
  await db.user.update({ where: { id: user.id }, data: { twoFactorSecret: null, twoFactorEnabled: false } });
  await audit({ actorId: user.id, action: 'user.2fa_disabled', entityType: 'user', entityId: user.id });
  return { status: 204 };
}

export async function POST_2fa_verify({ session, body }: any) {
  const { code } = z.object({ code: z.string().length(6) }).parse(body);
  const user = await db.user.findUnique({ where: { id: session!.id } });
  if (!user) throw new UnauthorizedError();
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    throw new BadRequestError('2FA is not enabled');
  }
  const secret = decryptField(user.twoFactorSecret);
  if (!secret || !verifySync({ secret, token: code })) {
    throw new BadRequestError('Invalid 2FA code');
  }
  return { data: { verified: true } };
}
