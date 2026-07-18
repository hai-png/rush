import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { authenticator } from 'otplib';
import { db, schema } from '@addis/db';
import { hashPassword, verifyPassword, ConflictError, UnauthorizedError, NotFoundError, CURRENT_TOS_VERSION } from '@addis/shared';
import { createId } from '@paralleldrive/cuid2';

const JWT_SECRET = () => new TextEncoder().encode(process.env.NEXTAUTH_SECRET!);
const ACCESS_TTL = '30m';

export const identityService = {
  async registerRider(input: { phone: string; name: string; password: string; homeArea: string; workArea: string }) {
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.phone, input.phone));
    if (existing) throw new ConflictError('Phone already registered');
    return db.transaction(async (tx) => {
      const [user] = await tx.insert(schema.users).values({
        phone: input.phone, name: input.name, passwordHash: await hashPassword(input.password), role: 'rider',
      }).returning();
      const [profile] = await tx.insert(schema.riderProfiles).values({ userId: user.id, homeArea: input.homeArea, workArea: input.workArea }).returning();
      await tx.insert(schema.outboxEvents).values({ channel: 'sms', payload: { phone: input.phone, purpose: 'signup_verification' } });
      return { user, profile };
    });
  },

  async registerContractor(input: { phone: string; name: string; password: string; licenseNumber: string; experienceYears: number }) {
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.phone, input.phone));
    if (existing) throw new ConflictError('Phone already registered');
    return db.transaction(async (tx) => {
      const [user] = await tx.insert(schema.users).values({
        phone: input.phone, name: input.name, passwordHash: await hashPassword(input.password), role: 'contractor',
      }).returning();
      const [profile] = await tx.insert(schema.contractorProfiles).values({
        userId: user.id, licenseNumber: input.licenseNumber, experienceYears: input.experienceYears, verificationStatus: 'unverified',
      }).returning();
      return { user, profile };
    });
  },

  async login(phone: string, password: string, userAgent?: string, ip?: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.phone, phone));
    if (!user || !user.isActive || user.deletedAt) throw new UnauthorizedError('Invalid credentials');
    if (!(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedError('Invalid credentials');

    const jti = createId();
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600_000);
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
    return { user, jti: payload.jti as string };
  },

  async changePassword(userId: string, oldPw: string, newPw: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user) throw new NotFoundError('User not found');
    if (!(await verifyPassword(oldPw, user.passwordHash))) throw new UnauthorizedError('Current password incorrect');
    await db.update(schema.users).set({
      passwordHash: await hashPassword(newPw), tokenVersion: user.tokenVersion + 1, updatedAt: new Date(),
    }).where(eq(schema.users.id, userId)); // bumping tokenVersion revokes all other sessions
  },

  /** Mint a fresh access token for an already-authenticated session without re-checking password. */
  async reissueToken(userId: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user) throw new UnauthorizedError();
    const jti = createId();
    await db.insert(schema.sessions).values({ userId: user.id, jti, expiresAt: new Date(Date.now() + 30 * 24 * 3600_000) });
    return new SignJWT({ id: user.id, role: user.role, phone: user.phone, tokenVersion: user.tokenVersion, jti })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(ACCESS_TTL).sign(JWT_SECRET());
  },

  async resetPassword(phone: string, newPassword: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.phone, phone));
    if (!user) throw new NotFoundError('User not found');
    await db.update(schema.users).set({ passwordHash: await hashPassword(newPassword), tokenVersion: user.tokenVersion + 1, updatedAt: new Date() }).where(eq(schema.users.id, user.id));
  },

  async setup2fa(userId: string) {
    const secret = authenticator.generateSecret();
    await db.update(schema.users).set({ twoFactorSecret: secret }).where(eq(schema.users.id, userId));
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    const otpauth = authenticator.keyuri(user!.phone, 'Addis Ride', secret);
    return { secret, otpauth };
  },

  async verify2fa(userId: string, code: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user?.twoFactorSecret || !authenticator.check(code, user.twoFactorSecret)) throw new UnauthorizedError('Invalid 2FA code');
    await db.update(schema.users).set({ twoFactorEnabled: true }).where(eq(schema.users.id, userId));
    return { enabled: true };
  },

  async disable2fa(userId: string, password: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedError('Incorrect password');
    await db.update(schema.users).set({ twoFactorEnabled: false, twoFactorSecret: null }).where(eq(schema.users.id, userId));
  },
};
