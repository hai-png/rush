# Addis Ride — Setup & Deployment

## Development

```bash
bun install
bun run db:push
bun run db:seed
bun run dev                 # http://localhost:3000
bash scripts/e2e-test.sh    # e2e flow test (run in another shell while dev is up)
bun run lint
bunx tsc --noEmit
bun run test:race           # race-condition integration tests
```

### Demo credentials (seeded)

| Role           | Phone           | Password             |
|----------------|-----------------|----------------------|
| Rider          | +251911000002   | rider-pass-1234      |
| Contractor     | +251911000003   | contractor-pass-1234 |
| Platform Admin | +251911000001   | admin-pass-1234      |

## Production

### 1. Environment

All dev defaults work out-of-the-box. Production **requires** real values for:

- `AUTH_SECRET` — 32+ chars, `openssl rand -base64 48`
- `CRON_SECRET` — 32+ chars
- `TELEBIRR_*` — full set when `TELEBIRR_ENV=testbed|production`
- `DATABASE_URL` — `postgresql://...` (SQLite is dev-only)
- `FIELD_ENCRYPTION_KEY` — recommended (falls back to `AUTH_SECRET` if unset)
- `TRUSTED_PROXIES` — comma-separated CIDR list if running behind a reverse proxy

Optional but recommended in prod: `TWILIO_*`, `RESEND_*`, `SENTRY_DSN`, `REDIS_URL`, `CORS_ORIGINS`, `SCHEDULER_DISABLED=1`.

### 2. Build & start

```bash
NODE_ENV=production bun run build
bun run start
```

Or via Docker (multi-stage build, see `Dockerfile`):

```bash
docker build -t addis-ride .
docker run -p 3000:3000 --env-file .env addis-ride
```

The image runs `bunx prisma migrate deploy` before `bun server.js`, runs as a non-root user, sets `TZ=Africa/Addis_Ababa`, and exposes a healthcheck on `/api/v1/healthz`.

### 3. Cron

The in-process scheduler (driven by `setInterval` in `src/lib/scheduler.ts`) is fine for dev/single-instance. In production (especially multi-instance), disable it (`SCHEDULER_DISABLED=1`) and hit the cron endpoint externally.

`POST /api/v1/cron/run` runs every job (drain-outbox, refund-retries, expire-stale, hourly). To run a single job, pass `?job=<name>`:

```bash
# Run every job (default — equivalent to the old behavior):
* * * * * curl -X POST "https://addisride.et/api/v1/cron/run" \
  -H "content-type: application/json" \
  -d "{\"_cronSecret\":\"$CRON_SECRET\"}"

# Run a single job:
*/30 * * * * curl -X POST "https://addisride.et/api/v1/cron/run?job=drain-outbox" \
  -H "content-type: application/json" \
  -d "{\"_cronSecret\":\"$CRON_SECRET\"}"
```

Valid `?job=` values: `drain-outbox`, `refund-retries`, `expire-stale`, `hourly`. The job list + intervals are also exposed at `GET /api/v1/cron` (platform-admin only).

### 4. Telebirr webhook

Register `https://<your-domain>/api/v1/webhooks/telebirr/notify` with Ethio telecom (testbed portal or production admin). The handler verifies the RSA-PSS-SHA256 signature against `TELEBIRR_PUBLIC_KEY` and dedups via the composite PK `(merch_order_id, out_request_no)` on `TelebirrNotifyEvent`.

## Architecture at a glance

- 37 Prisma models — `prisma/schema.prisma` is the single source of truth
- 186 API operations across 155 unique paths, registered in `src/lib/api-routes.ts` and dispatched by the catch-all at `src/app/api/v1/[[...route]]/route.ts`
- 57 server-rendered pages under `src/app/**/page.tsx`
- 52 library modules in `src/lib/`

## Production hardening status

| Component | Dev | Production | Status |
|-----------|-----|------------|--------|
| Database | SQLite | PostgreSQL via `DATABASE_URL` | Ready |
| Rate limiter | In-memory `Map` | Redis (`REDIS_URL`) | Stub — swap `rateLimitCheck` in `src/lib/api.ts` |
| File storage | Local disk (`UPLOAD_DIR`) | S3 | Stub — swap `saveFile`/`readFileBytes` in `src/lib/file-storage.ts` |
| Field encryption | `AUTH_SECRET` | Dedicated `FIELD_ENCRYPTION_KEY` | Ready — set the env var |
| Trusted proxy | None (socket peer) | `TRUSTED_PROXIES` CIDR list | Ready — set the env var |
| SMS | `console.log` | Twilio | Auto-detects creds |
| Email | `console.log` | Resend | Auto-detects creds |
| Payments | Mock Telebirr | Real Telebirr H5/InApp/Subscription | Auto-detects creds |
| Scheduler | In-process `setInterval` | External cron + `SCHEDULER_DISABLED=1` | Ready |
| Error tracking | Console | Sentry | Stub — `SENTRY_DSN` read but not initialized |
| Mobile app | Expo (separate project in `apps/mobile/`) | Standalone build | Ready — see `apps/mobile/README.md` |

## Security invariants

- **CSRF** — double-submit cookie + header on every state-changing request; webhooks + cron exempt; bearer-only requests exempt
- **Auth** — failed verification propagates as 401 (never silent downgrade)
- **Rate limit** — per-IP / per-userId / per-phone; refuses to bucket on unknown IP
- **Idempotency** — DB-backed; anon keys ignored; 24h TTL
- **ToS gate** — 409 `TOS_UPDATE_REQUIRED` when `session.tosVersion` is stale
- **Audit log** — hash-chained, append-only; admin endpoint verifies integrity
- **2FA** — required for `corporate_admin` + `platform_admin`; enforced at `POST /corporate/onboard` and privileged-role login
- **Webhook signature** — RSA-PSS-SHA256 verification enforced; invalid signatures rejected with 401
- **Cron** — `CRON_SECRET` required
