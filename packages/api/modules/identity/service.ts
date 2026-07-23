import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { authenticator } from 'otplib';
import { db, schema } from '@addis/db';
import { hashPassword, verifyPassword, isPasswordBreached, ConflictError, UnauthorizedError, ForbiddenError, NotFoundError, TwoFactorRequiredError, BadRequestError, CURRENT_TOS_VERSION, loadEnv } from '@addis/shared';
import { createId } from '@paralleldrive/cuid2';
import { redis } from '../../infra/redis';
import { writeAudit } from '../admin/audit';

const env = loadEnv();
const JWT_SECRET = () => new TextEncoder().encode(env.NEXTAUTH_SECRET);

const SESSION_TTL_MS = 30 * 24 * 3600_000;
const ACCESS_TTL_SEC = SESSION_TTL_MS / 1000;
const ACCESS_TTL = `${ACCESS_TTL_SEC}s`;

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_SEC = 15 * 60;
const LOCKOUT_DURATION_SEC = 15 * 60;

const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuuO3zVYxYxYxYxYxYxYxYxYxYxYxYxYxY';

function failKey(phone: string) { return `auth:fail:${phone}`; }
function lockKey(phone: string) { return `auth:lock:${phone}`; }

async function recordFailedLogin(phone: string) {
  const count = await redis.incr(failKey(phone)).catch(() => 1);
  if (count === 1) {
    await redis.expire(failKey(phone), LOCKOUT_WINDOW_SEC).catch(() => {});
  }
  if (count >= MAX_FAILED_ATTEMPTS) {
    await redis.set(lockKey(phone), '1', { nx: true, ex: LOCKOUT_DURATION_SEC }).catch(() => {});
  }
}

async function assertNotLocked(phone: string) {
  const ttl = await redis.ttl(lockKey(phone)).catch(() => -1);
  if (ttl > 0) {
    throw new UnauthorizedError(`Account temporarily locked. Try again in ${Math.ceil(ttl / 60)} minutes.`);
  }
}

async function clearFailedLogins(phone: string) {
  await redis.del(failKey(phone)).catch(() => {});
}

