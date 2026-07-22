# Addis Ride — Setup & Deployment

## Development

```bash
bun install
bun run db:push
bun run db:seed
bun run dev                 # http://localhost:3000
bash scripts/e2e-test.sh    # 59 assertions (run in another shell while dev is up)
bun run lint
bunx tsc --noEmit
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

Optional but recommended in prod: `TWILIO_*`, `RESEND_*`, `SENTRY_DSN`, `REDIS_URL`.

### 2. Build & start

```bash
NODE_ENV=production bun run build
bun run start
```

### 3. Cron

The in-process scheduler (driven by `setInterval` in `src/lib/scheduler.ts`) is fine for dev/single-instance. In production (especially multi-instance), disable it and hit the cron endpoint externally:

```bash
* * * * * curl -X POST https://addisride.et/api/v1/cron/run \
  -H "content-type: application/json" \
  -d "{\"_cronSecret\":\"$CRON_SECRET\"}"
```

This drains the outbox, processes refund retries, and expires stale subscriptions/releases.

### 4. Telebirr webhook

Register `https://<your-domain>/api/v1/webhooks/telebirr/notify` with Ethio telecom (testbed portal or production admin). The handler verifies the RSA-PSS-SHA256 signature against `TELEBIRR_PUBLIC_KEY` and dedups via the composite PK `(merch_order_id, out_request_no)` on `TelebirrNotifyEvent`.

## Architecture at a glance

- 31 Prisma models — `prisma/schema.prisma` is the single source of truth
- 158 API routes registered in `src/lib/api-routes.ts`, dispatched by the catch-all at `src/app/api/v1/[[...route]]/route.ts`
- 57 server-rendered pages under `src/app/**/page.tsx`
- 44 library modules in `src/lib/`

## Production hardening status

| Component | Dev | Production | Status |
|-----------|-----|------------|--------|
| Database | SQLite | PostgreSQL via `DATABASE_URL` | Ready |
| Rate limiter | In-memory `Map` | Redis (`REDIS_URL`) | Stub — swap `rateLimitCheck` in `src/lib/api.ts` |
| File storage | Local disk (`UPLOAD_DIR`) | S3 | Stub — swap `saveFile`/`readFileBytes` in `src/lib/file-storage.ts` |
| SMS | `console.log` | Twilio | Auto-detects creds |
| Email | `console.log` | Resend | Auto-detects creds |
| Payments | Mock Telebirr | Real Telebirr H5/InApp/Subscription | Auto-detects creds |
| Scheduler | In-process `setInterval` | External cron | Ready |
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
