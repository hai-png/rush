# Addis Ride — Production Deployment

This document describes the production deployment story for Addis Ride. The
platform is a Bun + Turbo monorepo with four deployable units:

| Unit | Image | Target | Notes |
|------|-------|--------|-------|
| `apps/web` (Next.js) | `infra/Dockerfile.web` | **Vercel** | Edge-deployed; See `vercel.json` at repo root. |
| `apps/worker` (outbox drainer + cron) | `infra/Dockerfile.worker` | **Fly.io** or **Railway** | Long-running process; needs DB + Redis + S3 connectivity. |
| Postgres 16 | managed | **Fly.io Postgres** or **Hetzner + managed Postgres** | 7-year audit/payment retention — choose a plan with enough storage. |
| Redis 7 | managed | **Upstash** (TLS, REST compatible) or self-hosted on Fly | Must support `EVAL` for the rate-limit / OTP-lock scripts. |
| MinIO (S3-compatible object store) | managed | **Hetzner Storage Box** with MinIO gateway, or **Wasabi** | Holds contractor documents + audit/payment JSONL archives. |
| Caddy (reverse proxy / TLS) | `infra/Caddyfile` | co-located with worker | Terminates TLS, forwards to `apps/web` on Vercel via Vercel's edge. |

## Why this layout

- **Vercel for `apps/web`**: Next.js is first-class on Vercel; we get ISR,
  edge functions, and automatic preview deploys per PR. The Next.js app is
  stateless (no server-side sessions — JWT in httpOnly cookies), so it
  scales horizontally without sticky sessions.
- **Fly.io / Railway for `apps/worker`**: The worker is a long-running Bun
  process (`apps/worker/src/index.ts`) that drains the outbox every 5s and
  runs cron jobs on `setInterval`. It cannot run on Vercel (serverless
  functions have a 10–60s cap). Fly.io's `process` deployment model is a
  good fit; Railway's worker dyno is equivalent.
- **Postgres**: 7-year retention of audit logs + payments + contractor
  documents metadata requires durable, managed storage with point-in-time
  recovery. Fly.io Postgres has automated PITR; Hetzner + pgBackRest is the
  self-managed alternative (see `infra/backup-restore.md`).
- **Redis**: Used for rate-limit counters, OTP-send locks, cron advisory
  locks, and idempotency dedup. Must be TLS-reachable from both Vercel
  edge functions (REST/Upstash) and the Fly worker (native Redis). Upstash
  is the easiest way to satisfy both; self-hosted Redis on Fly requires a
  stunnel or wireguard tunnel for Vercel → Redis traffic.
- **MinIO / S3**: Contractor document uploads (license, insurance,
  inspection PDFs/JPEGs) and JSONL archives of 7-year-old audit/payment
  rows. Any S3-compatible provider works; we use MinIO in dev (see
  `infra/docker-compose.yml`) and a managed S3-compatible provider in prod.

## Environment variables

See `infra/.env.example` for the complete list. Production secrets are
injected via the provider's secrets manager (Vercel Environment Variables,
Fly secrets, Railway variables) — never committed.

Required production-only:
- `REDIS_URL` (mandatory in production — in-memory fallback is dev-only)
- `METRICS_PASSWORD` (mandatory in production — `/metrics` is gated by it)
- `EXPO_ACCESS_TOKEN` (without it, Expo silently rate-limits push)
- `SENTRY_DSN` (without it, errors are not reported)

## Deploy steps (worker — Fly.io)

```bash
# One-time: create the app
flyctl apps create addis-ride-worker
flyctl postgres create addis-ride-pg --initial-cluster-size 3 --vm-size shared-cpu-1x --volume-size 50
flyctl secrets set DATABASE_URL=... NEXTAUTH_SECRET=... # (all secrets from infra/.env.example)

# Per-deploy: build + push + release
flyctl deploy --config infra/deploy/fly.worker.toml --dockerfile infra/Dockerfile.worker --strategy rolling
```

The rolling strategy + the worker's graceful shutdown handler (SIGTERM → stop
scheduling new work → wait up to 30s for in-flight drains → exit) gives
zero-downtime deploys.

## Deploy steps (web — Vercel)

The repo root has a `vercel.json` with the basic Next.js config. The GitHub
Actions workflow (`.github/workflows/ci.yml`) auto-deploys to Vercel staging
on every merge to `main` and to production on every `v*` tag.

## Deploy steps (Postgres migrations)

```bash
# Run from any environment with DATABASE_URL set
bun run db:migrate
```

Migrations are forward-only. The audit_logs table is append-only at the DB
layer (see `packages/db/migrations/0001_audit_append_only.sql`); the
retention purge sets `SET LOCAL app.audit_retention_purge = 'on'` inside
its DELETE transaction (see `packages/api/src/cron-jobs.ts`).

## Deploy steps (MinIO / S3 buckets)

Create three buckets in production:
1. `addis-ride-documents` — contractor document uploads (private, presigned
   URLs with 15-min TTL).
2. `addis-ride-archives` — JSONL archives of 7-year-old audit/payment rows
   (write-once, versioned, lifecycle: transition to Glacier after 90 days).
3. `addis-ride-backups` — daily `pg_dump` snapshots (see
   `infra/backup-restore.md`).

## Rollback

- **Web (Vercel)**: `vercel rollback <deployment-url>` or use the Vercel
  dashboard. Instant.
- **Worker (Fly)**: `flyctl releases list` → `flyctl releases rollback
  <version>`. The outbox schema is forward-compatible — old workers can
  drain rows produced by newer code (extra JSONB fields are ignored).
- **Postgres**: restore from the most recent `pg_dump` (RPO ≤ 24h) or
  PITR (RPO ≤ 5min for Fly Postgres). See `infra/backup-restore.md`.

## Health checks

- `apps/web`: `GET /api/v1/healthz` (unauthenticated liveness probe).
- `apps/worker`: process liveness via `pgrep -f apps/worker` (see
  `infra/Dockerfile.worker`).
- Postgres / Redis / MinIO: docker-compose-style healthchecks in their
  managed equivalents.

## Monitoring

- Sentry (web + worker) — see `apps/web/instrumentation.ts` and
  `apps/worker/src/instrumentation.ts`. PII is scrubbed before send
  (INFRA-011).
- `/metrics` (Prometheus) — gated by `METRICS_PASSWORD`.
- `outbox_events_depth` gauge — alerts if > 1000 (worker is falling
  behind).
