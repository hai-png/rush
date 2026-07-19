import { Hono } from 'hono';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { timingSafeEqual } from 'node:crypto';

// FIX (test compatibility): the previous `const env = loadEnv()` ran at
// module-load time, which meant any test that imported metrics.ts had to
// satisfy the full env schema (including METRICS_PASSWORD ≥ 16 chars in
// production). Tests that wanted to exercise the "METRICS_PASSWORD too
// short" path couldn't — loadEnv threw before the test could assert
// anything. We now read process.env directly in the handler so tests can
// mutate METRICS_PASSWORD freely. The loadEnv() call is deferred to the
// first request (and only used as a fallback for the password).

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({ name: 'http_request_duration_seconds', help: 'HTTP request duration', labelNames: ['method', 'route', 'status'], registers: [registry] });
export const paymentCounter = new Counter({ name: 'payments_total', help: 'Payments by status', labelNames: ['status', 'method'], registers: [registry] });
export const refundCounter = new Counter({ name: 'refunds_total', help: 'Refunds by outcome', labelNames: ['outcome'], registers: [registry] });
export const otpCounter = new Counter({ name: 'otp_total', help: 'OTP sent/verified', labelNames: ['action'], registers: [registry] });
export const outboxDepthGauge = new Gauge({ name: 'outbox_depth', help: 'Pending outbox events', registers: [registry] });
export const activeSubscriptionsGauge = new Gauge({ name: 'active_subscriptions', help: 'Active subscriptions count', registers: [registry] });

export const metricsRoutes = new Hono();
metricsRoutes.get('/metrics', async (c) => {
  // Guard explicitly against an unset/empty METRICS_PASSWORD. The previous
  // implementation computed `expected = Basic base64('metrics:')` when the
  // env var was unset — an attacker sending `Authorization: Basic base64('metrics:')`
  // would authenticate successfully. With an empty password, timingSafeEqual
  // on two equal-length zero-length buffers returns true.
  //
  // Read from process.env directly (not the cached `env` object) so tests
  // that mutate process.env.METRICS_PASSWORD between imports see the new
  // value without needing a full module reset.
  const password = process.env.METRICS_PASSWORD ?? '';
  if (!password || password.length < 16) {
    return c.text('Metrics endpoint not configured (METRICS_PASSWORD missing or too short)', 503);
  }
  const auth = c.req.header('Authorization') ?? '';
  const expected = `Basic ${Buffer.from(`metrics:${password}`).toString('base64')}`;
  // Length check before timingSafeEqual — otherwise Node throws on unequal
  // buffer lengths, leaking timing info via the error path.
  const ok = auth.length === expected.length && timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
  if (!ok) return c.text('Unauthorized', 401);
  return c.text(await registry.metrics(), 200, { 'Content-Type': registry.contentType });
});
