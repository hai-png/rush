import * as Sentry from '@sentry/node';
import { loadEnv } from '@addis/shared';

loadEnv(); // fail-fast on boot

/**
 * FIX (INFRA-011): the previous init had no PII controls. The worker handles
 * outbox events whose payloads routinely include phone numbers, email
 * addresses, payment references, and (for the audit channel) actor IDs +
 * entity IDs. Sentry's default auto-capture would ship all of that to the
 * Sentry servers — a GDPR / Proclamation 1321/2024 compliance problem on its
 * own (subprocessor transferring PII without a DPA), and a credential leak
 * risk if any payload ever includes a token (it shouldn't, but the scrubber
 * is the defense-in-depth).
 *
 * sendDefaultPii:false disables auto-IP capture and user-agent IP collection.
 * The beforeSend hook additionally scrubs:
 *   - request.headers.authorization / cookies / body
 *   - any field whose key matches /phone|email|password|token/i
 * See apps/web/instrumentation.ts for the full rationale (the same scrubber
 * is used in both runtimes; it's duplicated here rather than shared because
 * the worker and web have separate @sentry SDK imports and bundlers).
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend(event) {
    return scrubEvent(event as unknown as Record<string, unknown>) as unknown as typeof event;
  },
});

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
