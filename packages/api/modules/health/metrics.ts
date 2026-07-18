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
  const auth = c.req.header('Authorization') ?? '';
  const expected = `Basic ${Buffer.from(`metrics:${process.env.METRICS_PASSWORD ?? ''}`).toString('base64')}`;
  const ok = auth.length === expected.length && timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
  if (!ok) return c.text('Unauthorized', 401);
  return c.text(await registry.metrics(), 200, { 'Content-Type': registry.contentType });
});
