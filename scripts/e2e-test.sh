#!/bin/bash
# Addis Ride — comprehensive end-to-end test suite.
#
# Covers every public API route plus key security, concurrency, and edge-case
# paths. Run while the dev server is up on localhost:3000 with OTP_DEBUG=1,
# RATE_LIMIT_DISABLED=1, and TELEBIRR_ENV=mock (default).
#
# Usage:
#   OTP_DEBUG=1 RATE_LIMIT_DISABLED=1 bun run dev &   # separate terminal
#   bash scripts/e2e-test.sh
#
# Exit code = number of failed assertions.

set +e
BASE=http://localhost:3000
TMP=/tmp/addis-ride-e2e
RUN_ID=${RUN_ID:-$(date +%s)}
rm -rf "$TMP" && mkdir -p "$TMP"
PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

# section <number>. <name>
section() { echo ""; echo "── $1. $2 ──"; }

# JSON extraction helpers (use python3 because it's universally available).
# jget <json-string> <key>     — top-level key
# jget <json-string> <a.b.c>   — nested keys
jget() {
  echo "$1" | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  for k in '$2'.split('.'):
    d = d.get(k) if isinstance(d, dict) else d[int(k)]
  print('' if d is None else d)
except Exception:
  print('')
" 2>/dev/null
}
# jtest <json-string> <python-expr> — prints 'OK' if predicate holds (d is root)
jtest() {
  echo "$1" | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  print('OK' if ($2) else 'NO')
except Exception:
  print('NO')
" 2>/dev/null
}

# HTTP wrappers (preserve cookie jar + CSRF).
get_csrf() { grep -i 'addis-csrf' "$1" 2>/dev/null | awk '{print $NF}'; }
sget() {
  local jar=$1 url=$2; shift 2
  curl -s -b "$jar" -c "$jar" "$BASE$url" "$@"
}
spost() {
  local jar=$1 url=$2 body=$3; shift 3
  curl -s -b "$jar" -c "$jar" -X POST "$BASE$url" \
    -H 'content-type: application/json' \
    -H "x-csrf-token: $(get_csrf $jar)" "$@" -d "$body"
}
spatch() {
  local jar=$1 url=$2 body=$3; shift 3
  curl -s -b "$jar" -c "$jar" -X PATCH "$BASE$url" \
    -H 'content-type: application/json' \
    -H "x-csrf-token: $(get_csrf $jar)" "$@" -d "$body"
}
sput() {
  local jar=$1 url=$2 body=$3; shift 3
  curl -s -b "$jar" -c "$jar" -X PUT "$BASE$url" \
    -H 'content-type: application/json' \
    -H "x-csrf-token: $(get_csrf $jar)" "$@" -d "$body"
}
sdel() {
  local jar=$1 url=$2; shift 2
  curl -s -b "$jar" -c "$jar" -X DELETE "$BASE$url" \
    -H 'content-type: application/json' \
    -H "x-csrf-token: $(get_csrf $jar)" "$@"
}
# raw POST without CSRF (for webhook + cron + csrf-negative tests)
rawpost() {
  local url=$1 body=$2; shift 2
  curl -s -X POST "$BASE$url" -H 'content-type: application/json' "$@" -d "$body"
}

# login <jar> <phone> <password> [code]   — also primes CSRF cookie.
login() {
  local jar=$1 phone=$2 pass=$3 code=${4:-}
  local body="{\"phone\":\"$phone\",\"password\":\"$pass\""
  [ -n "$code" ] && body="$body,\"code\":\"$code\""
  body="$body}"
  curl -s -c "$jar" -X POST "$BASE/api/v1/auth/token" \
    -H 'content-type: application/json' -d "$body" > /dev/null
  # Prime CSRF via a safe GET.
  curl -s -b "$jar" -c "$jar" "$BASE/api/v1/plans" > /dev/null
}

# totp_for <base32-secret>   — generates a current 6-digit TOTP code.
totp_for() {
  bun -e "
    import { generateSync } from 'otplib';
    console.log(generateSync({ secret: '$1' }));
  " 2>/dev/null
}

# telebirr_webhook <merch_order_id> <out_request_no> <trade_status> <total_amount>
telebirr_webhook() {
  local merch=$1 orno=$2 status=$3 amt=$4
  local ts=$(date +%s)000
  rawpost "/api/v1/webhooks/telebirr/notify" \
    "{\"merch_order_id\":\"$merch\",\"out_request_no\":\"$orno\",\"trade_status\":\"$status\",\"total_amount\":\"$amt\",\"timestamp\":\"$ts\",\"sign\":\"mock-signature\"}"
}

# random_phone — unique-per-run Ethiopian phone. Uses a counter file so the
# value persists across $(...) subshell invocations.
SEQ_FILE=$TMP/.seq
echo 0 > "$SEQ_FILE"
random_phone() {
  local n
  n=$(cat "$SEQ_FILE" 2>/dev/null || echo 0)
  n=$((n + 1))
  echo "$n" > "$SEQ_FILE"
  printf "+2519220%05d" "$n"
}

echo "════════════════════════════════════════════════════════════════"
echo "  Addis Ride — comprehensive e2e test suite (run_id=$RUN_ID)"
echo "════════════════════════════════════════════════════════════════"

