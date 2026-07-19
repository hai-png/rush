import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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
 * Strategy: signed double-submit cookie pattern.
 *   1. On every response, set a __Host-csrf-token cookie (SameSite=Strict, Secure,
 *      NOT httpOnly — the client's JS must be able to read it to echo it back in
 *      the x-csrf-token header). The cookie value is a random 32-byte token.
 *   2. For state-changing requests, require the x-csrf-token header to match the
 *      cookie value (constant-time SHA-256 comparison).
 *   3. GET/HEAD/OPTIONS are exempt (they shouldn't change state).
 *
 * Why NOT httpOnly: the double-submit pattern requires the client's JavaScript to
 * read the cookie and echo it in the header. An httpOnly cookie is unreadable by
 * document.cookie, so no client JS could ever send the header — every cookie-auth
 * POST/PATCH/PUT/DELETE would 403. The security model of double-submit relies on
 * the attacker not being able to READ the cookie (cross-origin reads are blocked
 * by the Same-Origin Policy); XSS would already let an attacker make arbitrary
 * requests from the same origin, so httpOnly adds no protection against the threat
 * model CSRF defends against.
 *
 * Bearer-authenticated requests (mobile app, SDK) are exempt — the token is in a
 * header, not a cookie, so CSRF doesn't apply.
 */
export const csrfProtection: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    // Ensure the CSRF cookie exists for future mutating requests
    if (!getCookie(c, CSRF_COOKIE)) {
      const token = randomBytes(32).toString('hex');
      setCookie(c, CSRF_COOKIE, token, {
        path: '/', secure: true, httpOnly: false, sameSite: 'Strict',
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

  // Constant-time comparison via SHA-256 + timingSafeEqual. Hashing first
  // normalizes the length so timingSafeEqual won't throw on mismatched
  // buffer lengths, and the hash itself adds no security (it's just a
  // length-normalization step).
  const a = createHash('sha256').update(cookieToken).digest();
  const b = createHash('sha256').update(headerToken).digest();
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ForbiddenError('CSRF token mismatch');
  }

  await next();
};
