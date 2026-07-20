# Worker Deployment Checklist

## INFRA-001: Vercel cron config is empty

The `vercel.json` `crons: []` array is empty. On a Vercel-only deployment,
**none of the cron jobs run** — subscriptions never auto-expire, refunds
never get retried, retention never enforced. The worker (`apps/worker`)
runs all cron jobs via `setInterval`, but Vercel doesn't host long-running
processes.

## Required: deploy the worker separately

The worker MUST be deployed as a long-running process on one of:

- **Railway** — `railway up` from repo root, set the start command to
  `bun run --cwd apps/worker src/index.ts`.
- **Render** — Web Service, build command `bun install --frozen-lockfile && bun run --filter=worker build`, start command same as Railway.
- **Fly.io** — `fly launch` with the `infra/Dockerfile.worker` image.
- **Self-hosted** — `docker compose up -d worker` using
  `infra/docker-compose.yml` (set `REDIS_URL`, `DATABASE_URL`, etc. via
  `.env`).

## Required env vars (worker)

The worker inherits the same env schema as the API (`packages/shared/src/env.ts`).
At minimum:

- `DATABASE_URL` — same as the API.
- `REDIS_URL` — same as the API. Must be Upstash (REST) or self-hosted Redis
  with `password` in the query string (see `infra/docker-compose.yml` comment).
- `NODE_ENV=production`
- `NEXTAUTH_SECRET`, `CRON_SECRET` — same as the API.
- `SENTRY_DSN` — for error reporting (the worker imports `@sentry/node`).
- `S3_*`, `TELEBIRR_*`, `AFRICAS_TALKING_*`, `RESEND_API_KEY`,
  `EXPO_ACCESS_TOKEN` — for the respective outbox handlers.

## Health check

The worker has no HTTP server. The Docker healthcheck uses
`pgrep -f "apps/worker"`. On Railway/Render, configure an equivalent
liveness probe (e.g. a custom script that checks the process is running
and the outbox depth is bounded).

## Detection: is the worker running?

If the worker is NOT running, the `outbox_events` table grows unboundedly.
Set up an alert on the `outbox_depth` Prometheus metric (exposed by the
API's `/metrics` endpoint) — if it exceeds 1000 for more than 10 minutes,
page the on-call engineer.

The worker also logs `Addis Ride worker started` on boot. If this log line
hasn't appeared in the last 5 minutes, the worker is down.

## Anti-pattern: don't run crons via Vercel

Vercel's cron feature is limited (free tier: 2 crons, daily/hourly only;
paid: more, but still limited). The worker has 15 cron jobs with intervals
ranging from 5 minutes to 24 hours. Don't try to map these to Vercel
crons — deploy the worker as a long-running process instead.
