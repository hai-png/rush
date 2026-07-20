export async function register() {
  const { loadEnv } = await import('@addis/shared');
  loadEnv(); // throws and crashes boot on invalid config — intentional fail-fast

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
      // FIX (INFRA-011): the previous init had no PII controls. Sentry's
      // defaults capture IP, request headers (including Authorization), and
      // request bodies — for a ride-hailing platform, those bodies contain
      // phone numbers, OTPs, and payment references. sendDefaultPii:false
      // turns off the auto-IP capture; the beforeSend hook scrubs the
      // remaining fields defensively (in case SDK upgrades add new auto-capture
      // paths) and walks the extra/contexts trees to drop fields whose names
      // match phone/email/password/token.
      sendDefaultPii: false,
      beforeSend(event) {
        return scrubEvent(event);
      },
    });
  }
}

/**
 * Recursively scrub PII from a Sentry event. Targets:
 *   - request.headers.authorization (Bearer tokens, basic-auth creds)
 *   - request.cookies (session cookies, CSRF tokens)
 *   - request.body (POST bodies — phone, OTP, payment refs)
 *   - any field whose key matches /phone|email|password|token/i (case-insensitive)
 *
 * The recursive walk covers `extra`, `contexts`, `request`, and any nested
 * objects. Values under matching keys are replaced with the string
 * `'[REDACTED]'` so the structure is preserved for debugging (you can still
 * see that a `phone` field was present, just not its value).
 */
const PII_KEY_RE = /phone|email|password|token/i;

function scrubValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(scrubValue);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEY_RE.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = scrubValue(v);
      }
    }
    return out;
  }
  return value;
}

function scrubEvent(event: Record<string, unknown>): Record<string, unknown> | null {
  if (!event || typeof event !== 'object') return event as Record<string, unknown> | null;

  // Always strip request.headers.authorization / request.cookies / request.body
  // wholesale — these are the highest-risk fields (credentials + request
  // payloads that may contain phone/OTP/payment refs).
  const request = (event.request ?? {}) as Record<string, unknown>;
  if (request.headers && typeof request.headers === 'object') {
    const headers = request.headers as Record<string, unknown>;
    delete headers.authorization;
    delete headers.cookie;
    delete headers['x-api-key'];
  }
  delete request.cookies;
  delete request.body;
  event.request = request;

  // Recursive scrub of the rest (extra, contexts, breadcrumbs, etc.) for any
  // field whose key matches /phone|email|password|token/i.
  for (const key of Object.keys(event)) {
    if (key === 'request') continue; // already handled
    event[key] = scrubValue(event[key]);
  }
  return event;
}
