/**
 * Trustworthy client IP extraction.
 *
 * FIX (API-015 / META-013): All route handlers and auth callbacks must use
 * this helper instead of reading `x-forwarded-for` directly. The raw header
 * is the whole comma-separated list; the rightmost entry is the one set by
 * our trusted outermost proxy (Caddy).
 */

export function clientIp(c: { req: { header: (name: string) => string | undefined }; env?: { remoteAddr?: { address?: string } } }): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  const remote = c.env?.remoteAddr?.address;
  return remote ?? 'unknown';
}
