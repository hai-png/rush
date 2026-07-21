# Addis Ride — Setup & Deployment Guide

## Prerequisites

- Node.js 20+ or Bun 1.3+
- PostgreSQL 15+ (production) or SQLite (development)
- Redis 7+ (production, for rate limiting)
- S3-compatible storage (production, for file uploads)
- Telebirr merchant account (production payments)

## Quick Start (Development)

```bash
# 1. Install dependencies
bun install

# 2. Copy environment config
cp .env.example .env
# Edit .env — all defaults work for dev (SQLite, mock Telebirr, console SMS)

# 3. Create database + seed
bun run db:push
bun run db:seed

# 4. Start dev server
bun run dev
# → http://localhost:3000

# 5. Run e2e tests
bash scripts/e2e-test.sh
```

### Demo Credentials

| Role           | Phone           | Password             |
|----------------|-----------------|----------------------|
| Rider          | +251911000002   | rider-pass-1234      |
| Contractor     | +251911000003   | contractor-pass-1234 |
| Platform Admin | +251911000001   | admin-pass-1234      |

## Production Deployment

### 1. Environment Configuration

Copy `.env.example` to `.env` and fill in all required values:

```bash
# Core
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/addisride?sslmode=require
AUTH_SECRET=$(openssl rand -base64 48)  # MUST be 32+ chars
CRON_SECRET=$(openssl rand -base64 48)
APP_BASE_URL=https://addisride.et

# Telebirr (real)
TELEBIRR_ENV=testbed  # or production
TELEBIRR_FABRIC_APP_ID=your_fabric_app_id
TELEBIRR_APP_SECRET=your_app_secret
TELEBIRR_MERCHANT_APP_ID=your_merchant_app_id
TELEBIRR_MERCHANT_CODE=your_merchant_code
TELEBIRR_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
TELEBIRR_PUBLIC_KEY="-----BEGIN RSA PUBLIC KEY-----\n...\n-----END RSA PUBLIC KEY-----"
TELEBIRR_NOTIFY_URL=https://addisride.et/api/v1/webhooks/telebirr/notify
TELEBIRR_REDIRECT_URL=https://addisride.et/checkout/complete

# SMS (Twilio)
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM=+1234567890

# Email (Resend)
RESEND_API_KEY=re_xxxxxxxx
RESEND_FROM=Addis Ride <noreply@addisride.et>

# File storage (S3)
UPLOAD_DIR=/data/uploads  # or use S3 in code
UPLOAD_MAX_BYTES=10485760

# Observability
SENTRY_DSN=https://xxx@sentry.io/xxx
LOG_LEVEL=info

# Redis (rate limiting)
REDIS_URL=redis://localhost:6379
```

### 2. Database Setup (PostgreSQL)

```bash
# Create database
createdb addisride

# Push schema
DATABASE_URL=postgresql://... bun run db:push

# Seed initial data
DATABASE_URL=postgresql://... bun run db:seed
```

### 3. Build & Start

```bash
# Build
bun run build

# Start production server
bun run start
```

### 4. Cron Jobs (Production)

In production, the in-process scheduler may not run reliably (serverless). Set up
external cron to hit the API:

```bash
# Every minute: drain outbox + process refunds + expire stale data
* * * * * curl -X POST https://addisride.et/api/v1/cron/run \
  -H "content-type: application/json" \
  -d "{\"_cronSecret\":\"$CRON_SECRET\"}"
```

### 5. Telebirr Webhook Whitelisting

Register your notify URL with Ethio telecom:
- Testbed: `https://developerportal.ethiotelebirr.et` portal
- Production: contact ET admin

URL to whitelist: `https://addisride.et/api/v1/webhooks/telebirr/notify`

### 6. Mobile App

```bash
cd apps/mobile
npm install
# Update API_BASE in src/lib/api.ts to your production URL
npx expo start
# Press 'a' for Android, 'i' for iOS, or scan QR with Expo Go
```

## Architecture

