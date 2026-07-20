import { TypedOpenAPIHono } from '../../src/typed-hono';
import { timingSafeEqual } from 'node:crypto';
import { CRON_JOBS, withLock } from '../../src/cron-jobs';

export const cronRoutes = new TypedOpenAPIHono();

/**
 * Bearer-secret auth guard. The CRON_SECRET must be set (≥32 chars) — without
 * this check, an empty `expected` and an empty `provided` (no Authorization
 * header at all) both have length 0 and timingSafeEqual('', '') is true,
 * which would leave every cron endpoint — including data-deletion and
 * payment-reconciliation jobs — open with zero authentication.
 */
cronRoutes.use('*', async (c, next) => {
  const provided = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const expected = process.env.CRON_SECRET ?? '';
  if (expected.length < 32) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Cron secret not configured', requestId: c.get('requestId') } }, 401);
  const ok = provided.length === expected.length && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret', requestId: c.get('requestId') } }, 401);
  await next();
});

/**
 * Register one POST route per cron job, all using the shared `withLock` helper
 * and the shared `CRON_JOBS` registry. Adding a new cron job is now a one-line
 * change in `src/cron-jobs.ts` — no route file edit needed.
 *
 * Route shape: POST /api/v1/cron/<job-name>
 */
for (const job of CRON_JOBS) {
  cronRoutes.post(`/${job.route}`, async (c) => {
    const result = await withLock(job.name, job.run);
    return c.json(result);
  });
}

/** List the registered cron jobs (useful for debugging / observability). */
cronRoutes.get('/', async (c) => {
  return c.json({
    data: CRON_JOBS.map((j) => ({
      name: j.name,
      route: `/api/v1/cron/${j.route}`,
      intervalMs: j.intervalMs,
    })),
  });
});
