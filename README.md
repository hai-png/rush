# Addis Ride

Shuttle subscription platform for Addis Ababa. Riders subscribe to monthly plans, book rides on scheduled trips, and can release seats they can't use to a marketplace. Contractors operate shuttles and trips. Corporate admins subsidize their employees' rides. Platform admins oversee everything.

## Stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript 5
- **DB:** Prisma 6 + SQLite (single source of truth: `prisma/schema.prisma`)
- **Auth:** JWT-in-cookie (jose + bcryptjs) — single auth system
- **Payments:** Real Telebirr H5 C2B Web Payment integration (RSA-PSS-SHA256 signing) + mock fallback for dev + CBE manual bank transfer
- **2FA:** otplib TOTP for privileged roles (corporate_admin, platform_admin)
- **Styling:** Tailwind 4 + shadcn/ui (New York) + lucide-react
- **Notifications/audit:** In-process outbox + scheduler (no separate worker)

## Quick start

```bash
bun install                # install deps
bun run db:push            # create SQLite DB from schema.prisma
bun run db:seed            # seed admin + rider + contractor + plans + route + shuttle + trip
bun run dev                # start dev server on http://localhost:3000
```

### Demo credentials (seeded)

| Role             | Phone           | Password           |
| ---------------- | --------------- | ------------------ |
| Rider            | +251911000002   | rider-pass-1234    |
| Contractor       | +251911000003   | contractor-pass-1234 |
| Platform admin   | +251911000001   | admin-pass-1234    |

## Configuration

Copy `.env.example` to `.env` and fill in. All vars have sensible dev defaults; production requires real values for `AUTH_SECRET`, `CRON_SECRET`, and Telebirr creds.

### Telebirr

Set `TELEBIRR_ENV=mock` (default) for the in-app mock provider — `/telebirr-stub` simulates the redirect and fires the real webhook handler. No creds needed.

Set `TELEBIRR_ENV=testbed` (sandbox) or `production` and provide all `TELEBIRR_*` vars to use real Telebirr. The provider auto-detects: real when creds are present, mock otherwise.

The integration uses the H5 C2B Web Payment flow per https://developer.ethiotelecom.et/docs/category/h5-c2b-web-payment-integration:

1. Backend applies a Fabric Token (`POST /payment/v1/token`)
2. Backend creates a preOrder (`POST /payment/v1/merchant/preOrder`) — RSA-PSS-SHA256 signed
3. Backend builds the user-facing checkout URL (`web/paygate?<signed fields>`)
4. User's browser redirects to Telebirr, pays
5. Telebirr POSTs to `notify_url` (signed by their private key, verified with their public key)
6. Backend dedups via composite PK `(merch_order_id, out_request_no)` + settles the payment

## Architecture

```
prisma/schema.prisma         — single source of truth (31 models)
scripts/seed.ts              — seeds demo data
scripts/e2e-test.sh          — end-to-end flow test (59 assertions)
src/lib/                     — primitives: db, auth, api, money, errors, env,
                               audit, outbox, payments, payment-service, otp,
                               phone, id, session-server, api-client,
                               file-storage, subscription, scheduler, sms, email
src/lib/api-*.ts             — per-module handler functions:
                               identity, catalog, subscriptions, payments,
                               marketplace, operations, support, admin,
                               admin-advanced, webhooks, cron, tos, account,
                               dashboard, engagement, corporate, documents,
                               files, telebirr, health, assignments
src/lib/api-routes.ts        — single route table (158 endpoints)
src/app/api/v1/[[...route]]/route.ts — single catch-all dispatcher
src/app/**/page.tsx          — all web pages (57 server components)
src/components/              — client components (sign-out-button, trip-actions,
                               route-map, csrf-initializer, ui/*)
```

## Security

- **CSRF:** double-submit cookie + header; bearer-exempt when no session cookie; webhooks + cron fully exempt
- **Auth:** failed credential verification propagates as 401 (never silent downgrade to anonymous)
- **Rate limit:** in-memory sliding window; per-IP / per-userId / per-phone rules; refuses to bucket on UNKNOWN_IP
- **Idempotency:** DB-backed; anon keys ignored (prevents the SEC-011 dedup-bypass bug)
- **ToS gate:** 409 with `TOS_UPDATE_REQUIRED` when session.tosVersion is stale; auth/health/webhooks/cron exempt
- **Audit log:** hash-chained, append-only (no update/delete path); admin endpoint verifies chain integrity
- **2FA required for privileged roles** (corporate_admin, platform_admin)
- **Phone verification required for privileged roles**
- **Refund row-lock:** `scheduleRefund` runs inside a transaction so concurrent refunds can't over-refund
- **Telebirr dedup:** composite PK `(merch_order_id, out_request_no)` on `TelebirrNotifyEvent` — done right the first time

## Testing

```bash
bun run lint                # ESLint
bunx tsc --noEmit           # TypeScript
bash scripts/e2e-test.sh    # e2e flow test (59 assertions; run while dev server is up)
```

The e2e test exercises: public catalog, rider registration + buy plan + Telebirr mock pay + book ride + list seat, contractor document upload + trip creation, admin contractor verification + audit chain verification, corporate onboard (with 2FA gate) + invite + member join + approve, support ticket + admin reply, account data export, cron job, plus feature-parity coverage of 17 additional endpoints.

## User flows

### Rider
- Sign up at `/signup/rider`
- Accept ToS at `/tos/accept`
- Browse plans at `/plans`, subscribe via Telebirr or CBE
- Pay via `/telebirr-stub` (mock) or real Telebirr redirect
- Browse trips at `/trips`, book a ride against an active subscription
- List a seat you can't use at `/open-seats/new`
- Browse + claim seats on the marketplace at `/open-seats`
- Open support tickets at `/tickets/new`
- Export your data at `/account/export`
- Soft-delete your account at `/account/delete`

### Contractor
- Sign up at `/signup/contractor`
- Upload onboarding documents (registration / insurance / inspection) at `/dashboard/contractor/documents`
- Wait for platform admin verification
- Schedule trips at `/dashboard/contractor/trips` (on your own shuttles + active routes)
- Board / complete trips from the same page

### Corporate admin
- Onboard your company at `/corporate/onboard` (promotes you from rider to corporate_admin)
- Generate invite codes at `/dashboard/corporate`
- Approve / reject pending member requests
- Members join via `/corporate/signup` with the invite code

### Platform admin
- View all users / payments / audit logs / contractors / shuttles / routes / tickets at `/admin/*`
- Verify / reject contractors with a reason
- Create plans, routes, shuttles
- Reply to support tickets + change status
- Verify audit chain integrity at `/admin/audit-logs`

## License

Private.
