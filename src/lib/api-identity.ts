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

  const passwordHash = await hashPassword(input.password);

  // wrap user creation in try/catch to convert P2002 (unique violation)
  // on phone to a friendly ConflictError instead of an unhandled 500.
  try {
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
  } catch (err: any) {
    // convert P2002 unique violation on phone to friendly ConflictError.
    if (err?.code === 'P2002') throw new ConflictError('Phone already registered');
    throw err;
  }
}

const LoginInput = z.object({
  phone: z.string().refine(EthiopianPhone.isValid, 'Invalid Ethiopian phone'),
  password: z.string().min(1),
  code: z.string().length(6).optional(),
  backupCode: z.string().optional(), // P3-25: 10-char hex backup code
});

export async function POST_token({ body, ipAddress, userAgent }: any) {
  const input = LoginInput.parse(body);
  const phone = EthiopianPhone.normalize(input.phone);

  const user = await db.user.findUnique({ where: { phone } });
  if (!user || !user.isActive || user.deletedAt) {
    throw new UnauthorizedError('Invalid credentials');
  }

  // account lockout. After 5 failed attempts, lock for 15 min.
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
    // check for backup code first, then TOTP code.
    if (input.backupCode) {
      // Try to match a backup code.
      const candidates = await db.twoFactorBackupCode.findMany({
        where: { userId: user.id, usedAt: null },
      });
      let matched = false;
      for (const bc of candidates) {
        if (await verifyPassword(input.backupCode.toUpperCase(), bc.codeHash)) {
          // Mark as used.
          await db.twoFactorBackupCode.update({ where: { id: bc.id }, data: { usedAt: new Date() } });
          matched = true;
          break;
        }
      }
      if (!matched) {
        const newAttempts = user.failedLoginAttempts + 1;
        const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS;
        await db.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: newAttempts, ...(shouldLock ? { lockedUntil: new Date(Date.now() + LOCKOUT_MS) } : {}) },
        });
        throw new UnauthorizedError('Invalid backup code');
      }
    } else if (input.code) {
      if (!user.twoFactorSecret) throw new ForbiddenError('2FA enabled but no secret. Contact support.');
      const secret = decryptField(user.twoFactorSecret);
      if (!secret) throw new ForbiddenError('2FA secret could not be decrypted. Contact support.');
      if (!verifySync({ secret, token: input.code })) {
        const newAttempts = user.failedLoginAttempts + 1;
        const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS;
        await db.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: newAttempts, ...(shouldLock ? { lockedUntil: new Date(Date.now() + LOCKOUT_MS) } : {}) },
        });
        throw new UnauthorizedError('Invalid 2FA code');
      }
    } else {
      throw new TwoFactorRequiredError();
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

// POST /auth/logout-all — revoke every active session for the
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
  // block refresh for impersonation sessions — prevents TTL bypass.
  // The impersonation endpoint sets userAgent to 'impersonated-by:<adminId>'
  // and a 1-hour expiresAt. Allowing refresh would mint a fresh 30-day session
  // for the impersonated user, bypassing the TTL and losing the audit marker.
  const sessionRow = await db.session.findUnique({ where: { jti: session.jti }, select: { userAgent: true } });
  if (sessionRow?.userAgent?.startsWith('impersonated-by:')) {
    throw new ForbiddenError('Cannot refresh an impersonation session. Please sign in directly.');
  }
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
  const { oldPassword, newPassword, code } = z.object({
    oldPassword: z.string(),
    newPassword: z.string().min(10),
    code: z.string().length(6).optional(),
  }).parse(body);
  const user = await db.user.findUnique({ where: { id: session!.id } });
  if (!user) throw new UnauthorizedError();
  const ok = await verifyPassword(oldPassword, user.passwordHash);
  if (!ok) throw new UnauthorizedError('Current password incorrect');
  if (user.twoFactorEnabled) {
    if (!code) throw new BadRequestError('2FA code required to change password');
    const secret = decryptField(user.twoFactorSecret);
    if (!secret || !verifySync({ secret, token: code })) {
      throw new BadRequestError('Invalid 2FA code');
    }
  }
  const passwordHash = await hashPassword(newPassword);
  await db.user.update({ where: { id: user.id }, data: { passwordHash, tokenVersion: { increment: 1 } } });
  await revokeAllSessionsForUser(user.id);
  await audit({ actorId: user.id, action: 'user.password_change', entityType: 'user', entityId: user.id, ipAddress, userAgent });
  return { data: { ok: true } };
}

