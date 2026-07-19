import type { MiddlewareHandler } from 'hono';
import type { Variables } from '../context';

type Env = { Variables: Variables };

/**
 * CSRF defense-in-depth. SameSite=Lax on the session cookie mitigates most
 * cross-site POST cases, but payment/subscription endpoints are cookie-authenticated
 * from the browser — an attacker who can plant a form on a third-party site could
 * still trigger a state-changing request if the browser sends the cookie.
 *
 * This middleware rejects any state-changing request (POST/PATCH/PUT/DELETE)
 * whose Origin or Referer header doesn't match the request's own Host. Browsers
 * always send Origin on cross-origin requests; same-origin requests have an
 * Origin that matches Host (or a Referer that does).
 *
 * Exemptions:
 *   - /api/v1/webhooks/* — Telebirr webhooks come from outside the browser;
 *     they're authenticated via RSA signature, not cookies.
 *   - /api/v1/cron/* — cron jobs are authenticated via CRON_SECRET bearer.
 *   - /api/v1/health, /api/v1/metrics — no state changes.
 */
const EXEMPT_PATHS = /^\/api\/v1\/(webhooks|cron|health|metrics|csp-report)/;
const STATE_CHANGING = /^(POST|PATCH|PUT|DELETE)$/;

export const csrfMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  if (!STATE_CHANGING.test(c.req.method)) return next();
  if (EXEMPT_PATHS.test(c.req.path)) return next();

  const origin = c.req.header('origin');
  const referer = c.req.header('referer');
  const host = c.req.header('host');
  // If neither Origin nor Referer is present, the request is likely non-browser
  // (e.g. a programmatic API client using Bearer auth). Allow it — the auth
  // middleware handles bearer-token validation.
  if (!origin && !referer) return next();

  const source = origin ?? referer;
  // Extract the host from the origin/referer URL.
  // Origin is "https://host:port" (no path); Referer is a full URL.
  let sourceHost: string | null = null;
  try {
    const url = new URL(source!);
    sourceHost = url.host;
  } catch {
    // Malformed Origin/Referer — reject defensively.
    return c.json({ error: { code: 'FORBIDDEN', message: 'Invalid Origin header', requestId: c.get('requestId') } }, 403);
  }

  if (host && sourceHost !== host) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Cross-origin request rejected', requestId: c.get('requestId') } }, 403);
  }

  await next();
};
