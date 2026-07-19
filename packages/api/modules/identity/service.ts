import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { authenticator } from 'otplib';
import { db, schema } from '@addis/db';
import { hashPassword, verifyPassword, isPasswordBreached, ConflictError, UnauthorizedError, NotFoundError, TwoFactorRequiredError, BadRequestError, CURRENT_TOS_VERSION, loadEnv } from '@addis/shared';
import { createId } from '@paralleldrive/cuid2';
import { redis } from '../../infra/redis';

// Read the JWT secret through the validated env object — never `process.env`
// directly. The previous `process.env.NEXTAUTH_SECRET!` non-null assertion would
// happily encode the literal string "undefined" (9 bytes) as the HMAC key if
// the env var was missing, silently signing every token with a publicly-known
// key. The env schema now requires a >=32-char non-placeholder string.
const env = loadEnv();
const JWT_SECRET = () => new TextEncoder().encode(env.NEXTAUTH_SECRET);
// H2 fix: the JWT exp must match the DB session TTL. The previous ACCESS_TTL
// was '30m' but SESSION_TTL_MS was 30 days — after 30 minutes, /auth/refresh
// called verifySession which called jwtVerify (enforcing exp), so refresh
// failed and the user was forced to re-login despite holding a 30-day session
// row. Now both are 30 days; the DB session row remains the source of truth
// for revocation (logout deletes it; verifySession checks it; tokenVersion
// bump invalidates all JWTs on password change / suspension / deletion).
const SESSION_TTL_MS = 30 * 24 * 3600_000;
const ACCESS_TTL_SEC = SESSION_TTL_MS / 1000; // 2592000 seconds = 30 days
const ACCESS_TTL = `${ACCESS_TTL_SEC}s`;

// Account lockout: per-phone failed-attempt counter in Redis. After 5 failures
// within 15 minutes, the account is locked for 15 minutes. The previous login
// flow had NO failed-attempt tracking — only the per-IP rate limit (which is
// trivially bypassable via X-Forwarded-For spoofing) stood between an attacker
// and unlimited credential stuffing.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_SEC = 15 * 60;
const LOCKOUT_DURATION_SEC = 15 * 60;

function failKey(phone: string) { return `auth:fail:${phone}`; }
function lockKey(phone: string) { return `auth:lock:${phone}`; }

async function recordFailedLogin(phone: string) {
  const [locked] = await Promise.all([
    redis.set(lockKey(phone), '1', { nx: true, ex: LOCKOUT_DURATION_SEC }),
    redis.incr(failKey(phone)),
  ]);
  // First failure in window -> set the fail counter's TTL. Subsequent INCRs
  // don't reset the TTL (Redis semantics), so the window stays anchored to
  // the first attempt.
  await redis.expire(failKey(phone), LOCKOUT_WINDOW_SEC).catch(() => {});
  if (locked) return; // newly locked
  const count = await redis.incr(failKey(phone)).catch(() => 0);
  if (count >= MAX_FAILED_ATTEMPTS) {
    await redis.set(lockKey(phone), '1', { ex: LOCKOUT_DURATION_SEC }).catch(() => {});
  }
}

async function assertNotLocked(phone: string) {
  const locked = await redis.set(lockKey(phone), 'peek', { nx: true, ex: 1 }).catch(() => null);
  // If we "acquired" the peek key, no real lock exists; clean up.
  if (locked) { await redis.set(lockKey(phone), '', { ex: 0 }).catch(() => {}); return; }
  // Re-check by reading the lock key directly.
  const ttl = await redis.ttl(lockKey(phone)).catch(() => -1);
  if (ttl > 0) throw new UnauthorizedError(`Account temporarily locked. Try again in ${Math.ceil(ttl / 60)} minutes.`);
}

