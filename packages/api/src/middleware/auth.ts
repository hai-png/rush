import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { identityService } from '../../modules/identity/service';
import { UnauthorizedError, ForbiddenError, TWO_FA_REQUIRED_ROLES, AppError } from '@addis/shared';

const TWO_FACTOR_CHECKED = Symbol('twoFactorChecked');
const PHONE_VERIFIED_CHECKED = Symbol('phoneVerifiedChecked');

async function assertTwoFactor(c: { get: (k: symbol) => unknown; set: (k: symbol, v: unknown) => void }, userId: string, role: string): Promise<void> {
  if (!TWO_FA_REQUIRED_ROLES.includes(role as any)) return;
  if (c.get(TWO_FACTOR_CHECKED)) return;
  const { db, schema } = await import('@addis/db');
  const { eq } = await import('drizzle-orm');
  const [user] = await db.select({ twoFactorEnabled: schema.users.twoFactorEnabled })
    .from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.twoFactorEnabled) {
    throw new ForbiddenError('Two-factor authentication is required for this role. Enable it at /api/v1/auth/2fa/setup.');
  }
  c.set(TWO_FACTOR_CHECKED, true);
}

async function assertPhoneVerified(c: { get: (k: symbol) => unknown; set: (k: symbol, v: unknown) => void }, userId: string, role: string): Promise<void> {
  if (!TWO_FA_REQUIRED_ROLES.includes(role as any)) return;
  if (c.get(PHONE_VERIFIED_CHECKED)) return;
  const { db, schema } = await import('@addis/db');
  const { eq } = await import('drizzle-orm');
  const [user] = await db.select({ phoneVerified: schema.users.phoneVerified })
    .from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.phoneVerified) {
    throw new ForbiddenError('Phone verification is required for this role. Verify your phone at /api/v1/auth/otp/send (purpose=signup_verification).');
  }
  c.set(PHONE_VERIFIED_CHECKED, true);
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  const cookieToken = getCookie(c, '__Secure-session-token');
  const token = bearer ?? cookieToken;

  if (token) {
    try {
      const { user, jti, impersonatedBy } = await identityService.verifySession(token);
      c.set('session', {
        userId: user.id, role: user.role, phone: user.phone,
        tosVersion: user.tosVersion, jti, impersonatedBy,
      });
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      const logger = c.get('logger');
      logger?.error({ err: (err as Error).message }, 'verifySession threw non-AppError; session left unset');
    }
  }
  await next();
};

export function requireRole(...roles: string[]): MiddlewareHandler {
  return async (c, next) => {
    const session = c.get('session');
    if (!session) throw new UnauthorizedError();
    if (!roles.includes(session.role)) {
      throw new ForbiddenError('Insufficient role');
    }
    await assertPhoneVerified(c, session.userId, session.role);
    await assertTwoFactor(c, session.userId, session.role);
    await next();
  };
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!c.get('session')) throw new UnauthorizedError();
  await next();
};
