export async function register() {
  const { loadEnv } = await import('@addis/shared');
  loadEnv();

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',

      sendDefaultPii: false,
      beforeSend(event) {
        return scrubEvent(event);
      },
    });
  }
}

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

  for (const key of Object.keys(event)) {
    if (key === 'request') continue;
    event[key] = scrubValue(event[key]);
  }
  return event;
}
