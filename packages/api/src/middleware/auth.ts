import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { identityService } from '../../modules/identity/service';
import { UnauthorizedError } from '@addis/shared';

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  const cookieToken = getCookie(c, '__Secure-session-token');
  const token = bearer ?? cookieToken;
  if (token) {
    try {
      const { user, jti } = await identityService.verifySession(token);
      c.set('session', { userId: user.id, role: user.role, phone: user.phone, tosVersion: user.tosVersion, jti });
    } catch { /* leave session unset; route-level guard decides if 401 is required */ }
  }
  await next();
};

export function requireRole(...roles: string[]): MiddlewareHandler {
  return async (c, next) => {
    const session = c.get('session');
    if (!session) throw new UnauthorizedError();
    if (!roles.includes(session.role)) throw new UnauthorizedError('Insufficient role');
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