export const identityService = {
  async registerRider(input: { phone: string; name: string; password: string; homeArea: string; workArea: string }) {
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.phone, input.phone));
    if (existing) throw new ConflictError('Phone already registered');
    if (await isPasswordBreached(input.password)) throw new BadRequestError('This password has appeared in a known data breach — please choose a different one');
    return db.transaction(async (tx) => {
      const [user] = await tx.insert(schema.users).values({
        phone: input.phone, name: input.name, passwordHash: await hashPassword(input.password), role: 'rider',
      }).returning();
      const [profile] = await tx.insert(schema.riderProfiles).values({ userId: user!.id, homeArea: input.homeArea, workArea: input.workArea }).returning();

      const { passwordHash: _ph, twoFactorSecret: _tfs, ...safeUser } = user!;
      return { user: safeUser, profile };
    });
  },

  async registerContractor(input: { phone: string; name: string; password: string; licenseNumber: string; experienceYears: number }) {
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.phone, input.phone));
    if (existing) throw new ConflictError('Phone already registered');
    if (await isPasswordBreached(input.password)) throw new BadRequestError('This password has appeared in a known data breach — please choose a different one');
    return db.transaction(async (tx) => {
      const [user] = await tx.insert(schema.users).values({
        phone: input.phone, name: input.name, passwordHash: await hashPassword(input.password), role: 'contractor',
      }).returning();
      const [profile] = await tx.insert(schema.contractorProfiles).values({
        userId: user!.id, licenseNumber: input.licenseNumber, experienceYears: input.experienceYears, verificationStatus: 'unverified',
      }).returning();
      const { passwordHash: _ph, twoFactorSecret: _tfs, ...safeUser } = user!;
      return { user: safeUser, profile };
    });
  },

  async login(phone: string, password: string, userAgent?: string, ip?: string, twoFactorCode?: string) {

    await assertNotLocked(phone);

    const [user] = await db.select().from(schema.users).where(eq(schema.users.phone, phone));

    const passwordOk = user && user.isActive && !user.deletedAt
      ? await verifyPassword(password, user.passwordHash)
      : await verifyPassword(password, DUMMY_HASH);
    if (!user || !user.isActive || user.deletedAt || !passwordOk) {
      await recordFailedLogin(phone);
      try {
        await db.transaction(async (tx) => {
          await writeAudit(tx as any, {
            actorId: null,
            action: 'auth.login_failed',
            entityType: 'auth',
            entityId: phone,
            after: { phone, ip: ip ?? null, userAgent: userAgent ?? null },
            ipAddress: ip ?? undefined,
            userAgent,
          });
        });
      } catch {}
      throw new UnauthorizedError('Invalid credentials');
    }

    if (user.twoFactorEnabled) {
      if (!twoFactorCode) throw new TwoFactorRequiredError();
      if (!user.twoFactorSecret || !authenticator.check(twoFactorCode, user.twoFactorSecret)) {
        await recordFailedLogin(phone);
        throw new UnauthorizedError('Invalid 2FA code');
      }

      const timeStep = Math.floor(Date.now() / 30000);
      const replayKey = `totp:used:${user.id}:${timeStep}`;
      const replayed = await redis.set(replayKey, '1', { nx: true, ex: 90 }).catch(() => null);
      if (!replayed) {
        await recordFailedLogin(phone);
        throw new UnauthorizedError('2FA code already used — wait for the next 30-second window');
      }
    }

    await clearFailedLogins(phone);

    const jti = createId();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.insert(schema.sessions).values({ userId: user.id, jti, userAgent, ipAddress: ip, expiresAt });

    const token = await new SignJWT({ id: user.id, role: user.role, phone: user.phone, tokenVersion: user.tokenVersion, jti })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(ACCESS_TTL).sign(JWT_SECRET());

    try {
      await db.transaction(async (tx) => {
        await writeAudit(tx as any, {
          actorId: user.id,
          action: 'auth.login_succeeded',
          entityType: 'auth',
          entityId: user.id,
          after: { jti, ip: ip ?? null, userAgent: userAgent ?? null },
          ipAddress: ip ?? undefined,
          userAgent,
        });
      });
    } catch {}

    return { user, accessToken: token, requiresTosAcceptance: user.tosVersion !== CURRENT_TOS_VERSION };
  },

  async verifySession(token: string) {
    const { payload } = await jwtVerify(token, JWT_SECRET());
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, payload.id as string));
    if (!user || user.tokenVersion !== payload.tokenVersion || !user.isActive || user.deletedAt) throw new UnauthorizedError();
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.jti, payload.jti as string));
    if (!session || session.expiresAt < new Date()) throw new UnauthorizedError('Session revoked');
    return { user, jti: payload.jti as string, impersonatedBy: (payload.impersonatedBy as string | undefined) ?? null };
  },

  async changePassword(userId: string, oldPw: string, newPw: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user) throw new NotFoundError('User not found');
    if (!(await verifyPassword(oldPw, user.passwordHash))) throw new UnauthorizedError('Current password incorrect');
    if (await isPasswordBreached(newPw)) throw new BadRequestError('This password has appeared in a known data breach — please choose a different one');
    await db.update(schema.users).set({
      passwordHash: await hashPassword(newPw), tokenVersion: user.tokenVersion + 1, updatedAt: new Date(),
    }).where(eq(schema.users.id, userId));
  },

  async reissueToken(userId: string, currentJti: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user) throw new UnauthorizedError();

    const [currentSession] = await db.select().from(schema.sessions).where(eq(schema.sessions.jti, currentJti));
    if (!currentSession) {
      throw new UnauthorizedError('Session not found — please log in again');
    }
    if (currentSession.impersonatedBy) {
      throw new ForbiddenError('Impersonation sessions cannot be refreshed — re-impersonate to continue');
    }
    const jti = createId();
    await db.transaction(async (tx) => {

      await tx.delete(schema.sessions).where(eq(schema.sessions.jti, currentJti));
      await tx.insert(schema.sessions).values({ userId: user.id, jti, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
    });
    return new SignJWT({ id: user.id, role: user.role, phone: user.phone, tokenVersion: user.tokenVersion, jti })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(ACCESS_TTL).sign(JWT_SECRET());
  },

  async resetPassword(phone: string, newPassword: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.phone, phone));
    if (!user || !user.isActive || user.deletedAt) {
      throw new NotFoundError('User not found');
    }
    if (await isPasswordBreached(newPassword)) throw new BadRequestError('This password has appeared in a known data breach — please choose a different one');
    await db.transaction(async (tx) => {
      await tx.update(schema.users).set({ passwordHash: await hashPassword(newPassword), tokenVersion: user.tokenVersion + 1, updatedAt: new Date() }).where(eq(schema.users.id, user.id));

      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    });
  },

  async setup2fa(userId: string, currentCode?: string, password?: string) {
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!existing) throw new NotFoundError('User not found');

    if (!password || !(await verifyPassword(password, existing.passwordHash))) {
      throw new UnauthorizedError('Current password is required to set up or rotate 2FA');
    }
    if (existing.twoFactorEnabled) {
      if (!currentCode || !existing.twoFactorSecret || !authenticator.check(currentCode, existing.twoFactorSecret)) {
        throw new UnauthorizedError('Current 2FA code required to rotate the 2FA secret');
      }
    }
    const secret = authenticator.generateSecret();

    await db.update(schema.users).set({ twoFactorSecret: secret }).where(eq(schema.users.id, userId));
    const otpauth = authenticator.keyuri(existing.phone, 'Addis Ride', secret);
    return { secret, otpauth };
  },

  async verify2fa(userId: string, code: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user?.twoFactorSecret) throw new UnauthorizedError('2FA not set up — call /2fa/setup first');

    const timeStep = Math.floor(Date.now() / 30000);
    const replayKey = `totp:used:${userId}:${timeStep}`;
    const replayed = await redis.set(replayKey, '1', { nx: true, ex: 90 }).catch(() => null);
    if (!replayed) {

      throw new UnauthorizedError('2FA code already used — wait for the next 30-second window');
    }
    if (!authenticator.check(code, user.twoFactorSecret)) {
      throw new UnauthorizedError('Invalid 2FA code');
    }
    await db.update(schema.users).set({ twoFactorEnabled: true }).where(eq(schema.users.id, userId));
    return { enabled: true };
  },

  async disable2fa(userId: string, password: string, twoFactorCode?: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedError('Incorrect password');
    if (user.twoFactorEnabled) {
      if (!twoFactorCode || !user.twoFactorSecret || !authenticator.check(twoFactorCode, user.twoFactorSecret)) {
        throw new UnauthorizedError('Invalid 2FA code');
      }
    }
    await db.update(schema.users).set({ twoFactorEnabled: false, twoFactorSecret: null }).where(eq(schema.users.id, userId));
  },
};
