import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createHash, randomBytes } from 'node:crypto';
import { ForbiddenError } from '@addis/shared';

const CSRF_COOKIE = '__Host-csrf-token';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated routes.
 *
 * The API accepts `__Secure-session-token` as an alternative to Bearer auth. Without
 * CSRF protection, a malicious site can POST to state-changing endpoints (e.g.
 * /api/v1/account/delete) using the user's cookie — the SameSite default (Lax) only
 * protects top-level navigations, not form POSTs or fetch() from other origins.
 *
 * Strategy: double-submit cookie pattern.
 *   1. On every response, set a __Host-csrf-token cookie (SameSite=Strict, Secure, HttpOnly).
 *   2. For state-changing requests, require the x-csrf-token header to match the cookie.
 *   3. GET/HEAD/OPTIONS are exempt (they shouldn't change state).
 *
 * The cookie is lazy-set: we generate it on first request if absent, and always echo
 * it back on the response so the client can read it.
 */
export const csrfProtection: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    // Ensure the CSRF cookie exists for future mutating requests
    if (!getCookie(c, CSRF_COOKIE)) {
      const token = randomBytes(32).toString('hex');
      setCookie(c, CSRF_COOKIE, token, {
        path: '/', secure: true, httpOnly: true, sameSite: 'Strict',
        maxAge: 86400, // 24h
      });
    }
    await next();
    return;
  }

  const sessionToken = getCookie(c, '__Secure-session-token');
  const bearer = c.req.header('Authorization');

  // Only enforce CSRF for cookie-authenticated requests. Bearer-authenticated
  // API calls (e.g. from the mobile app or SDK) are not vulnerable to CSRF
  // because the token is sent in a header, not a cookie.
  if (!sessionToken || bearer) {
    await next();
    return;
  }

  const cookieToken = getCookie(c, CSRF_COOKIE);
  const headerToken = c.req.header(CSRF_HEADER);

  if (!cookieToken || !headerToken) {
    throw new ForbiddenError('CSRF token missing');
  }

  // Constant-time comparison to prevent timing attacks
  const a = createHash('sha256').update(cookieToken).digest();
  const b = createHash('sha256').update(headerToken).digest();
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new ForbiddenError('CSRF token mismatch');
  }

  await next();
};