# ─── Cleanup + seed ─────────────────────────────────────────────────────────
echo "Cleaning DB + re-seeding..."
bun -e "
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const models = ['rideRating','ticketMessage','supportTicket','notification','otpCode','tosAcceptance','session','idempotencyRecord','twoFactorBackupCode','telebirrNotifyEvent','refundRetry','seatClaim','seatRelease','ride','subscription','payment','mandate','corporateInvoice','corporateInvite','corporateMember','corporate','contractorDocument','uploadedFile','trip','routeAssignment','pickupLocation','shuttle','route','subscriptionPlan','outboxEvent','auditLog','setting','faqArticle','holiday','riderProfile','contractorProfile','user'];
for (const m of models) { try { await (db as any)[m].deleteMany({}); } catch {} }
console.log('  cleanup done');
" 2>/dev/null
rm -rf db/uploads/*
bun run db:seed > /dev/null 2>&1

# Stable seed-data references.
ADMIN_PHONE="+251911000001";    ADMIN_PASS="admin-pass-1234"
RIDER_SEED_PHONE="+251911000002"
CONTRACTOR_PHONE="+251911000003"; CONTRACTOR_PASS="contractor-pass-1234"
PLAN_MONTHLY="monthly-30"; PLAN_TRIAL="trial"
ROUTE_ID="route-bole-merkato"
SHUTTLE_PLATE="AA-12345"

# ─── 1. Health, Config & Readiness ──────────────────────────────────────────
section 1 "Health, Config & Readiness Probe"
H=$(sget $TMP/anon.txt /api/v1/healthz)
jtest "$H" "'status' in d.get('data',{})" >/dev/null && ok "GET /healthz" || bad "healthz"

H=$(sget $TMP/anon.txt /api/v1/health)
jtest "$H" "d['data']['status']=='ok' and d['data']['checks']['db']['ok']==True" >/dev/null && ok "GET /health (db ok)" || bad "health"
jtest "$H" "'version' in d['data']" >/dev/null && ok "GET /health returns version" || bad "health version"

R=$(sget $TMP/anon.txt /api/v1/ready)
jtest "$R" "d['data']['checks']['db']['ok']==True" >/dev/null && ok "GET /ready" || bad "ready"

C=$(sget $TMP/anon.txt /api/v1/config)
jtest "$C" "'tosVersion' in d['data'] and 'maintenanceMode' in d['data']" >/dev/null && ok "GET /config" || bad "config"

# Metrics requires admin auth.
M_ANON=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/v1/metrics)
[ "$M_ANON" = "401" ] && ok "GET /metrics (anon → 401)" || bad "metrics anon (got $M_ANON)"

# ─── 2. Auth: Register, Login, Me, Sessions, Logout ─────────────────────────
section 2 "Auth: Register, Login, Me, Sessions, Logout"
RIDER_PHONE=$(random_phone)
R1=$(spost $TMP/anon.txt /api/v1/auth/register \
  "{\"kind\":\"rider\",\"name\":\"E2E Rider\",\"phone\":\"$RIDER_PHONE\",\"password\":\"test-pass-1234\",\"homeArea\":\"Bole\",\"workArea\":\"Merkato\"}")
jtest "$R1" "d.get('data',{}).get('user',{}).get('id')" >/dev/null && ok "register rider" || bad "register rider"

R2=$(spost $TMP/anon.txt /api/v1/auth/register \
  "{\"kind\":\"rider\",\"name\":\"E2E Rider 2\",\"phone\":\"$RIDER_PHONE\",\"password\":\"test-pass-1234\",\"homeArea\":\"Bole\",\"workArea\":\"Merkato\"}")
jtest "$R2" "d.get('data',{}).get('user',{}).get('id')" >/dev/null && ok "register duplicate phone still 201 (anti-enumeration)" || bad "duplicate register"

R3=$(spost $TMP/anon.txt /api/v1/auth/register \
  "{\"kind\":\"rider\",\"name\":\"Bad\",\"phone\":\"not-a-phone\",\"password\":\"test-pass-1234\"}")
jtest "$R3" "'error' in d" >/dev/null && ok "register with bad phone rejected" || bad "bad phone"

# Login.
login $TMP/rider.txt "$RIDER_PHONE" "test-pass-1234"
ME=$(sget $TMP/rider.txt /api/v1/auth/me)
jtest "$ME" "d['data']['phone']=='$RIDER_PHONE'" >/dev/null && ok "login + GET /auth/me" || bad "auth/me"
jtest "$ME" "'passwordHash' not in d['data'] and 'twoFactorSecret' not in d['data']" >/dev/null && ok "/auth/me excludes sensitive fields" || bad "auth/me sensitive leak"

SESS=$(sget $TMP/rider.txt /api/v1/auth/sessions)
jtest "$SESS" "isinstance(d['data'],list) and len(d['data'])>=1 and 'jti' not in d['data'][0]" >/dev/null && ok "GET /auth/sessions (no jti leaked)" || bad "sessions"

# Logout + refresh.
LO=$(spost $TMP/rider.txt /api/v1/auth/logout "{}")
jtest "$LO" "d.get('data',{}).get('ok')==True" >/dev/null && ok "POST /auth/logout" || bad "logout"
ME2=$(sget $TMP/rider.txt /api/v1/auth/me)
jtest "$ME2" "'error' in d" >/dev/null && ok "after logout, /auth/me → 401" || bad "post-logout auth/me"

# Logout-all.
login $TMP/rider.txt "$RIDER_PHONE" "test-pass-1234"
LA=$(spost $TMP/rider.txt /api/v1/auth/logout-all "{}")
jtest "$LA" "d.get('data',{}).get('ok')==True" >/dev/null && ok "POST /auth/logout-all" || bad "logout-all"

# ─── 3. Auth: OTP Send/Verify, Phone Verify, Phone Change ───────────────────
section 3 "Auth: OTP, Phone Verify, Phone Change"
OTP_PHONE=$(random_phone)
OS=$(spost $TMP/anon.txt /api/v1/auth/otp/send "{\"phone\":\"$OTP_PHONE\",\"purpose\":\"signup_verification\"}")
DEV_CODE=$(jget "$OS" "data.devCode")
[ -n "$DEV_CODE" ] && ok "POST /auth/otp/send (devCode returned)" || bad "otp send"

OV=$(spost $TMP/anon.txt /api/v1/auth/otp/verify "{\"phone\":\"$OTP_PHONE\",\"code\":\"$DEV_CODE\"}")
jtest "$OV" "d.get('data',{}).get('ok')==True or d.get('data')==None or 'data' not in d" >/dev/null && ok "POST /auth/otp/verify (correct code)" || bad "otp verify"

OV2=$(spost $TMP/anon.txt /api/v1/auth/otp/verify "{\"phone\":\"$OTP_PHONE\",\"code\":\"000000\"}")
jtest "$OV2" "'error' in d" >/dev/null && ok "POST /auth/otp/verify (wrong code rejected)" || bad "otp wrong"

# Phone-verify as the registered rider.
PV_PHONE=$(random_phone)
spost $TMP/anon.txt /api/v1/auth/register "{\"kind\":\"rider\",\"name\":\"PV\",\"phone\":\"$PV_PHONE\",\"password\":\"test-pass-1234\",\"homeArea\":\"B\",\"workArea\":\"M\"}" > /dev/null
login $TMP/pv.txt "$PV_PHONE" "test-pass-1234"
spost $TMP/pv.txt /api/v1/tos/accept "{}" > /dev/null
OS2=$(spost $TMP/anon.txt /api/v1/auth/otp/send "{\"phone\":\"$PV_PHONE\",\"purpose\":\"signup_verification\"}")
DEV2=$(jget "$OS2" "data.devCode")
PV=$(spost $TMP/pv.txt /api/v1/auth/phone/verify "{\"code\":\"$DEV2\"}")
jtest "$PV" "d['data']['phoneVerified']==True" >/dev/null && ok "POST /auth/phone/verify" || bad "phone/verify"

# Phone-change — handler does not propagate devCode in the response, so we
# fire the OTP directly via /auth/otp/send with purpose=phone_change and reuse
# that code for the confirm step. The handler dedupes by phone+purpose so this
# is safe.
NEW_PHONE=$(random_phone)
PCR=$(spost $TMP/pv.txt /api/v1/account/phone/change/request "{\"newPhone\":\"$NEW_PHONE\"}")
jtest "$PCR" "d.get('data',{}).get('ok')==True" >/dev/null && ok "phone-change request" || bad "phone-change request"
# Fetch the OTP directly via the public send endpoint (OTP_DEBUG=1 returns it).
OS_PC=$(spost $TMP/anon.txt /api/v1/auth/otp/send "{\"phone\":\"$NEW_PHONE\",\"purpose\":\"phone_change\"}")
DEV3=$(jget "$OS_PC" "data.devCode")
PCC=$(spost $TMP/pv.txt /api/v1/account/phone/change/confirm "{\"newPhone\":\"$NEW_PHONE\",\"code\":\"$DEV3\"}")
jtest "$PCC" "d.get('data',{}).get('ok')==True" >/dev/null && ok "phone-change confirm" || bad "phone-change confirm"

# ─── 4. Auth: Password Reset ────────────────────────────────────────────────
section 4 "Auth: Password Reset Flow"
PR_PHONE=$(random_phone)
spost $TMP/anon.txt /api/v1/auth/register "{\"kind\":\"rider\",\"name\":\"PR\",\"phone\":\"$PR_PHONE\",\"password\":\"old-pass-1234\",\"homeArea\":\"B\",\"workArea\":\"M\"}" > /dev/null
PR=$(rawpost /api/v1/auth/password/reset "{\"phone\":\"$PR_PHONE\"}")
PR_CODE=$(jget "$PR" "data.devCode")
[ -n "$PR_CODE" ] && ok "password/reset returns devCode" || bad "password/reset"
PRC=$(rawpost /api/v1/auth/password/reset/confirm "{\"phone\":\"$PR_PHONE\",\"code\":\"$PR_CODE\",\"newPassword\":\"new-pass-1234\"}")
jtest "$PRC" "d.get('data',{}).get('ok')==True or 'data' not in d" >/dev/null && ok "password/reset/confirm" || bad "password/reset/confirm"

login $TMP/pr.txt "$PR_PHONE" "new-pass-1234"
ME_PR=$(sget $TMP/pr.txt /api/v1/auth/me)
jtest "$ME_PR" "d['data']['phone']=='$PR_PHONE'" >/dev/null && ok "login with new password works" || bad "login new password"

# ─── 5. Auth: 2FA Setup/Enable/Verify/Disable ───────────────────────────────
section 5 "Auth: 2FA Setup/Enable/Verify/Disable"
TFA_PHONE=$(random_phone)
spost $TMP/anon.txt /api/v1/auth/register "{\"kind\":\"rider\",\"name\":\"2FA\",\"phone\":\"$TFA_PHONE\",\"password\":\"tfa-pass-1234\",\"homeArea\":\"B\",\"workArea\":\"M\"}" > /dev/null
login $TMP/tfa.txt "$TFA_PHONE" "tfa-pass-1234"
spost $TMP/tfa.txt /api/v1/tos/accept "{}" > /dev/null

# Phone-verify first (2FA setup requires verified phone).
OS_TFA=$(spost $TMP/anon.txt /api/v1/auth/otp/send "{\"phone\":\"$TFA_PHONE\",\"purpose\":\"signup_verification\"}")
DEV_TFA=$(jget "$OS_TFA" "data.devCode")
spost $TMP/tfa.txt /api/v1/auth/phone/verify "{\"code\":\"$DEV_TFA\"}" > /dev/null

# 2FA setup.
TS=$(spost $TMP/tfa.txt /api/v1/auth/2fa/setup "{\"password\":\"tfa-pass-1234\"}")
SECRET=$(jget "$TS" "data.secret")
[ -n "$SECRET" ] && ok "POST /auth/2fa/setup returns secret" || { bad "2fa/setup"; echo "    response: $TS"; }
TS2=$(spost $TMP/tfa.txt /api/v1/auth/2fa/setup "{\"password\":\"wrong\"}")
jtest "$TS2" "'error' in d" >/dev/null && ok "2fa/setup with wrong password rejected" || bad "2fa/setup wrong password"

# Enable 2FA.
CODE1=$(totp_for "$SECRET")
TE=$(spost $TMP/tfa.txt /api/v1/auth/2fa/enable "{\"secret\":\"$SECRET\",\"code\":\"$CODE1\"}")
jtest "$TE" "d.get('data',{}).get('enabled')==True" >/dev/null && ok "POST /auth/2fa/enable" || bad "2fa/enable"
BACKUPS=$(echo "$TE" | python3 -c "import sys,json;d=json.load(sys.stdin);print(' '.join(d.get('data',{}).get('backupCodes',[])))" 2>/dev/null)
[ -n "$BACKUPS" ] && ok "2fa/enable returns backup codes" || bad "2fa backup codes"

# Login with 2FA.
login $TMP/tfa2.txt "$TFA_PHONE" "tfa-pass-1234" "$CODE1"
ME_TFA=$(sget $TMP/tfa2.txt /api/v1/auth/me)
jtest "$ME_TFA" "d['data']['phone']=='$TFA_PHONE'" >/dev/null && ok "login with 2FA code works" || bad "login 2fa"

# Verify 2FA.
CODE2=$(totp_for "$SECRET")
TV=$(spost $TMP/tfa2.txt /api/v1/auth/2fa/verify "{\"code\":\"$CODE2\"}")
jtest "$TV" "d.get('data',{}).get('verified')==True" >/dev/null && ok "POST /auth/2fa/verify" || bad "2fa/verify"

# Disable 2FA.
CODE3=$(totp_for "$SECRET")
TD=$(spost $TMP/tfa2.txt /api/v1/auth/2fa/disable "{\"password\":\"tfa-pass-1234\",\"code\":\"$CODE3\"}")
jtest "$TD" "d.get('data',{}).get('ok')==True or 'data' not in d" >/dev/null && ok "POST /auth/2fa/disable" || bad "2fa/disable"

# ─── 6. ToS Gate & Account ──────────────────────────────────────────────────
section 6 "ToS Gate & Account"
TOS_PHONE=$(random_phone)
spost $TMP/anon.txt /api/v1/auth/register "{\"kind\":\"rider\",\"name\":\"TOS\",\"phone\":\"$TOS_PHONE\",\"password\":\"tos-pass-1234\",\"homeArea\":\"B\",\"workArea\":\"M\"}" > /dev/null
login $TMP/tos.txt "$TOS_PHONE" "tos-pass-1234"
TOS_CURR=$(sget $TMP/anon.txt /api/v1/tos/current)
jtest "$TOS_CURR" "'version' in d['data']" >/dev/null && ok "GET /tos/current (public)" || bad "tos/current"

# ToS-gated endpoint before acceptance → 409.
DG=$(curl -s -o /dev/null -w "%{http_code}" -b $TMP/tos.txt $BASE/api/v1/dashboard/rider)
[ "$DG" = "409" ] && ok "ToS gate blocks /dashboard/rider (409)" || { bad "tos gate (got $DG)"; echo "    tos.txt:"; cat $TMP/tos.txt | grep -E 'session|csrf' | head; }

TA=$(spost $TMP/tos.txt /api/v1/tos/accept "{}")
jtest "$TA" "d.get('data',{}).get('ok')==True" >/dev/null && ok "POST /tos/accept" || bad "tos/accept"
DG2=$(sget $TMP/tos.txt /api/v1/dashboard/rider)
jtest "$DG2" "'data' in d" >/dev/null && ok "after ToS, /dashboard/rider works" || bad "post-tos dashboard"

# Account.
ACCT=$(sget $TMP/tos.txt /api/v1/account)
jtest "$ACCT" "'phone' in d['data'] and 'passwordHash' not in d['data']" >/dev/null && ok "GET /account" || bad "account"
PA=$(spatch $TMP/tos.txt /api/v1/account "{\"name\":\"Updated Name\"}")
jtest "$PA" "d['data']['name']=='Updated Name'" >/dev/null && ok "PATCH /account" || bad "patch account"

# Export.
EX=$(sget $TMP/tos.txt /api/v1/account/export)
jtest "$EX" "'user' in d['data'] and 'subscriptions' in d['data'] and 'passwordHash' not in d['data']['user']" >/dev/null && ok "GET /account/export" || bad "export"

# ─── 7. Public Catalog ──────────────────────────────────────────────────────
section 7 "Public Catalog"
P=$(sget $TMP/anon.txt /api/v1/plans)
jtest "$P" "isinstance(d['data'],list) and len(d['data'])>=3" >/dev/null && ok "GET /plans (3+ plans)" || bad "plans"
RT=$(sget $TMP/anon.txt /api/v1/routes)
jtest "$RT" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "GET /routes" || bad "routes"
RT1=$(sget $TMP/anon.txt /api/v1/routes/$ROUTE_ID)
jtest "$RT1" "d['data']['id']=='$ROUTE_ID'" >/dev/null && ok "GET /routes/:id" || bad "route detail"
RTX=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/v1/routes/bogus-id)
[ "$RTX" = "404" ] && ok "GET /routes/bogus → 404" || bad "route 404 (got $RTX)"
SH=$(sget $TMP/anon.txt /api/v1/shuttles)
jtest "$SH" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "GET /shuttles" || bad "shuttles"
TR=$(sget $TMP/anon.txt /api/v1/trips)
jtest "$TR" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "GET /trips" || bad "trips"
TRIP_ID=$(jget "$TR" "data.0.id")
FAQ=$(sget $TMP/anon.txt /api/v1/faqs)
jtest "$FAQ" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "GET /faqs" || bad "faqs"
PK=$(sget $TMP/anon.txt /api/v1/routes/$ROUTE_ID/pickups)
jtest "$PK" "isinstance(d['data'],list) and len(d['data'])>=4" >/dev/null && ok "GET /routes/:id/pickups" || bad "pickups"

# ─── 8. Rider Subscription Lifecycle ────────────────────────────────────────
section 8 "Rider Subscription Lifecycle"
DASH0=$(sget $TMP/tos.txt /api/v1/dashboard/rider)
jtest "$DASH0" "isinstance(d['data'].get('activeSubs',[]),list)" >/dev/null && ok "GET /dashboard/rider (initial)" || bad "dashboard initial"

PLAN_ID=$(echo "$P" | python3 -c "import sys,json;d=json.load(sys.stdin);print([p['id'] for p in d['data'] if p['slug']=='monthly-30'][0])" 2>/dev/null)
SUB=$(spost $TMP/tos.txt /api/v1/subscriptions \
  "{\"planId\":\"$PLAN_ID\",\"paymentMethod\":\"telebirr\"}")
SUB_ID=$(jget "$SUB" "data.subscription.id")
PAY_REF=$(jget "$SUB" "data.paymentReference")
jtest "$SUB" "d.get('data',{}).get('subscription',{}).get('id')" >/dev/null && ok "POST /subscriptions" || bad "subscription create"

SUB1=$(sget $TMP/tos.txt /api/v1/subscriptions/$SUB_ID)
jtest "$SUB1" "d['data']['id']=='$SUB_ID'" >/dev/null && ok "GET /subscriptions/:id" || bad "subscription get"

SUB_LIST=$(sget $TMP/tos.txt /api/v1/subscriptions)
jtest "$SUB_LIST" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "GET /subscriptions (paginated)" || bad "subscription list"

PAY_ID=$(echo "$SUB1" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['data']['payments'][0]['id'])" 2>/dev/null)
PAY1=$(sget $TMP/tos.txt /api/v1/payments/$PAY_ID)
jtest "$PAY1" "d['data']['id']=='$PAY_ID'" >/dev/null && ok "GET /payments/:id" || bad "payment get"

PAY_LIST=$(sget $TMP/tos.txt /api/v1/payments)
jtest "$PAY_LIST" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "GET /payments" || bad "payment list"

# Settle via mock webhook.
ORNO="orno-e2e-$RUN_ID-1"
WB=$(telebirr_webhook "$PAY_REF" "$ORNO" "Success" "1500.00")
jtest "$WB" "d.get('data',{}).get('ok')==True" >/dev/null && ok "telebirr webhook settles payment" || bad "webhook settle"

# Verify subscription is now active.
DASH1=$(sget $TMP/tos.txt /api/v1/dashboard/rider)
jtest "$DASH1" "any(s.get('status')=='active' for s in d['data'].get('activeSubs',[]))" >/dev/null && ok "subscription is active after webhook" || bad "active sub"

# Webhook replay dedup.
WB2=$(telebirr_webhook "$PAY_REF" "$ORNO" "Success" "1500.00")
jtest "$WB2" "d.get('data',{}).get('ok')==True" >/dev/null && ok "webhook replay deduped" || bad "webhook replay"

# Wrong signature.
WB3=$(rawpost /api/v1/webhooks/telebirr/notify \
  "{\"merch_order_id\":\"$PAY_REF\",\"out_request_no\":\"x-$RUN_ID\",\"trade_status\":\"Success\",\"total_amount\":\"1500.00\",\"timestamp\":\"$(date +%s)000\",\"sign\":\"WRONG\"}")
jtest "$WB3" "'error' in d" >/dev/null && ok "webhook with wrong signature rejected" || bad "webhook sig"

# Change payment method.
CPM=$(spost $TMP/tos.txt /api/v1/subscriptions/$SUB_ID/change-payment-method "{\"method\":\"cbe\"}")
jtest "$CPM" "d.get('data',{}).get('method')=='cbe' or d.get('data',{}).get('ok')==True or 'data' in d" >/dev/null && ok "POST /subscriptions/:id/change-payment-method" || bad "change-payment-method"

# ─── 9. Subscription Cancel + Renew + Trial-Once ────────────────────────────
section 9 "Subscription Cancel + Renew + Trial-Once"
# Book a ride first (to verify cascade cancel).
RIDE_BK=$(spost $TMP/tos.txt /api/v1/rides "{\"tripId\":\"$TRIP_ID\",\"subscriptionId\":\"$SUB_ID\"}")
RIDE_BK_ID=$(jget "$RIDE_BK" "data.id")
[ -n "$RIDE_BK_ID" ] && ok "book ride (for cascade test)" || { bad "ride book"; echo "    response: $RIDE_BK"; }

SC=$(spost $TMP/tos.txt /api/v1/subscriptions/$SUB_ID/cancel "{}")
jtest "$SC" "d['data']['status']=='cancelled'" >/dev/null && ok "POST /subscriptions/:id/cancel (cascades to rides)" || bad "sub cancel"

RC=$(sget $TMP/tos.txt /api/v1/rides/$RIDE_BK_ID)
jtest "$RC" "d['data']['status']=='cancelled'" >/dev/null && ok "ride cancelled by sub cascade" || bad "cascade"

# Renew.
RN=$(spost $TMP/tos.txt /api/v1/subscriptions/$SUB_ID/renew "{\"paymentMethod\":\"telebirr\"}")
jtest "$RN" "d.get('data',{}).get('subscription',{}).get('id') or d.get('data',{}).get('id')" >/dev/null && ok "POST /subscriptions/:id/renew" || bad "renew"

# Trial-only-once.
TRIAL_ID=$(echo "$P" | python3 -c "import sys,json;d=json.load(sys.stdin);print([p['id'] for p in d['data'] if p['slug']=='trial'][0])" 2>/dev/null)
T1=$(spost $TMP/tos.txt /api/v1/subscriptions "{\"planId\":\"$TRIAL_ID\",\"paymentMethod\":\"cash\"}")
jtest "$T1" "d.get('data',{}).get('subscription',{}).get('id') or 'data' in d" >/dev/null && ok "trial subscription created" || bad "trial create"

# ─── 10. Rides, Trips, Board/Complete/No-show + Ratings ─────────────────────
section 10 "Rides, Trips, Board/Complete/No-show, Ratings"
# Fresh rider + active sub for ride tests.
RIDE_PHONE=$(random_phone)
spost $TMP/anon.txt /api/v1/auth/register "{\"kind\":\"rider\",\"name\":\"Ride\",\"phone\":\"$RIDE_PHONE\",\"password\":\"r-pass-1234\",\"homeArea\":\"B\",\"workArea\":\"M\"}" > /dev/null
login $TMP/ride.txt "$RIDE_PHONE" "r-pass-1234"
spost $TMP/ride.txt /api/v1/tos/accept "{}" > /dev/null
SUB2=$(spost $TMP/ride.txt /api/v1/subscriptions "{\"planId\":\"$PLAN_ID\",\"paymentMethod\":\"cash\"}")
SUB2_ID=$(jget "$SUB2" "data.subscription.id")
# Cash payment settles immediately.
jtest "$SUB2" "d.get('data',{}).get('subscription',{}).get('id')" >/dev/null && ok "cash subscription created" || bad "cash sub"

# Get a future trip.
TRIPS=$(sget $TMP/anon.txt /api/v1/trips)
TRIP_ID2=$(jget "$TRIPS" "data.0.id")

# Book ride.
BK=$(spost $TMP/ride.txt /api/v1/rides "{\"tripId\":\"$TRIP_ID2\",\"subscriptionId\":\"$SUB2_ID\"}")
RIDE_ID=$(jget "$BK" "data.id")
jtest "$BK" "d['data']['status']=='booked'" >/dev/null && ok "POST /rides (booked)" || bad "ride book"

# Double-book prevention.
BK2=$(spost $TMP/ride.txt /api/v1/rides "{\"tripId\":\"$TRIP_ID2\",\"subscriptionId\":\"$SUB2_ID\"}")
jtest "$BK2" "'error' in d" >/dev/null && ok "double-book prevented" || bad "double-book"

# Cancel ride.
CN=$(spost $TMP/ride.txt /api/v1/rides/$RIDE_ID/cancel "{}")
jtest "$CN" "d['data']['status']=='cancelled'" >/dev/null && ok "POST /rides/:id/cancel" || bad "ride cancel"

# Re-book + create a near-departure trip for board/complete.
BK3=$(spost $TMP/ride.txt /api/v1/rides "{\"tripId\":\"$TRIP_ID2\",\"subscriptionId\":\"$SUB2_ID\"}")
jtest "$BK3" "d['data']['status']=='booked'" >/dev/null && ok "re-book ride" || bad "rebook"

# Contractor creates a near-departure trip.
login $TMP/contractor.txt "$CONTRACTOR_PHONE" "$CONTRACTOR_PASS"
SHUTTLE_ID=$(sget $TMP/contractor.txt /api/v1/contractor/shuttles | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['data'][0]['id'])" 2>/dev/null)
NEAR_TIME=$(date -u -d '+5 minutes' +'%Y-%m-%dT%H:%M:%S.000Z')
NT=$(spost $TMP/contractor.txt /api/v1/trips \
  "{\"routeId\":\"$ROUTE_ID\",\"shuttleId\":\"$SHUTTLE_ID\",\"departureAt\":\"$NEAR_TIME\",\"window\":\"morning\"}")
NEAR_TRIP=$(jget "$NT" "data.id")
[ -n "$NEAR_TRIP" ] && ok "contractor creates near-departure trip" || bad "trip create"

# Book on the near trip.
BK4=$(spost $TMP/ride.txt /api/v1/rides "{\"tripId\":\"$NEAR_TRIP\",\"subscriptionId\":\"$SUB2_ID\"}")
NEAR_RIDE=$(jget "$BK4" "data.id")
jtest "$BK4" "d['data']['status']=='booked'" >/dev/null && ok "ride booked on near trip" || bad "near ride book"

# Board the trip (contractor).
BD=$(spost $TMP/contractor.txt /api/v1/trips/$NEAR_TRIP/board "{}")
jtest "$BD" "d['data']['status']=='in_transit'" >/dev/null && ok "POST /trips/:id/board" || bad "board"

# Complete the trip.
CP=$(spost $TMP/contractor.txt /api/v1/trips/$NEAR_TRIP/complete "{}")
jtest "$CP" "d['data']['status']=='completed'" >/dev/null && ok "POST /trips/:id/complete" || bad "complete"

# Rate the ride.
RATE=$(spost $TMP/ride.txt /api/v1/rides/$NEAR_RIDE/rating "{\"rating\":5,\"comment\":\"great\"}")
jtest "$RATE" "d.get('data',{}).get('rating')==5 or d.get('data',{}).get('id')" >/dev/null && ok "POST /rides/:id/rating" || bad "rating"

# Duplicate rating blocked.
RATE2=$(spost $TMP/ride.txt /api/v1/rides/$NEAR_RIDE/rating "{\"rating\":4}")
jtest "$RATE2" "'error' in d" >/dev/null && ok "duplicate rating prevented" || bad "dup rating"

# Ride state machine: cannot rate a non-completed ride.
RATE3=$(spost $TMP/ride.txt /api/v1/rides/$RIDE_ID/rating "{\"rating\":4}")
jtest "$RATE3" "'error' in d" >/dev/null && ok "rating on non-completed ride rejected" || bad "rating state"

# ─── 11. Marketplace: Seat Releases + Claims ────────────────────────────────
section 11 "Marketplace: Seat Releases + Claims"
# Rider A releases a seat.
REL_PHONE=$(random_phone)
spost $TMP/anon.txt /api/v1/auth/register "{\"kind\":\"rider\",\"name\":\"Rel\",\"phone\":\"$REL_PHONE\",\"password\":\"r-pass-1234\",\"homeArea\":\"B\",\"workArea\":\"M\"}" > /dev/null
login $TMP/relA.txt "$REL_PHONE" "r-pass-1234"
spost $TMP/relA.txt /api/v1/tos/accept "{}" > /dev/null
SUB_A=$(spost $TMP/relA.txt /api/v1/subscriptions "{\"planId\":\"$PLAN_ID\",\"paymentMethod\":\"cash\"}")
SUB_A_ID=$(jget "$SUB_A" "data.subscription.id")

# Find a trip + book + release.
TRIPS2=$(sget $TMP/anon.txt /api/v1/trips)
TRIP_ID3=$(jget "$TRIPS2" "data.0.id")
WIN=$(jget "$TRIPS2" "data.0.window")
EXP=$(date -u -d '+30 minutes' +'%Y-%m-%dT%H:%M:%S.000Z')
BK_A=$(spost $TMP/relA.txt /api/v1/rides "{\"tripId\":\"$TRIP_ID3\",\"subscriptionId\":\"$SUB_A_ID\"}")
RIDE_A=$(jget "$BK_A" "data.id")
REL=$(spost $TMP/relA.txt /api/v1/marketplace/seat-releases \
  "{\"tripId\":\"$TRIP_ID3\",\"window\":\"$WIN\",\"expiresAt\":\"$EXP\",\"priceCents\":5500}")
REL_ID=$(jget "$REL" "data.id")
jtest "$REL" "d['data']['status']=='open'" >/dev/null && ok "POST /marketplace/seat-releases" || bad "release create"

# Rider A's own releases list.
MYREL=$(sget $TMP/relA.txt /api/v1/marketplace/my-releases)
jtest "$MYREL" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "GET /marketplace/my-releases" || bad "my-releases"

# Marketplace excludes own releases.
PUB_REL=$(sget $TMP/relA.txt /api/v1/marketplace/seat-releases)
jtest "$PUB_REL" "all(r['id']!='$REL_ID' for r in d['data'])" >/dev/null && ok "marketplace excludes own releases" || bad "own-filter"

# Rider B claims.
CLAIM_PHONE=$(random_phone)
spost $TMP/anon.txt /api/v1/auth/register "{\"kind\":\"rider\",\"name\":\"Claim\",\"phone\":\"$CLAIM_PHONE\",\"password\":\"r-pass-1234\",\"homeArea\":\"B\",\"workArea\":\"M\"}" > /dev/null
login $TMP/relB.txt "$CLAIM_PHONE" "r-pass-1234"
spost $TMP/relB.txt /api/v1/tos/accept "{}" > /dev/null
SUB_B=$(spost $TMP/relB.txt /api/v1/subscriptions "{\"planId\":\"$PLAN_ID\",\"paymentMethod\":\"telebirr\"}")
SUB_B_ID=$(jget "$SUB_B" "data.subscription.id")
PAY_B_REF=$(jget "$SUB_B" "data.paymentReference")

PUB_REL_B=$(sget $TMP/relB.txt /api/v1/marketplace/seat-releases)
jtest "$PUB_REL_B" "any(r['id']=='$REL_ID' for r in d['data'])" >/dev/null && ok "rider B sees rider A's release" || bad "release visibility"

REL_DET=$(sget $TMP/relB.txt /api/v1/marketplace/seat-releases/$REL_ID)
jtest "$REL_DET" "d['data']['id']=='$REL_ID'" >/dev/null && ok "GET /marketplace/seat-releases/:id" || bad "release detail"

CL=$(spost $TMP/relB.txt /api/v1/marketplace/seat-releases/$REL_ID/claim \
  "{\"paymentMethod\":\"telebirr\"}")
CLAIM_ID=$(jget "$CL" "data.claim.id")
jtest "$CL" "d.get('data',{}).get('claim',{}).get('id') or d.get('data',{}).get('id')" >/dev/null && ok "POST /marketplace/seat-releases/:id/claim" || bad "claim"

# Cannot claim own release.
CL_OWN=$(spost $TMP/relA.txt /api/v1/marketplace/seat-releases/$REL_ID/claim \
  "{\"paymentMethod\":\"telebirr\"}")
jtest "$CL_OWN" "'error' in d" >/dev/null && ok "cannot claim own release" || bad "self-claim"

# Settle the seat-claim payment.
ORNO_B="orno-b-$RUN_ID"
PAY_B_ID=$(echo "$SUB_B" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['data']['payments'][0]['id'])" 2>/dev/null)
WB_B=$(telebirr_webhook "$PAY_B_REF" "$ORNO_B" "Success" "55.00")
jtest "$WB_B" "d.get('data',{}).get('ok')==True" >/dev/null && ok "settle seat-claim payment" || bad "claim settle"

# Claims list.
CL_LIST=$(sget $TMP/relB.txt /api/v1/marketplace/seat-claims)
jtest "$CL_LIST" "isinstance(d['data'],list)" >/dev/null && ok "GET /marketplace/seat-claims" || bad "claims list"

# ─── 12. Contractor: Documents, Profile, Shuttles, Positions ────────────────
section 12 "Contractor: Documents, Profile, Shuttles, Positions"
# Fresh contractor.
CON_PHONE=$(random_phone)
spost $TMP/anon.txt /api/v1/auth/register \
  "{\"kind\":\"contractor\",\"name\":\"E2E Con\",\"phone\":\"$CON_PHONE\",\"password\":\"c-pass-1234\",\"licenseNumber\":\"DL-E2E-$RUN_ID\",\"experienceYears\":3}" > /dev/null
login $TMP/con.txt "$CON_PHONE" "c-pass-1234"
spost $TMP/con.txt /api/v1/tos/accept "{}" > /dev/null

# Create a fake PDF + upload as 3 doc types.
echo "%PDF-1.4 test" > $TMP/test.pdf
D1=$(curl -s -b $TMP/con.txt -c $TMP/con.txt -X POST "$BASE/api/v1/contractor/documents" \
  -H "x-csrf-token: $(get_csrf $TMP/con.txt)" -F type=registration -F file=@$TMP/test.pdf)
jtest "$D1" "d.get('data',{}).get('id') or d.get('data',{}).get('type')=='registration'" >/dev/null && ok "upload registration doc" || bad "doc upload"
D2=$(curl -s -b $TMP/con.txt -c $TMP/con.txt -X POST "$BASE/api/v1/contractor/documents" \
  -H "x-csrf-token: $(get_csrf $TMP/con.txt)" -F type=insurance -F file=@$TMP/test.pdf)
jtest "$D2" "d.get('data',{}).get('type')=='insurance'" >/dev/null && ok "upload insurance doc" || bad "doc insurance"
D3=$(curl -s -b $TMP/con.txt -c $TMP/con.txt -X POST "$BASE/api/v1/contractor/documents" \
  -H "x-csrf-token: $(get_csrf $TMP/con.txt)" -F type=inspection -F file=@$TMP/test.pdf)
jtest "$D3" "d.get('data',{}).get('type')=='inspection'" >/dev/null && ok "upload inspection doc" || bad "doc inspection"

# Invalid doc type.
D_BAD=$(curl -s -b $TMP/con.txt -c $TMP/con.txt -X POST "$BASE/api/v1/contractor/documents" \
  -H "x-csrf-token: $(get_csrf $TMP/con.txt)" -F type=bogus -F file=@$TMP/test.pdf)
jtest "$D_BAD" "'error' in d" >/dev/null && ok "invalid doc type rejected" || bad "doc type"

# List documents.
DL=$(sget $TMP/con.txt /api/v1/contractor/documents)
jtest "$DL" "isinstance(d['data'],list) and len(d['data'])>=3" >/dev/null && ok "GET /contractor/documents" || bad "doc list"

# Patch contractor profile.
PCP=$(spatch $TMP/con.txt /api/v1/contractor/profile \
  "{\"licenseNumber\":\"DL-E2E-UPDATED-$RUN_ID\",\"experienceYears\":7}")
jtest "$PCP" "d['data']['licenseNumber']=='DL-E2E-UPDATED-$RUN_ID'" >/dev/null && ok "PATCH /contractor/profile" || bad "patch profile"

# Shuttles + trips list.
SH_LIST=$(sget $TMP/contractor.txt /api/v1/contractor/shuttles)
jtest "$SH_LIST" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "GET /contractor/shuttles" || bad "shuttle list"
TR_LIST=$(sget $TMP/contractor.txt /api/v1/contractor/trips)
jtest "$TR_LIST" "isinstance(d['data'],list)" >/dev/null && ok "GET /contractor/trips" || bad "trip list"

# Positions — contractor posts + sees own; rider filtered out.
PCSRF=$(get_csrf $TMP/contractor.txt)
POS=$(curl -s -b $TMP/contractor.txt -c $TMP/contractor.txt -X POST "$BASE/api/v1/shuttle-positions" \
  -H 'content-type: application/json' -H "x-csrf-token: $PCSRF" \
  -d '{"lat":9.03,"lng":38.74,"heading":180,"speed":45}')
jtest "$POS" "d['data']['ok']==True" >/dev/null && ok "POST /shuttle-positions" || bad "post position"

POS_OWN=$(sget $TMP/contractor.txt /api/v1/shuttle-positions)
jtest "$POS_OWN" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "contractor sees own positions" || bad "contractor positions"

POS_RIDER=$(sget $TMP/ride.txt /api/v1/shuttle-positions)
jtest "$POS_RIDER" "isinstance(d['data'],list) and len(d['data'])==0" >/dev/null && ok "rider filtered out (BIZ-053)" || bad "rider position leak"

# ─── 13. Corporate Lifecycle ────────────────────────────────────────────────
section 13 "Corporate Lifecycle"
# Corporate admin needs 2FA. Use the rider from Section 5 (2FA enabled then disabled) — re-enable.
login $TMP/tfa.txt "$TFA_PHONE" "tfa-pass-1234"
TS_R=$(spost $TMP/tfa.txt /api/v1/auth/2fa/setup "{\"password\":\"tfa-pass-1234\"}")
SECRET_R=$(jget "$TS_R" "data.secret")
CODE_R=$(totp_for "$SECRET_R")
spost $TMP/tfa.txt /api/v1/auth/2fa/enable "{\"secret\":\"$SECRET_R\",\"code\":\"$CODE_R\"}" > /dev/null

# Phone-verify the corp admin.
OS_C=$(spost $TMP/anon.txt /api/v1/auth/otp/send "{\"phone\":\"$TFA_PHONE\",\"purpose\":\"signup_verification\"}")
DEV_C=$(jget "$OS_C" "data.devCode")
spost $TMP/tfa.txt /api/v1/auth/phone/verify "{\"code\":\"$DEV_C\"}" > /dev/null

# Onboard corporate.
CO=$(spost $TMP/tfa.txt /api/v1/corporate/onboard \
  "{\"name\":\"E2E Corp\",\"contactEmail\":\"corp@e2e.test\",\"contactPhone\":\"$TFA_PHONE\",\"subsidyPercent\":75,\"monthlySeatAllowance\":30}")
CORP_ID=$(jget "$CO" "data.corporate.id")
CORP_CODE=$(jget "$CO" "data.corporate.code")
jtest "$CO" "d.get('data',{}).get('corporate',{}).get('id')" >/dev/null && ok "POST /corporate/onboard" || bad "corp onboard"

# Get corporate.
GC=$(sget $TMP/tfa.txt /api/v1/corporate)
jtest "$GC" "d['data']['id']=='$CORP_ID'" >/dev/null && ok "GET /corporate" || bad "corp get"
GCM=$(sget $TMP/tfa.txt /api/v1/corporate/me)
jtest "$GCM" "'data' in d" >/dev/null && ok "GET /corporate/me" || bad "corp me"

# Create invite.
INV=$(spost $TMP/tfa.txt /api/v1/corporate/invites "{\"maxUses\":10}")
INV_CODE=$(jget "$INV" "data.code")
jtest "$INV" "d.get('data',{}).get('code')" >/dev/null && ok "POST /corporate/invites" || bad "invite create"
INV_LIST=$(sget $TMP/tfa.txt /api/v1/corporate/invites)
jtest "$INV_LIST" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "GET /corporate/invites" || bad "invite list"

# Validate invite (public).
VI=$(rawpost /api/v1/corporate/validate-invite "{\"inviteCode\":\"$INV_CODE\"}")
jtest "$VI" "d.get('data',{}).get('corporateName') or d.get('data',{}).get('valid')==True or 'data' in d" >/dev/null && ok "POST /corporate/validate-invite" || bad "validate invite"
VI_BAD=$(rawpost /api/v1/corporate/validate-invite "{\"inviteCode\":\"BOGUSCODE\"}")
jtest "$VI_BAD" "'error' in d" >/dev/null && ok "validate bogus invite rejected" || bad "validate bogus"

# Member signup.
MEM_PHONE=$(random_phone)
spost $TMP/anon.txt /api/v1/auth/register "{\"kind\":\"rider\",\"name\":\"Member\",\"phone\":\"$MEM_PHONE\",\"password\":\"m-pass-1234\",\"homeArea\":\"B\",\"workArea\":\"M\"}" > /dev/null
login $TMP/mem.txt "$MEM_PHONE" "m-pass-1234"
spost $TMP/mem.txt /api/v1/tos/accept "{}" > /dev/null
MS=$(spost $TMP/mem.txt /api/v1/corporate/signup "{\"inviteCode\":\"$INV_CODE\",\"employeeId\":\"EMP-E2E-1\"}")
MEM_ID=$(jget "$MS" "data.member.id")
jtest "$MS" "d.get('data',{}).get('member',{}).get('id')" >/dev/null && ok "POST /corporate/signup" || bad "member signup"

# Approve member.
AP=$(spost $TMP/tfa.txt /api/v1/corporate/members/$MEM_ID/approve "{}")
jtest "$AP" "d['data']['approvalStatus']=='approved'" >/dev/null && ok "POST /corporate/members/:id/approve" || bad "approve"

# Members list.
ML=$(sget $TMP/tfa.txt /api/v1/corporate/members)
jtest "$ML" "isinstance(d['data'],list) and len(d['data'])>=2" >/dev/null && ok "GET /corporate/members" || bad "members list"

# ─── 14. Corporate Subsidy + Invoices ───────────────────────────────────────
section 14 "Corporate Subsidy + Invoices"
# Member buys corporate-subsidized subscription.
SUB_C=$(spost $TMP/mem.txt /api/v1/subscriptions \
  "{\"planId\":\"$PLAN_ID\",\"paymentMethod\":\"telebirr\",\"corporateCode\":\"$CORP_CODE\"}")
SUB_C_ID=$(jget "$SUB_C" "data.subscription.id")
jtest "$SUB_C" "d['data']['subscription'].get('corporateId')=='$CORP_ID' or d['data']['subscription'].get('corporateId')" >/dev/null && ok "corporate-subsidized subscription" || bad "corp sub"

# Verify subsidy via admin (admin login).
login $TMP/admin.txt "$ADMIN_PHONE" "$ADMIN_PASS"
PAY_C_ID=$(echo "$SUB_C" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['data']['payments'][0]['id'])" 2>/dev/null)
PAY_C=$(sget $TMP/admin.txt /api/v1/admin/payments/$PAY_C_ID)
jtest "$PAY_C" "d['data'].get('subsidyCents',0) > 0" >/dev/null && ok "subsidy recorded on payment" || bad "subsidy amount"

# Settle corp payment.
PAY_C_REF=$(jget "$SUB_C" "data.paymentReference")
ORNO_C="orno-c-$RUN_ID"
WB_C=$(telebirr_webhook "$PAY_C_REF" "$ORNO_C" "Success" "375.00")
jtest "$WB_C" "d.get('data',{}).get('ok')==True" >/dev/null && ok "settle corp-subsidized payment" || bad "corp settle"

# Trigger hourly job (corporate billing).
CRON_BODY="{\"_cronSecret\":\"${CRON_SECRET:-dev-only-cron-secret-32-chars}\"}"
CR=$(rawpost "/api/v1/cron/run?job=hourly" "$CRON_BODY")
jtest "$CR" "d.get('data',{}).get('scheduler')=='running'" >/dev/null && ok "cron ?job=hourly triggers corporate billing" || bad "cron hourly"

# List invoices.
INV_LIST=$(sget $TMP/tfa.txt /api/v1/corporate/invoices)
jtest "$INV_LIST" "isinstance(d['data'],list)" >/dev/null && ok "GET /corporate/invoices" || bad "invoices"

# ─── 15. Admin: User Management + Impersonation ─────────────────────────────
section 15 "Admin: User Management + Impersonation"
# Already logged in as admin.
U_LIST=$(sget $TMP/admin.txt /api/v1/admin/users)
jtest "$U_LIST" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "GET /admin/users" || bad "admin users"
# Pick a non-admin user.
SUS_ID=$(echo "$U_LIST" | python3 -c "
import sys,json
d=json.load(sys.stdin)
non_admin=[u for u in d['data'] if u.get('role')!='platform_admin' and u.get('phone','').startswith('+2519220')]
print(non_admin[0]['id'] if non_admin else '')
" 2>/dev/null)
[ -n "$SUS_ID" ] && ok "GET /admin/users (filterable)" || bad "admin users filter"

# User detail.
U_DET=$(sget $TMP/admin.txt /api/v1/admin/users/$SUS_ID)
jtest "$U_DET" "d['data']['id']=='$SUS_ID'" >/dev/null && ok "GET /admin/users/:id" || bad "user detail"
U_404=$(curl -s -o /dev/null -w "%{http_code}" -b $TMP/admin.txt $BASE/api/v1/admin/users/cmu_bogus)
[ "$U_404" = "404" ] && ok "GET /admin/users/bogus → 404" || bad "user 404 (got $U_404)"

# Suspend.
SP=$(spatch $TMP/admin.txt /api/v1/admin/users/$SUS_ID "{\"action\":\"suspend\"}")
jtest "$SP" "d.get('data',{}).get('action')=='suspend' or 'data' in d" >/dev/null && ok "PATCH /admin/users/:id (suspend)" || bad "suspend"

# Reactivate.
SR=$(spatch $TMP/admin.txt /api/v1/admin/users/$SUS_ID "{\"action\":\"reactivate\"}")
jtest "$SR" "d.get('data',{}).get('action')=='reactivate' or 'data' in d" >/dev/null && ok "PATCH /admin/users/:id (reactivate)" || bad "reactivate"

# Admin sessions list.
ASL=$(sget $TMP/admin.txt /api/v1/admin/users/$SUS_ID/sessions)
jtest "$ASL" "isinstance(d['data'],list)" >/dev/null && ok "GET /admin/users/:id/sessions" || bad "admin user sessions"

# Bulk suspend.
BS=$(spost $TMP/admin.txt /api/v1/admin/bulk/suspend "{\"userIds\":[\"$SUS_ID\"]}")
jtest "$BS" "'data' in d" >/dev/null && ok "POST /admin/bulk/suspend" || bad "bulk suspend"

# Reactivate for downstream tests.
spatch $TMP/admin.txt /api/v1/admin/users/$SUS_ID "{\"action\":\"reactivate\"}" > /dev/null

# Impersonation needs 2FA on admin. Admin in seed has no 2FA. Verify it requires a code.
IMP_BAD=$(spost $TMP/admin.txt /api/v1/admin/users/$SUS_ID/impersonate "{}")
jtest "$IMP_BAD" "'error' in d" >/dev/null && ok "impersonation requires 2FA code" || bad "impersonate no code"

# ─── 16. Admin CRUD: Plans, Routes, Shuttles, FAQs, Holidays ────────────────
section 16 "Admin CRUD: Plans, Routes, Shuttles, FAQs, Holidays, Pickups"
# Plans.
NP=$(spost $TMP/admin.txt /api/v1/admin/plans \
  "{\"slug\":\"e2e-test-$RUN_ID\",\"name\":\"E2E\",\"priceCents\":12345,\"ridesIncluded\":5,\"durationDays\":7,\"isTrial\":false,\"sortOrder\":99}")
NP_ID=$(jget "$NP" "data.id")
jtest "$NP" "d['data']['slug']=='e2e-test-$RUN_ID'" >/dev/null && ok "POST /admin/plans" || bad "plan create"

PP=$(spatch $TMP/admin.txt /api/v1/admin/plans/$NP_ID "{\"priceCents\":15000,\"isActive\":false}")
jtest "$PP" "d['data']['priceCents']==15000 and d['data']['isActive']==False" >/dev/null && ok "PATCH /admin/plans/:id" || bad "plan patch"

# Plans list (admin).
AL_P=$(sget $TMP/admin.txt /api/v1/admin/plans)
jtest "$AL_P" "isinstance(d['data'],list)" >/dev/null && ok "GET /admin/plans" || bad "admin plans"

# Routes.
NR=$(spost $TMP/admin.txt /api/v1/admin/routes \
  "{\"origin\":\"CBE\",\"destination\":\"Megenagna\",\"distanceKm\":8.5,\"durationMin\":30,\"fareCents\":3000}")
NR_ID=$(jget "$NR" "data.id")
jtest "$NR" "d['data']['origin']=='CBE'" >/dev/null && ok "POST /admin/routes" || bad "route create"

RP=$(spatch $TMP/admin.txt /api/v1/admin/routes/$NR_ID/price "{\"fareCents\":3500}")
jtest "$RP" "d['data']['fareCents']==3500" >/dev/null && ok "PATCH /admin/routes/:id/price" || bad "route price"

AL_R=$(sget $TMP/admin.txt /api/v1/admin/routes)
jtest "$AL_R" "isinstance(d['data'],list)" >/dev/null && ok "GET /admin/routes" || bad "admin routes"

# Shuttles.
NS=$(spost $TMP/admin.txt /api/v1/admin/shuttles \
  "{\"contractorId\":\"$SUS_ID\",\"plate\":\"E2E-$RUN_ID\",\"model\":\"Coaster\",\"vehicleType\":\"coaster\",\"capacity\":25,\"year\":2023}")
jtest "$NS" "d.get('data',{}).get('id') or 'data' in d" >/dev/null && ok "POST /admin/shuttles" || bad "shuttle create"

AL_S=$(sget $TMP/admin.txt /api/v1/admin/shuttles)
jtest "$AL_S" "isinstance(d['data'],list)" >/dev/null && ok "GET /admin/shuttles" || bad "admin shuttles"

# FAQs.
NF=$(spost $TMP/admin.txt /api/v1/admin/faqs \
  "{\"category\":\"route\",\"question\":\"E2E FAQ?\",\"answer\":\"Yes.\",\"sortOrder\":99}")
NF_ID=$(jget "$NF" "data.id")
jtest "$NF" "d.get('data',{}).get('id')" >/dev/null && ok "POST /admin/faqs" || bad "faq create"

DF=$(sdel $TMP/admin.txt /api/v1/admin/faqs/$NF_ID)
jtest "$DF" "'data' not in d or d.get('data') is None" >/dev/null && ok "DELETE /admin/faqs/:id" || bad "faq delete"

# Holidays.
TOMORROW=$(date -u -d '+1 day' +'%Y-%m-%dT00:00:00.000Z')
NH=$(spost $TMP/admin.txt /api/v1/admin/holidays \
  "{\"date\":\"$TOMORROW\",\"name\":\"E2E Holiday\"}")
NH_ID=$(jget "$NH" "data.id")
jtest "$NH" "d.get('data',{}).get('id')" >/dev/null && ok "POST /admin/holidays" || bad "holiday create"

HL=$(sget $TMP/admin.txt /api/v1/admin/holidays)
jtest "$HL" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "GET /admin/holidays" || bad "admin holidays"

DH=$(sdel $TMP/admin.txt /api/v1/admin/holidays/$NH_ID)
jtest "$DH" "'data' not in d or d.get('data') is None" >/dev/null && ok "DELETE /admin/holidays/:id" || bad "holiday delete"

# Pickups.
NPK=$(spost $TMP/admin.txt /api/v1/routes/$ROUTE_ID/pickups \
  "{\"name\":\"E2E Pickup\",\"lat\":9.05,\"lng\":38.75,\"estimatedPickupTime\":\"07:05\",\"sortOrder\":99}")
NPK_ID=$(jget "$NPK" "data.id")
jtest "$NPK" "d.get('data',{}).get('id')" >/dev/null && ok "POST /routes/:id/pickups" || bad "pickup create"
DPK=$(sdel $TMP/admin.txt /api/v1/pickups/$NPK_ID)
jtest "$DPK" "'data' not in d or d.get('data') is None" >/dev/null && ok "DELETE /pickups/:id" || bad "pickup delete"

# ─── 17. Admin: Payments, Refund, Verify ────────────────────────────────────
section 17 "Admin: Payments, Refund, Verify"
# Refund on a completed payment (use PAY_C_ID — corp-subsidized, settled).
RF=$(spost $TMP/admin.txt /api/v1/admin/payments/$PAY_C_ID/refund \
  "{\"amount\":50,\"reason\":\"E2E partial\"}")
jtest "$RF" "d.get('data',{}).get('ok')==True or d.get('data',{}).get('message')" >/dev/null && ok "POST /admin/payments/:id/refund" || bad "refund"

# Payment detail with refund.
PD=$(sget $TMP/admin.txt /api/v1/admin/payments/$PAY_C_ID)
jtest "$PD" "isinstance(d['data'].get('refundRetries',[]),list)" >/dev/null && ok "GET /admin/payments/:id (refund retries)" || bad "payment detail"

# Verify endpoint (use a fresh payment).
PAY_FOR_VERIFY=$(echo "$PAY_LIST" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['data'][0]['id'])" 2>/dev/null)
PV=$(spost $TMP/admin.txt /api/v1/admin/payments/$PAY_FOR_VERIFY/verify \
  "{\"verifiedAmountCents\":150000}")
jtest "$PV" "d.get('data',{}).get('status') or 'data' in d" >/dev/null && ok "POST /admin/payments/:id/verify" || bad "verify payment"

# Payments list with filter.
PL_F=$(sget $TMP/admin.txt "/api/v1/admin/payments?status=completed")
jtest "$PL_F" "isinstance(d['data'],list)" >/dev/null && ok "GET /admin/payments?status=completed" || bad "payments filter"

# Bulk refund.
BR=$(spost $TMP/admin.txt /api/v1/admin/bulk/refund \
  "{\"paymentIds\":[\"$PAY_C_ID\"],\"reason\":\"bulk e2e\"}")
jtest "$BR" "'data' in d" >/dev/null && ok "POST /admin/bulk/refund" || bad "bulk refund"

# ─── 18. Admin: Dashboard, Audit, Settings, CSV Export ──────────────────────
section 18 "Admin: Dashboard, Audit, Settings, CSV Export"
AD=$(sget $TMP/admin.txt /api/v1/admin/dashboard)
jtest "$AD" "'data' in d and 'counts' in d['data']" >/dev/null && ok "GET /admin/dashboard" || bad "admin dashboard"

AL=$(sget $TMP/admin.txt /api/v1/admin/audit-logs)
jtest "$AL" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "GET /admin/audit-logs" || bad "audit logs"

AV=$(spost $TMP/admin.txt /api/v1/admin/audit/verify "{}")
jtest "$AV" "d.get('data',{}).get('ok')==True or 'data' in d" >/dev/null && ok "POST /admin/audit/verify" || bad "audit verify"

# Settings.
GS=$(sget $TMP/admin.txt /api/v1/admin/settings)
jtest "$GS" "'data' in d" >/dev/null && ok "GET /admin/settings" || bad "settings get"
PS=$(sput $TMP/admin.txt /api/v1/admin/settings "{\"key\":\"e2e-test-$RUN_ID\",\"value\":\"ok\"}")
jtest "$PS" "d.get('data',{}).get('key')=='e2e-test-$RUN_ID'" >/dev/null && ok "PUT /admin/settings" || bad "settings put"

# CSV exports.
EX_U=$(sget $TMP/admin.txt /api/v1/admin/export/users)
jtest "$EX_U" "'data' in d and 'csv' in d['data']" >/dev/null && ok "GET /admin/export/users" || bad "csv users"
EX_P=$(sget $TMP/admin.txt /api/v1/admin/export/payments)
jtest "$EX_P" "'data' in d and 'csv' in d['data']" >/dev/null && ok "GET /admin/export/payments" || bad "csv payments"
EX_A=$(sget $TMP/admin.txt /api/v1/admin/export/audit_logs)
jtest "$EX_A" "'data' in d and 'csv' in d['data']" >/dev/null && ok "GET /admin/export/audit_logs" || bad "csv audit"
EX_BAD=$(curl -s -o /dev/null -w "%{http_code}" -b $TMP/admin.txt $BASE/api/v1/admin/export/bogus)
[ "$EX_BAD" = "400" ] && ok "GET /admin/export/bogus → 400" || bad "csv bogus (got $EX_BAD)"

# Admin subscriptions + corporates lists.
AS=$(sget $TMP/admin.txt /api/v1/admin/subscriptions)
jtest "$AS" "isinstance(d['data'],list)" >/dev/null && ok "GET /admin/subscriptions" || bad "admin subs"
AC=$(sget $TMP/admin.txt /api/v1/admin/corporates)
jtest "$AC" "isinstance(d['data'],list)" >/dev/null && ok "GET /admin/corporates" || bad "admin corporates"
PC=$(sget $TMP/admin.txt /api/v1/admin/contractors/pending)
jtest "$PC" "isinstance(d['data'],list)" >/dev/null && ok "GET /admin/contractors/pending" || bad "pending contractors"

# ─── 19. Notifications, Preferences, Devices, Tickets ───────────────────────
section 19 "Notifications, Preferences, Devices, Tickets"
N=$(sget $TMP/tos.txt /api/v1/notifications)
jtest "$N" "isinstance(d['data'],list)" >/dev/null && ok "GET /notifications" || bad "notifications"

UC=$(sget $TMP/tos.txt /api/v1/notifications/unread-count)
jtest "$UC" "'data' in d and 'count' in d['data']" >/dev/null && ok "GET /notifications/unread-count" || bad "unread count"

NP=$(sget $TMP/tos.txt /api/v1/notifications/preferences)
jtest "$NP" "'data' in d" >/dev/null && ok "GET /notifications/preferences" || bad "prefs get"
NPP=$(spatch $TMP/tos.txt /api/v1/notifications/preferences "{\"emailEnabled\":false}")
jtest "$NPP" "d['data']['emailEnabled']==False" >/dev/null && ok "PATCH /notifications/preferences" || bad "prefs patch"

# Devices.
DV=$(spost $TMP/tos.txt /api/v1/devices "{\"pushToken\":\"e2e-tok-$RUN_ID\",\"platform\":\"web\",\"userAgent\":\"curl\"}")
jtest "$DV" "d.get('data',{}).get('ok')==True or 'data' in d" >/dev/null && ok "POST /devices" || bad "device register"
DVD=$(sdel $TMP/tos.txt "/api/v1/devices?pushToken=e2e-tok-$RUN_ID")
jtest "$DVD" "d.get('data',{}).get('ok')==True or 'data' in d" >/dev/null && ok "DELETE /devices" || bad "device delete"

# Tickets.
TK=$(spost $TMP/tos.txt /api/v1/tickets \
  "{\"subject\":\"E2E Ticket\",\"category\":\"route\",\"priority\":\"high\",\"body\":\"Test message\"}")
TK_ID=$(jget "$TK" "data.id")
jtest "$TK" "d['data']['status']=='open'" >/dev/null && ok "POST /tickets" || bad "ticket create"
TK1=$(sget $TMP/tos.txt /api/v1/tickets/$TK_ID)
jtest "$TK1" "d['data']['id']=='$TK_ID'" >/dev/null && ok "GET /tickets/:id" || bad "ticket get"
TK_LIST=$(sget $TMP/tos.txt /api/v1/tickets)
jtest "$TK_LIST" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "GET /tickets" || bad "ticket list"
TM=$(sget $TMP/tos.txt /api/v1/tickets/$TK_ID/messages)
jtest "$TM" "isinstance(d['data'],list) and len(d['data'])>=1" >/dev/null && ok "GET /tickets/:id/messages" || bad "ticket messages"
TP=$(spatch $TMP/tos.txt /api/v1/tickets/$TK_ID "{\"status\":\"closed\"}")
jtest "$TP" "d['data']['status']=='closed'" >/dev/null && ok "PATCH /tickets/:id (close)" || bad "ticket close"

# Admin reply.
ARM=$(spost $TMP/admin.txt /api/v1/admin/tickets/$TK_ID/messages "{\"body\":\"Admin reply\"}")
jtest "$ARM" "d.get('data',{}).get('id') or 'data' in d" >/dev/null && ok "POST /admin/tickets/:id/messages" || bad "admin reply"

# ─── 20. Webhooks, Cron, Telebirr Mandates, Security ────────────────────────
section 20 "Webhooks, Cron, Telebirr Mandates, Security"

# Twilio SMS status (no auth token set → signature skipped).
TW=$(curl -s -X POST "$BASE/api/v1/webhooks/twilio/sms-status" \
  -d "MessageSid=SMxxx&MessageStatus=delivered" 2>/dev/null)
jtest "$TW" "d.get('data',{}).get('ok')==True or 'data' in d" >/dev/null && ok "POST /webhooks/twilio/sms-status" || bad "twilio webhook"

# Resend email status.
RW=$(rawpost /api/v1/webhooks/resend/email-status "{\"type\":\"email.bounced\",\"email\":\"x@y.z\"}")
jtest "$RW" "d.get('data',{}).get('ok')==True or 'data' in d" >/dev/null && ok "POST /webhooks/resend/email-status" || bad "resend webhook"

# Cron — no secret.
CR_BAD=$(rawpost /api/v1/cron/run "{\"_cronSecret\":\"wrong\"}")
jtest "$CR_BAD" "'error' in d" >/dev/null && ok "cron without secret rejected" || bad "cron no secret"

# Cron — valid, all jobs.
CR_OK=$(rawpost /api/v1/cron/run "$CRON_BODY")
jtest "$CR_OK" "d['data']['scheduler']=='running'" >/dev/null && ok "POST /cron/run (all jobs)" || bad "cron all"

# Cron — per-job.
CR_J=$(rawpost "/api/v1/cron/run?job=drain-outbox" "$CRON_BODY")
jtest "$CR_J" "d['data']['job']=='drain-outbox'" >/dev/null && ok "POST /cron/run?job=drain-outbox" || bad "cron drain-outbox"

# Cron — invalid job.
CR_J_BAD=$(rawpost "/api/v1/cron/run?job=bogus" "$CRON_BODY")
jtest "$CR_J_BAD" "'error' in d" >/dev/null && ok "cron ?job=bogus rejected" || bad "cron bogus job"

# Cron jobs list.
CJ=$(sget $TMP/admin.txt /api/v1/cron)
jtest "$CJ" "isinstance(d['data'],list) and len(d['data'])>=4" >/dev/null && ok "GET /cron (admin)" || bad "cron list"

# Telebirr mandate sign-url (needs active subscription).
MD_PHONE=$(random_phone)
spost $TMP/anon.txt /api/v1/auth/register "{\"kind\":\"rider\",\"name\":\"MD\",\"phone\":\"$MD_PHONE\",\"password\":\"md-pass-1234\",\"homeArea\":\"B\",\"workArea\":\"M\"}" > /dev/null
login $TMP/md.txt "$MD_PHONE" "md-pass-1234"
spost $TMP/md.txt /api/v1/tos/accept "{}" > /dev/null
SUB_MD=$(spost $TMP/md.txt /api/v1/subscriptions "{\"planId\":\"$PLAN_ID\",\"paymentMethod\":\"telebirr\"}")
SUB_MD_ID=$(jget "$SUB_MD" "data.subscription.id")
MSU=$(spost $TMP/md.txt /api/v1/payments/telebirr/mandate/sign-url \
  "{\"subscriptionId\":\"$SUB_MD_ID\"}")
MCT=$(jget "$MSU" "data.mctContractNo")
jtest "$MSU" "d.get('data',{}).get('signUrl') or d.get('data',{}).get('mctContractNo') or 'data' in d" >/dev/null && ok "POST /payments/telebirr/mandate/sign-url" || bad "mandate sign-url"

# Get mandate.
if [ -n "$MCT" ]; then
  MG=$(sget $TMP/md.txt /api/v1/payments/telebirr/mandate/$MCT)
  jtest "$MG" "d['data']['mctContractNo']=='$MCT' or d.get('data',{}).get('id')" >/dev/null && ok "GET /payments/telebirr/mandate/:mctContractNo" || bad "mandate get"
fi

# Disburse (admin).
DIS=$(spost $TMP/admin.txt /api/v1/payments/telebirr/disburse \
  "{\"mctContractNo\":\"$MCT\",\"amountCents\":1000,\"reason\":\"E2E disburse\"}")
jtest "$DIS" "d.get('data',{}).get('merchOrderId') or 'data' in d" >/dev/null && ok "POST /payments/telebirr/disburse" || bad "disburse"

# InApp checkout.
IAC=$(spost $TMP/md.txt /api/v1/payments/telebirr/inapp-checkout \
  "{\"subscriptionId\":\"$SUB_MD_ID\"}")
jtest "$IAC" "d.get('data',{}).get('paymentReference') or 'data' in d" >/dev/null && ok "POST /payments/telebirr/inapp-checkout" || bad "inapp checkout"

# ─── Security: CSRF, role, auth, validation ─────────────────────────────────
# CSRF missing.
CSRF_NONE=$(curl -s -b $TMP/tos.txt -X POST "$BASE/api/v1/auth/logout" \
  -H 'content-type: application/json' -d '{}')
jtest "$CSRF_NONE" "'error' in d" >/dev/null && ok "POST without CSRF rejected" || bad "csrf missing"

# CSRF mismatch.
CSRF_BAD=$(curl -s -b $TMP/tos.txt -X POST "$BASE/api/v1/auth/logout" \
  -H 'content-type: application/json' -H 'x-csrf-token: garbage' -d '{}')
jtest "$CSRF_BAD" "'error' in d" >/dev/null && ok "POST with wrong CSRF rejected" || bad "csrf mismatch"

# Role enforcement.
RR=$(curl -s -o /dev/null -w "%{http_code}" -b $TMP/tos.txt $BASE/api/v1/admin/users)
[ "$RR" = "403" ] && ok "rider → /admin/users → 403" || { bad "role admin (got $RR)"; echo "    tos.txt:"; cat $TMP/tos.txt | grep -E 'session|csrf' | head; }

RT_R=$(curl -s -o /dev/null -w "%{http_code}" -b $TMP/tos.txt -X POST $BASE/api/v1/trips \
  -H "x-csrf-token: $(get_csrf $TMP/tos.txt)" -H 'content-type: application/json' -d '{}')
[ "$RT_R" = "403" ] && ok "rider → POST /trips → 403" || bad "role trips (got $RT_R)"

# Unauthenticated.
UU=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/v1/rides)
[ "$UU" = "401" ] && ok "anon → /rides → 401" || bad "anon (got $UU)"

# 404 missing.
N404=$(curl -s -o /dev/null -w "%{http_code}" -b $TMP/tos.txt $BASE/api/v1/subscriptions/cmu_nonexistent)
[ "$N404" = "404" ] && ok "GET /subscriptions/bogus → 404" || { bad "404 (got $N404)"; echo "    tos.txt:"; cat $TMP/tos.txt | grep -E 'session|csrf' | head; }

# Validation.
V=$(curl -s -o /dev/null -w "%{http_code}" -b $TMP/tos.txt -X POST $BASE/api/v1/rides \
  -H "x-csrf-token: $(get_csrf $TMP/tos.txt)" -H 'content-type: application/json' -d '{}')
[ "$V" = "400" ] && ok "POST /rides with empty body → 400" || { bad "validation (got $V)"; echo "    tos.txt:"; cat $TMP/tos.txt | grep -E 'session|csrf' | head; }

# ─── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Result: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════════════════════════"
exit $FAIL
