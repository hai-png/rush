/**
 * Trustworthy client IP extraction.
 *
 * FIX (API-015): The rate-limit middleware had a correct `clientIp(c)`
 * implementation (rightmost XFF entry), but every route handler that
 * recorded `ipAddress` in audit logs / sessions read the raw
 * `x-forwarded-for` header directly — which is the whole comma-separated
 * list, or the leftmost (attacker-controlled) entry. An attacker can
 * spoof `X-Forwarded-For: 1.2.3.4, real.ip.here` and the audit log
 * records `1.2.3.4, real.ip.here` — useless for attribution.
 *
 * This shared helper is the single source of truth. Use it everywhere an
 * IP is recorded. Never read `c.req.header('x-forwarded-for')` directly.
 */

/**
 * Extract the trustworthy client IP from a Hono context.
 *
 * Behind any appending proxy (Caddy, nginx, AWS ALB, Cloudflare), the
 * RIGHTMOST XFF entry is the one set by OUR trusted outermost proxy. The
 * leftmost entry is the one the client sent (attacker-controlled).
 *
 * For multi-hop setups, configure TRUSTED_PROXY_HOPS and pick
 * parts[parts.length - trustedHops - 1] instead. The default (rightmost)
 * is correct for the typical Caddy → app on a private network topology.
 */
export function clientIp(c: { req: { header: (name: string) => string | undefined }; env?: { remoteAddr?: { address?: string } } }): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  // Fall back to the socket remote address if available — the source of
  // truth when there's no proxy in front.
  const remote = c.env?.remoteAddr?.address;
  return remote ?? 'unknown';
}
