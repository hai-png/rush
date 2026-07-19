import { Hono } from 'hono';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { timingSafeEqual } from 'node:crypto';

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
  // Fail closed if METRICS_PASSWORD is unset: previously, `expected` would then become
  // `Basic bWV0cmljczp` (base64 of "metrics:"), which is publicly computable — any unauthenticated
  // caller who guessed the username "metrics" and an empty password would pass the
  // timingSafeEqual check and gain access to all Prometheus metrics (request rates, payment
  // counts, outbox depth, etc.). Refuse to serve metrics entirely until the operator sets a
  // real password.
  const password = process.env.METRICS_PASSWORD;
  if (!password || password.length < 16) {
    return c.text('Metrics endpoint disabled — METRICS_PASSWORD must be set to a value of at least 16 characters', 503);
  }
  const auth = c.req.header('Authorization') ?? '';
  const expected = `Basic ${Buffer.from(`metrics:${password}`).toString('base64')}`;
  // Length check first: timingSafeEqual throws on mismatched lengths, so we short-circuit.
  const ok = auth.length === expected.length && timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
  if (!ok) return c.text('Unauthorized', 401);
  return c.text(await registry.metrics(), 200, { 'Content-Type': registry.contentType });
});
