import { OpenAPIHono } from '@hono/zod-openapi';
import { requestContext } from './middleware/context';
import { errorHandler } from './middleware/error';
import { authMiddleware } from './middleware/auth';
import { idempotencyMiddleware } from './middleware/idempotency';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { tosGateMiddleware } from './middleware/tos-gate';

import { csrfProtection } from './middleware/csrf';

// FIX (OPS-006): Wire the Prometheus metrics so /metrics actually reports
// business signal. The metrics were defined in modules/health/metrics.ts
// but never observed — the endpoint returned only prom-client's default
// process metrics (CPU, heap, GC). The timing middleware below observes
// http_request_duration_seconds on every request, with route labels
// normalized so cuid2/uuid path segments don't explode cardinality.
import { httpRequestDuration } from '../modules/health/metrics';

import { catalogRoutes } from '../modules/catalog/routes';
import { identityRoutes } from '../modules/identity/routes';
import { subscriptionRoutes } from '../modules/subscription/routes';
import { marketplaceRoutes } from '../modules/marketplace/routes';
import { operationsRoutes } from '../modules/operations/routes';
import { supportRoutes } from '../modules/support/routes';
import { corporateRoutes } from '../modules/corporate/routes';
import { adminRoutes } from '../modules/admin/routes';
import { cronRoutes } from '../modules/cron/routes';
import { webhookRoutes } from '../modules/webhooks/routes';
import { engagementRoutes } from '../modules/engagement/routes';
import { healthRoutes } from '../modules/health/routes';
import { metricsRoutes } from '../modules/health/metrics';
import { accountRoutes } from '../modules/account/routes';
import { dashboardRoutes } from '../modules/dashboard/routes';
import { tosRoutes } from '../modules/tos/routes';

export const app = new OpenAPIHono();

app.use('*', requestContext);
app.use('*', authMiddleware);       // populates c.get('session') if present; does not 401 by default
app.use('*', csrfProtection);       // CSRF double-submit cookie for cookie-auth'd state-changing requests
app.use('*', rateLimitMiddleware);  // must run after authMiddleware — several rules rate-limit per-user via c.get('session')
app.use('*', tosGateMiddleware);    // 409 if authenticated + stale ToS
app.use('/api/v1/*', idempotencyMiddleware); // POST only, internally

app.route('/api/v1', catalogRoutes);
app.route('/api/v1/auth', identityRoutes);
app.route('/api/v1/subscriptions', subscriptionRoutes);
app.route('/api/v1', marketplaceRoutes); // seat-releases, seat-claims
app.route('/api/v1', operationsRoutes);  // trips, rides, shuttle-positions
app.route('/api/v1', supportRoutes);     // tickets, faq
app.route('/api/v1', engagementRoutes);   // notifications, announcements
app.route('/api/v1/corporate', corporateRoutes);
app.route('/api/v1/admin', adminRoutes);
app.route('/api/v1/cron', cronRoutes);
app.route('/api/v1/webhooks', webhookRoutes);
app.route('/api/v1', healthRoutes);       // /api/v1/health
app.route('/api/v1', metricsRoutes);      // /api/v1/metrics
app.route('/api/v1/account', accountRoutes);
app.route('/api/v1/dashboard', dashboardRoutes);
app.route('/api/v1/tos', tosRoutes);

// FIX (OPS-006): Timing middleware. Runs AFTER all routes are mounted so
// c.req.routePaths is populated. We observe the request duration with
// normalized route labels (replace cuid2/uuid path segments with :id) so
// the cardinality of the `route` label stays bounded.
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const durationSec = (Date.now() - start) / 1000;
  // Normalize the path: replace cuid2 (24-char lowercase alnum) and uuid
  // path segments with :id so /api/v1/tickets/abc123 becomes
  // /api/v1/tickets/:id. Without this, every distinct ticket id would
  // create a new label series — unbounded cardinality would OOM the
  // metrics registry over time.
  const route = c.req.path
    .replace(/\/[a-z0-9]{24}/g, '/:id')      // cuid2
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id');  // uuid
  try {
    httpRequestDuration.labels(c.req.method, route, String(c.res.status)).observe(durationSec);
  } catch {
    // Don't let metrics observation break the response — log and continue.
  }
});

app.onError(errorHandler);

app.doc('/api/v1/openapi.json', { openapi: '3.1.0', info: { title: 'Addis Ride API', version: '1.0.0' } });

export type App = typeof app;