// Phone-change flow (request + confirm).
// Step 1: POST /account/phone/change/request — sends OTP to the NEW phone.
// Step 2: POST /account/phone/change/confirm — verifies OTP + updates user.phone.
// Both require the current session. The confirm step bumps tokenVersion so
// all other sessions are invalidated (the user must re-login on other devices).
const PhoneChangeRequestInput = z.object({
  newPhone: z.string().refine(EthiopianPhone.isValid, 'Invalid Ethiopian phone'),
});

export async function POST_phone_change_request({ session, body, ipAddress, userAgent }: any) {
  const input = PhoneChangeRequestInput.parse(body);
  const newPhone = EthiopianPhone.normalize(input.newPhone);

  // Reject if the new phone is already registered.
  const existing = await db.user.findUnique({ where: { phone: newPhone } });
  if (existing) throw new ConflictError('Phone number already registered');

  // Send OTP to the new phone.
  await sendOtp(newPhone, 'phone_change');
  await audit({ actorId: session.id, action: 'user.phone_change_requested', entityType: 'user', entityId: session.id, after: { newPhone }, ipAddress, userAgent });
  return { data: { ok: true, message: 'OTP sent to new phone number' } };
}

const PhoneChangeConfirmInput = z.object({
  newPhone: z.string().refine(EthiopianPhone.isValid, 'Invalid Ethiopian phone'),
  code: z.string().length(6),
});

export async function POST_phone_change_confirm({ session, body, ipAddress, userAgent }: any) {
  const input = PhoneChangeConfirmInput.parse(body);
  const newPhone = EthiopianPhone.normalize(input.newPhone);

  // Verify the OTP.
  await verifyOtp(newPhone, 'phone_change', input.code);

  // Reject if the new phone is already registered (race: someone could have
  // registered it between request and confirm).
  const existing = await db.user.findUnique({ where: { phone: newPhone } });
  if (existing) throw new ConflictError('Phone number already registered');

  const oldPhone = (await db.user.findUnique({ where: { id: session.id }, select: { phone: true } }))?.phone;
  // Update the phone + bump tokenVersion so all other sessions are invalidated.
  await db.user.update({
    where: { id: session.id },
    data: { phone: newPhone, tokenVersion: { increment: 1 }, phoneVerified: true },
  });
  await revokeAllSessionsForUser(session.id);
  await audit({ actorId: session.id, action: 'user.phone_changed', entityType: 'user', entityId: session.id, before: { phone: oldPhone }, after: { phone: newPhone }, ipAddress, userAgent });
  return { data: { ok: true, message: 'Phone number updated. Please sign in again with your new phone number.' } };
}

export async function GET_sessions({ session }: any) {
  const rows = await db.session.findMany({
    where: { userId: session!.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, userAgent: true, ipAddress: true, createdAt: true, expiresAt: true },
  });
  return { data: rows };
}

export async function DELETE_session({ session, params }: any) {
  await db.session.updateMany({
    where: { id: params.id, userId: session!.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { status: 204 };
}

// admin endpoints to list + revoke any user's sessions.
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
  // encrypt the secret at rest so DB read access (admin,
  // backup, SQL injection, CSV export) cannot recover the raw TOTP seed.
  const encrypted = encryptField(secret);
  await db.user.update({ where: { id: session!.id }, data: { twoFactorSecret: encrypted, twoFactorEnabled: true } });

  // generate 10 single-use backup codes. Stored bcrypt-hashed.
  const backupCodes: string[] = [];
  const { randomBytes } = await import('node:crypto');
  for (let i = 0; i < 10; i++) {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    backupCodes.push(raw);
  }
  // Hash all codes in parallel.
  const hashedCodes = await Promise.all(backupCodes.map(c => hashPassword(c)));
  await db.twoFactorBackupCode.createMany({
    data: hashedCodes.map(hash => ({
      userId: session!.id,
      codeHash: hash,
    })),
  });

  await audit({ actorId: session!.id, action: 'user.2fa_enabled', entityType: 'user', entityId: session!.id });
  return { data: { enabled: true, backupCodes } };
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
    // decrypt before verifying.
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
