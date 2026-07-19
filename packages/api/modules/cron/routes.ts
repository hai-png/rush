import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { TypedHono } from '../../src/typed-hono';
import { withLock, CRON_JOBS_BY_NAME } from '../../src/cron-jobs';

export const cronRoutes = new TypedHono();

/**
 * Authentication: every cron endpoint requires a Bearer token matching CRON_SECRET.
 *
 * The empty-string-vs-empty-string footgun: `timingSafeEqual('', '')` returns true, so
 * if CRON_SECRET is unset, an attacker sending no Authorization header at all (which the
 * regex below reduces to '') would authenticate successfully. We guard explicitly against
 * an unset/short secret and 401 instead.
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
 * Every cron job is mounted at POST /api/v1/cron/:name. The job name is looked up in
 * CRON_JOBS_BY_NAME (a shared registry also used by the worker). If the job name is
 * unknown, 404. If another instance is already running the job (advisory lock held),
 * the response is `{ skipped: true, reason: 'lock-held' }` with status 200 so the
 * scheduler doesn't alert on it.
 */
cronRoutes.post('/:name', async (c) => {
  const name = c.req.param('name');
  const job = CRON_JOBS_BY_NAME.get(name);
  if (!job) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Unknown cron job: ${name}`, requestId: c.get('requestId') } }, 404);
  }
  const result = await withLock(name, () => job.run());
  return c.json(result);
});