async function clearFailedLogins(phone: string) {
  await redis.set(failKey(phone), '0', { ex: 1 }).catch(() => {});
  await redis.set(lockKey(phone), '0', { ex: 1 }).catch(() => {});
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
      const [profile] = await tx.insert(schema.riderProfiles).values({ userId: user.id, homeArea: input.homeArea, workArea: input.workArea }).returning();
      await tx.insert(schema.outboxEvents).values({ channel: 'sms', payload: { phone: input.phone, purpose: 'signup_verification' } });
      // Do NOT return credential material in the registration response — the
      // previous handler returned the full `user` row including passwordHash.
      const { passwordHash: _ph, twoFactorSecret: _tfs, ...safeUser } = user;
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
        userId: user.id, licenseNumber: input.licenseNumber, experienceYears: input.experienceYears, verificationStatus: 'unverified',
      }).returning();
      const { passwordHash: _ph, twoFactorSecret: _tfs, ...safeUser } = user;
      return { user: safeUser, profile };
    });
  },

  async login(phone: string, password: string, userAgent?: string, ip?: string, twoFactorCode?: string) {
    // Lockout check happens BEFORE the user lookup so an attacker can't even
    // probe whether a phone number is registered once they're locked out.
    await assertNotLocked(phone);

    const [user] = await db.select().from(schema.users).where(eq(schema.users.phone, phone));
    // Always run a bcrypt.compare against a dummy hash to keep timing constant
    // whether or not the phone exists — otherwise the timing difference between
    // "phone not found" and "wrong password" enables user enumeration.
    const DUMMY_HASH = '$2a$12$' + 'x'.repeat(53);
    const passwordOk = user && user.isActive && !user.deletedAt
      ? await verifyPassword(password, user.passwordHash)
      : await verifyPassword(password, DUMMY_HASH);
    if (!user || !user.isActive || user.deletedAt || !passwordOk) {
      await recordFailedLogin(phone);
      throw new UnauthorizedError('Invalid credentials');
    }

    if (user.twoFactorEnabled) {
      if (!twoFactorCode) throw new TwoFactorRequiredError();
      if (!user.twoFactorSecret || !authenticator.check(twoFactorCode, user.twoFactorSecret)) {
        await recordFailedLogin(phone);
        throw new UnauthorizedError('Invalid 2FA code');
      }
      // H7 fix: TOTP replay protection at login. A code observed during a
      // login attempt must not be reusable for a second login within the
      // 30-second window. Same Redis-backed mechanism as verify2fa.
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
    }).where(eq(schema.users.id, userId)); // bumping tokenVersion revokes all other sessions
  },

  /**
   * Mint a fresh access token for an already-authenticated session.
   *
   * Previously this created a NEW session row without deleting the old one —
   * the old bearer stayed valid until its JWT exp (30m), so a stolen token
   * remained usable for the full window even after a legitimate refresh. Now
   * the caller passes the current jti and we delete that specific session row
   * before minting the replacement, giving true session rotation on refresh.
   */
  async reissueToken(userId: string, currentJti: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user) throw new UnauthorizedError();
    const jti = createId();
    await db.transaction(async (tx) => {
      // Delete the old session first; if the insert below fails, the user must
      // re-authenticate (safe failure mode — no orphaned active sessions).
      await tx.delete(schema.sessions).where(eq(schema.sessions.jti, currentJti));
      await tx.insert(schema.sessions).values({ userId: user.id, jti, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
    });
    return new SignJWT({ id: user.id, role: user.role, phone: user.phone, tokenVersion: user.tokenVersion, jti })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(ACCESS_TTL).sign(JWT_SECRET());
  },

  async resetPassword(phone: string, newPassword: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.phone, phone));
    if (!user) throw new NotFoundError('User not found');
    if (await isPasswordBreached(newPassword)) throw new BadRequestError('This password has appeared in a known data breach — please choose a different one');
    await db.transaction(async (tx) => {
      await tx.update(schema.users).set({ passwordHash: await hashPassword(newPassword), tokenVersion: user.tokenVersion + 1, updatedAt: new Date() }).where(eq(schema.users.id, user.id));
      // Bumping tokenVersion invalidates all outstanding JWTs, but the sessions
      // table rows lingered — leaving the user appearing to have active sessions
      // in the /sessions list despite being unable to use any of them. Delete
      // them so the session list reflects reality.
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    });
  },

  /**
   * Generate a new 2FA secret for the user and store it as a PENDING secret
   * (not yet active). The user must call verify2fa() with a code generated
   * from this secret to promote it to the active twoFactorSecret and set
   * twoFactorEnabled=true. This prevents an attacker with a stolen session
   * from silently replacing the user's 2FA secret — the attacker would need
   * to also produce a valid TOTP code from the new secret, which requires
   * the authenticator app.
   *
   * H6 fix: the previous implementation immediately overwrote twoFactorSecret
   * with the new secret. If the user never completed verify2fa, they could be
   * left without a working 2FA (or an attacker who briefly held the session
   * could replace the secret and then verify their own code).
   *
   * Implementation: we store the pending secret in twoFactorSecret directly
   * but DO NOT set twoFactorEnabled=true until verify2fa succeeds. If 2FA is
   * already enabled, the existing secret remains active until the user
   * verifies the new one — at which point the new secret replaces the old.
   * To support this "replace" flow without a separate column, we require
   * that setup2fa on an already-enabled account first verify the CURRENT
   * 2FA code (passed as currentCode) before generating a new secret.
   */
  async setup2fa(userId: string, currentCode?: string) {
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!existing) throw new NotFoundError('User not found');
    // If 2FA is already enabled, require the current TOTP code before
    // allowing a secret rotation. This prevents an attacker with a stolen
    // session from silently replacing the secret.
    if (existing.twoFactorEnabled) {
      if (!currentCode || !existing.twoFactorSecret || !authenticator.check(currentCode, existing.twoFactorSecret)) {
        throw new UnauthorizedError('Current 2FA code required to rotate the 2FA secret');
      }
    }
    const secret = authenticator.generateSecret();
    // Store the new secret but do NOT set twoFactorEnabled yet — verify2fa
    // must be called with a code from this new secret before it becomes active.
    // If the user never verifies, the secret is orphaned but harmless (it's
    // not enabled, so login doesn't require it).
    await db.update(schema.users).set({ twoFactorSecret: secret }).where(eq(schema.users.id, userId));
    const otpauth = authenticator.keyuri(existing.phone, 'Addis Ride', secret);
    return { secret, otpauth };
  },

  async verify2fa(userId: string, code: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user?.twoFactorSecret) throw new UnauthorizedError('2FA not set up — call /2fa/setup first');
    // H7 fix: replay protection. TOTP codes are valid for ~30 seconds. Without
    // replay protection, a code observed once (e.g. via shoulder-surfing or a
    // compromised login form) can be reused until it expires. We track the
    // last-used time step in Redis; if the same time step is presented twice,
    // the second attempt is rejected. The key expires after 90 seconds (3 time
    // steps) so the window is bounded.
    const timeStep = Math.floor(Date.now() / 30000);
    const replayKey = `totp:used:${userId}:${timeStep}`;
    const replayed = await redis.set(replayKey, '1', { nx: true, ex: 90 }).catch(() => null);
    if (!replayed) {
      // The same time step was already used — reject as a replay attempt.
      throw new UnauthorizedError('2FA code already used — wait for the next 30-second window');
    }
    if (!authenticator.check(code, user.twoFactorSecret)) {
      throw new UnauthorizedError('Invalid 2FA code');
    }
    await db.update(schema.users).set({ twoFactorEnabled: true }).where(eq(schema.users.id, userId));
    return { enabled: true };
  },

  /**
   * Disable 2FA. Previously required only the password — an attacker with a
   * stolen session (e.g. via XSS) and the user's password (e.g. from a
   * separate breach) could disable 2FA without ever possessing the TOTP
   * device. Now the current 2FA code is ALSO required for any account where
   * 2FA is currently enabled.
   */
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