```
prisma/schema.prisma         — single source of truth (28 models)
src/lib/                     — business logic (44 files)
src/lib/api-routes.ts        — route table (158 endpoints)
src/app/api/v1/[[...route]]/ — single catch-all dispatcher
src/app/**/page.tsx          — 56 web pages
apps/mobile/                 — Expo React Native app (24 files)
```

### Key Design Decisions

1. **Single Next.js app** — no monorepo, no separate API server. The Hono API
   is replaced with native Next.js Route Handlers + a custom `api()` wrapper.

2. **Prisma + SQLite (dev) / PostgreSQL (prod)** — schema is the single source
   of truth. No migration drift. Change `DATABASE_URL` to switch.

3. **JWT-in-cookie auth** — one auth system, not two. No NextAuth.

4. **In-process scheduler (dev) / cron endpoint (prod)** — the scheduler runs
   inside the dev server. In production, hit `/api/v1/cron/run` from external
   cron with `CRON_SECRET`.

5. **Mock providers with real-ready abstractions** — Telebirr, Twilio SMS,
   Resend email all auto-detect credentials. No creds = mock mode.

### Security

- **CSRF**: double-submit cookie + header. Raw multipart handlers also enforce.
- **Auth**: failed verification propagates as 401 (never silent downgrade).
- **Rate limit**: in-memory (dev) or Redis (prod). Per-IP, per-user, per-phone.
- **Idempotency**: DB-backed. Anon keys ignored.
- **ToS gate**: 409 when `tosVersion` is stale.
- **Audit log**: hash-chained, append-only. Admin endpoint verifies integrity.
- **2FA**: required for `corporate_admin` and `platform_admin` roles.
- **Webhook**: signature verification enforced (rejects invalid signatures).
- **Cron**: `CRON_SECRET` required in production.

### Production Hardening Status

| Component | Dev Mode | Production Mode | Status |
|-----------|----------|-----------------|--------|
| Database | SQLite | PostgreSQL via `DATABASE_URL` | ✅ Ready |
| Rate limiter | In-memory `Map` | Redis via `REDIS_URL` | ⚠️ Code reads env but uses in-memory fallback |
| File storage | Local disk `UPLOAD_DIR` | S3-compatible | ⚠️ Swap `file-storage.ts` for S3 SDK |
| SMS | `console.log` | Twilio API | ✅ Auto-detects creds |
| Email | `console.log` | Resend API | ✅ Auto-detects creds |
| Logging | pino pretty-print | pino JSON | ✅ Ready |
| Scheduler | In-process `setInterval` | External cron → `/cron/run` | ✅ Ready |
| Payments | Mock Telebirr stub | Real Telebirr H5/InApp/Subscription | ✅ Auto-detects creds |
| Error tracking | Console | Sentry via `SENTRY_DSN` | ⚠️ DSN read but Sentry not initialized |
| CI/CD | — | GitHub Actions (lint + e2e) | ✅ Ready |

### To enable Redis rate limiting in production

Replace the in-memory `rateBuckets` Map in `src/lib/api.ts` with Redis `INCR`/`EXPIRE`
calls when `REDIS_URL` is set. The interface is already isolated in the `rateLimitCheck`
function.

### To enable S3 file storage in production

Replace `saveFile` and `readFileBytes` in `src/lib/file-storage.ts` with
`@aws-sdk/client-s3` `PutObjectCommand` and `GetObjectCommand` calls. The
`UploadedFile` model's `storageKey` field stores the S3 object key.

## API Reference

- **OpenAPI spec**: `bun run openapi:gen` → `download/openapi.json` (158 endpoints)
- **Telebirr docs**: `download/telebirr-docs.md` (1,674 lines, all 3 integration types)
- **E2E test**: `scripts/e2e-test.sh` (57 assertions across 11 flows)

## Testing

```bash
# Lint
bun run lint

# E2E test (requires dev server running)
bash scripts/e2e-test.sh

# OpenAPI generation
bun run openapi:gen
```

## License

Private.
