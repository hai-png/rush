import * as Sentry from '@sentry/node';
import { loadEnv } from '@addis/shared';

loadEnv();

// Only init Sentry if DSN is present — typecheck with exactOptionalPropertyTypes
// requires `dsn: string` (not `string | undefined`), so we branch. The same
// applies to `environment`.
if (process.env.SENTRY_DSN) {
  const sentryOpts: Sentry.NodeOptions = {
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubEvent(event as unknown as Record<string, unknown>) as unknown as typeof event;
    },
  };
  if (process.env.NODE_ENV) sentryOpts.environment = process.env.NODE_ENV;
  Sentry.init(sentryOpts);
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
    delete (request.headers as Record<string, unknown>).authorization;
    delete (request.headers as Record<string, unknown>).cookie;
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
