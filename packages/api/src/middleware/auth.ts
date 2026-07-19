import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { identityService } from '../../modules/identity/service';
import { UnauthorizedError, ForbiddenError, TWO_FA_REQUIRED_ROLES } from '@addis/shared';

// 2FA enforcement for high-privilege roles. The previous requireRole never
// checked 2FA — a platform_admin whose 2FA was disabled (e.g. by a previous
// compromise, or because they never set it up) retained full admin API
// access. Per TWO_FA_REQUIRED_ROLES in @addis/shared, platform_admin and
// corporate_admin MUST have 2FA enabled to use any route guarded by
// requireRole for those roles.
async function assertTwoFactor(userId: string, role: string): Promise<void> {
  if (!TWO_FA_REQUIRED_ROLES.includes(role as any)) return;
  // Defer the DB hit only when actually required. Cached session already
  // has the role, but we need the live twoFactorEnabled flag from the DB
  // — a user could have 2FA disabled since their session was issued.
  const { db, schema } = await import('@addis/db');
  const { eq } = await import('drizzle-orm');
  const [user] = await db.select({ twoFactorEnabled: schema.users.twoFactorEnabled })
    .from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.twoFactorEnabled) {
    throw new ForbiddenError('Two-factor authentication is required for this role. Enable it at /api/v1/auth/2fa/setup.');
  }
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  const cookieToken = getCookie(c, '__Secure-session-token');
  const token = bearer ?? cookieToken;
  if (token) {
    try {
      const { user, jti, impersonatedBy } = await identityService.verifySession(token);
      // Propagate impersonatedBy so route handlers and audit writers can
      // attribute actions to the admin, not the impersonated user. The
      // previous code read only user/jti and dropped impersonatedBy —
      // making impersonation invisible in audit logs after the initial
      // user.impersonated row.
      c.set('session', {
        userId: user.id, role: user.role, phone: user.phone,
        tosVersion: user.tosVersion, jti, impersonatedBy,
      });
    } catch (err) {
      // Distinguish "no/invalid token" (404) from "DB/Redis down" (5xx).
      // The previous `catch {}` silently swallowed EVERY error — an
      // outage during verifySession made every authenticated endpoint
      // look like "no token" with no log signal, leaving operators
      // blind during the worst possible moment.
      const logger = c.get('logger');
      if (logger && err instanceof Error && !(err as any).httpStatus) {
        // Don't log normal UnauthorizedError — those are expected on
        // unauthenticated requests and would flood logs.
        logger.warn({ err: err.message }, 'verifySession threw non-AppError; session left unset');
      }
    }
  }
  await next();
};

export function requireRole(...roles: string[]): MiddlewareHandler {
  return async (c, next) => {
    const session = c.get('session');
    if (!session) throw new UnauthorizedError();
    if (!roles.includes(session.role)) {
      // Insufficient role is 403 Forbidden, not 401 Unauthorized. The
      // previous code threw UnauthorizedError (401), which told the
      // client "you're not logged in" when they actually were — just
      // not privileged enough. Wrong status code misleads clients and
      // confuses monitoring dashboards.
      throw new ForbiddenError('Insufficient role');
    }
    // Enforce 2FA for high-privilege roles. Only checked for the roles
    // actually being required here, so a route that requires `rider`
    // doesn't pay the DB hit.
    for (const r of roles) {
      if ((TWO_FA_REQUIRED_ROLES as readonly string[]).includes(r)) {
        await assertTwoFactor(session.userId, session.role);
      }
    }
    await next();
  };
}

/** Any authenticated user, regardless of role. Use this — not a bare `c.get('session')` read —
 *  on every route that needs the caller's identity, so unauthenticated calls get a clean 401
 *  instead of a 500 from dereferencing an undefined session. */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!c.get('session')) throw new UnauthorizedError();
  await next();
};
