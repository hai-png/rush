import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ForbiddenError } from '@addis/shared';

const CSRF_COOKIE = '__Host-csrf-token';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrfProtection: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {

    if (!getCookie(c, CSRF_COOKIE)) {
      const token = randomBytes(32).toString('hex');
      setCookie(c, CSRF_COOKIE, token, {
        path: '/', secure: true, httpOnly: false, sameSite: 'Strict',
        maxAge: 86400,
      });
    }
    await next();
    return;
  }

  const sessionToken = getCookie(c, '__Secure-session-token');
  const bearer = c.req.header('Authorization');

  if (!sessionToken || bearer) {
    await next();
    return;
  }

  const cookieToken = getCookie(c, CSRF_COOKIE);
  const headerToken = c.req.header(CSRF_HEADER);

  if (!cookieToken || !headerToken) {
    throw new ForbiddenError('CSRF token missing');
  }

  const a = createHash('sha256').update(cookieToken).digest();
  const b = createHash('sha256').update(headerToken).digest();
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ForbiddenError('CSRF token mismatch');
  }

  await next();
};
