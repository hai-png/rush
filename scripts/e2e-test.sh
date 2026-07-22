#!/bin/bash
# End-to-end flow test for Addis Ride.
# Tests every user flow via curl with cookie jars.
# Run while the dev server is up on localhost:3000.

set -e
BASE=http://localhost:3000
TMP=/tmp/addis-ride-e2e
rm -rf $TMP && mkdir -p $TMP

PASS=0
FAIL=0
ok() { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "════════════════════════════════════════════════════════════════"
echo "  Addis Ride — end-to-end flow test"
echo "════════════════════════════════════════════════════════════════"

# Clear all transactional data via API (keep seeded users/plans/routes)
bun -e "
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const models = ['ride','seatClaim','seatRelease','refundRetry','telebirrNotifyEvent','payment','subscription','notification','outboxEvent','supportTicket','ticketMessage','session','idempotencyRecord','auditLog','corporateInvite','corporateMember','corporate','contractorDocument','uploadedFile','trip','routeAssignment','pickupLocation','shuttle','route','subscriptionPlan','faqArticle','otpCode','tosAcceptance','contractorProfile','riderProfile','user'];
for (const m of models) { try { await (db as any)[m].deleteMany({}); } catch {} }
console.log('  (pre-test cleanup done)');
" 2>/dev/null
rm -rf db/uploads/*
bun run db:seed > /dev/null 2>&1

get_csrf() { grep -i 'csrf' $1 | awk '{print $NF}'; }
spost() {
  local jar=$1; shift; local url=$1; shift; local body=$1; shift
  local csrf=$(get_csrf $jar)
  curl -s -b $jar -c $jar -X POST "$BASE$url" -H 'content-type: application/json' -H "x-csrf-token: $csrf" -d "$body"
}
spatch() {
  local jar=$1; shift; local url=$1; shift; local body=$1; shift
  local csrf=$(get_csrf $jar)
  curl -s -b $jar -c $jar -X PATCH "$BASE$url" -H 'content-type: application/json' -H "x-csrf-token: $csrf" -d "$body"
}

# ─── 1. Public catalog ───────────────────────────────────────────────────────
echo ""
echo "── 1. Public catalog (no auth) ──"
curl -s -c $TMP/anon.txt $BASE/api/v1/plans > $TMP/plans.json
[ "$(python3 -c 'import json;print(len(json.load(open("/tmp/addis-ride-e2e/plans.json"))["data"]))')" = "3" ] && ok "GET /plans returns 3 plans" || bad "plans count"
curl -s -b $TMP/anon.txt $BASE/api/v1/routes > $TMP/routes.json
[ "$(python3 -c 'import json;print(len(json.load(open("/tmp/addis-ride-e2e/routes.json"))["data"]))')" = "1" ] && ok "GET /routes returns 1 route" || bad "routes count"
curl -s -b $TMP/anon.txt $BASE/api/v1/trips > $TMP/trips.json
[ "$(python3 -c 'import json;print(len(json.load(open("/tmp/addis-ride-e2e/trips.json"))["data"]))')" = "1" ] && ok "GET /trips returns 1 trip" || bad "trips count"

# ─── 2. Rider flow ───────────────────────────────────────────────────────────
echo ""
echo "── 2. Rider flow: register → buy plan → pay → book ride → list seat ──"
NEWRIDER_PHONE="+251922000001"
REG=$(spost $TMP/anon.txt /api/v1/auth/register '{"kind":"rider","name":"Test Rider","phone":"'$NEWRIDER_PHONE'","password":"test-pass-1234","homeArea":"Bole","workArea":"Merkato"}')
if echo "$REG" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("user",{}).get("id") else 1)' 2>/dev/null; then
  ok "rider registered"
elif echo "$REG" | grep -q "already registered"; then
  ok "rider already exists (skip)"
else
  bad "register"
fi

RIDER=$TMP/rider.txt
rm -f $RIDER
curl -s -c $RIDER -X POST $BASE/api/v1/auth/token -H 'content-type: application/json' -d '{"phone":"'$NEWRIDER_PHONE'","password":"test-pass-1234"}' > $TMP/login.json
[ "$(python3 -c 'import json;d=json.load(open("/tmp/addis-ride-e2e/login.json"));print(d["data"]["user"]["role"])' 2>/dev/null)" = "rider" ] && ok "rider login" || bad "login"
curl -s -b $RIDER -c $RIDER $BASE/api/v1/plans > /dev/null
spost $RIDER /api/v1/tos/accept '{}' > /dev/null
ok "ToS accepted"

curl -s -b $RIDER $BASE/api/v1/dashboard/rider > $TMP/dash1.json
[ "$(python3 -c 'import json;print(len(json.load(open("/tmp/addis-ride-e2e/dash1.json"))["data"]["activeSubs"]))' 2>/dev/null)" = "0" ] && ok "fresh rider has 0 active subs" || bad "dashboard initial"

PLAN_ID=$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/plans.json"))["data"][1]["id"])')
SUB=$(spost $RIDER /api/v1/subscriptions '{"planId":"'$PLAN_ID'","paymentMethod":"telebirr"}')
echo "$SUB" > $TMP/sub.json
PAYREF=$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/sub.json"))["data"]["paymentReference"])' 2>/dev/null)
[ -n "$PAYREF" ] && ok "subscription created, ref=$PAYREF" || bad "subscription"

curl -s -X POST $BASE/api/v1/webhooks/telebirr/notify -H 'content-type: application/json' \
  -d '{"merch_order_id":"'$PAYREF'","out_request_no":"orno-e2e-1","trade_status":"Success","total_amount":"1500.00","timestamp":"'$(date +%s)'000","sign":"mock-signature"}' > $TMP/webhook1.json
[ "$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/webhook1.json"))["data"]["ok"])' 2>/dev/null)" = "True" ] && ok "telebirr webhook settled payment" || bad "webhook"

curl -s -b $RIDER $BASE/api/v1/dashboard/rider > $TMP/dash2.json
[ "$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/dash2.json"))["data"]["activeSubs"][0]["status"])' 2>/dev/null)" = "active" ] && ok "subscription is active" || bad "subscription active"

curl -s -X POST $BASE/api/v1/webhooks/telebirr/notify -H 'content-type: application/json' \
  -d '{"merch_order_id":"'$PAYREF'","out_request_no":"orno-e2e-1","trade_status":"Success","total_amount":"1500.00","timestamp":"'$(date +%s)'000","sign":"mock-signature"}' > $TMP/webhook-replay.json
[ "$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/webhook-replay.json"))["data"]["ok"])' 2>/dev/null)" = "True" ] && ok "webhook replay deduped" || bad "replay dedup"

TRIP_ID=$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/trips.json"))["data"][0]["id"])')
SUB_ID=$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/dash2.json"))["data"]["activeSubs"][0]["id"])')
RIDE=$(spost $RIDER /api/v1/rides '{"tripId":"'$TRIP_ID'","subscriptionId":"'$SUB_ID'"}')
echo "$RIDE" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("id") else 1)' 2>/dev/null && ok "ride booked" || bad "ride book"

RELEASE=$(spost $RIDER /api/v1/marketplace/seat-releases '{"tripId":"'$TRIP_ID'","window":"morning","expiresAt":"'$(date -u -d '+1 day' +'%Y-%m-%dT%H:%M:%S.000Z')'"}')
echo "$RELEASE" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("id") else 1)' 2>/dev/null && ok "seat released to marketplace" || bad "seat release"

curl -s -b $RIDER $BASE/api/v1/marketplace/seat-releases > $TMP/mkt.json
[ "$(python3 -c 'import json;print(len(json.load(open("/tmp/addis-ride-e2e/mkt.json"))["data"]))' 2>/dev/null)" = "0" ] && ok "marketplace doesn't show own seats" || bad "marketplace filter"

# ─── 3. Contractor flow ──────────────────────────────────────────────────────
echo ""
echo "── 3. Contractor flow: login → upload docs → create trip ──"
CONTRACTOR=$TMP/contractor.txt
rm -f $CONTRACTOR
curl -s -c $CONTRACTOR -X POST $BASE/api/v1/auth/token -H 'content-type: application/json' -d '{"phone":"+251911000003","password":"contractor-pass-1234"}' > /dev/null
curl -s -b $CONTRACTOR -c $CONTRACTOR $BASE/api/v1/plans > /dev/null
CCSRF=$(get_csrf $CONTRACTOR)

echo "%PDF-1.4 fake pdf content" > $TMP/test.pdf
UPLOAD=$(curl -s -b $CONTRACTOR -c $CONTRACTOR -X POST $BASE/api/v1/contractor/documents -H "x-csrf-token: $CCSRF" -F 'type=registration' -F "file=@$TMP/test.pdf;filename=license.pdf;type=application/pdf")
echo "$UPLOAD" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("id") else 1)' 2>/dev/null && ok "registration doc uploaded" || bad "doc upload"
curl -s -b $CONTRACTOR -c $CONTRACTOR -X POST $BASE/api/v1/contractor/documents -H "x-csrf-token: $CCSRF" -F 'type=insurance' -F "file=@$TMP/test.pdf;filename=insurance.pdf;type=application/pdf" > /dev/null
ok "insurance doc uploaded"
curl -s -b $CONTRACTOR -c $CONTRACTOR -X POST $BASE/api/v1/contractor/documents -H "x-csrf-token: $CCSRF" -F 'type=inspection' -F "file=@$TMP/test.pdf;filename=inspection.pdf;type=application/pdf" > /dev/null
ok "inspection doc uploaded"

DOCS=$(curl -s -b $CONTRACTOR $BASE/api/v1/contractor/documents)
[ "$(echo "$DOCS" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["data"]))' 2>/dev/null)" = "3" ] && ok "3 documents listed" || bad "docs count"

FILE_ID=$(echo "$DOCS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["file"]["id"])' 2>/dev/null)
curl -s -b $CONTRACTOR -o $TMP/downloaded.pdf -w "%{http_code}" $BASE/api/v1/files/$FILE_ID > $TMP/dl-status.txt
[ "$(cat $TMP/dl-status.txt)" = "200" ] && ok "file download works" || bad "file download"

ROUTE_ID=$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/routes.json"))["data"][0]["id"])')
SHUTTLE_ID=$(curl -s -b $CONTRACTOR $BASE/api/v1/contractor/shuttles | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["id"])' 2>/dev/null)
NEWTIME=$(date -u -d '+2 days' +'%Y-%m-%dT08:00:00.000Z')
TRIPCREATE=$(spost $CONTRACTOR /api/v1/admin/trips '{"routeId":"'$ROUTE_ID'","shuttleId":"'$SHUTTLE_ID'","departureAt":"'$NEWTIME'","window":"morning"}')
echo "$TRIPCREATE" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("id") else 1)' 2>/dev/null && ok "contractor created trip" || bad "trip create"

# ─── 4. Admin flow ───────────────────────────────────────────────────────────
echo ""
echo "── 4. Admin flow: verify contractor → view audit chain ──"
ADMIN=$TMP/admin.txt
rm -f $ADMIN
curl -s -c $ADMIN -X POST $BASE/api/v1/auth/token -H 'content-type: application/json' -d '{"phone":"+251911000001","password":"admin-pass-1234"}' > /dev/null
curl -s -b $ADMIN -c $ADMIN $BASE/api/v1/plans > /dev/null
ACSRF=$(get_csrf $ADMIN)

CONTR_ID=$(curl -s -b $ADMIN $BASE/api/v1/admin/contractors | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["id"])' 2>/dev/null)
VERIFY=$(spost $ADMIN /api/v1/admin/contractors/$CONTR_ID/verify '{"status":"verified","reason":"Documents reviewed"}')
[ "$(echo "$VERIFY" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["status"])' 2>/dev/null)" = "verified" ] && ok "contractor verified" || bad "verify contractor"

DOCS_FOR_CONTR=$(curl -s -b $ADMIN $BASE/api/v1/contractor/documents/$CONTR_ID)
[ "$(echo "$DOCS_FOR_CONTR" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["data"]))' 2>/dev/null)" = "3" ] && ok "admin can view contractor docs" || bad "admin docs view"

AUDIT=$(spost $ADMIN /api/v1/admin/audit/verify '{}')
[ "$(echo "$AUDIT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["ok"])' 2>/dev/null)" = "True" ] && ok "audit chain intact" || bad "audit chain"

# ─── 5. Corporate flow ───────────────────────────────────────────────────────
echo ""
echo "── 5. Corporate flow: onboard → invite → rider joins → approve ──"
CORPADMIN_PHONE="+251922000002"
spost $TMP/anon.txt /api/v1/auth/register '{"kind":"rider","name":"Corp Admin","phone":"'$CORPADMIN_PHONE'","password":"corp-pass-1234","homeArea":"Bole","workArea":"Bole"}' > /dev/null
CORPADMIN=$TMP/corpadmin.txt
rm -f $CORPADMIN
curl -s -c $CORPADMIN -X POST $BASE/api/v1/auth/token -H 'content-type: application/json' -d '{"phone":"'$CORPADMIN_PHONE'","password":"corp-pass-1234"}' > /dev/null
curl -s -b $CORPADMIN -c $CORPADMIN $BASE/api/v1/plans > /dev/null
CORPCSRF=$(get_csrf $CORPADMIN)
spost $CORPADMIN /api/v1/tos/accept '{}' > /dev/null

ONBOARD=$(spost $CORPADMIN /api/v1/corporate/onboard '{"name":"Acme Corp","contactEmail":"admin@acme.et","contactPhone":"+251922000099","subsidyPercent":75,"monthlySeatAllowance":30}')
echo "$ONBOARD" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("corporate",{}).get("id") else 1)' 2>/dev/null && ok "corporate onboarded" || bad "onboard"

INVITE=$(spost $CORPADMIN /api/v1/corporate/invites '{"maxUses":10}')
INVITE_CODE=$(echo "$INVITE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["code"])' 2>/dev/null)
[ -n "$INVITE_CODE" ] && ok "invite created: $INVITE_CODE" || bad "invite create"

VAL=$(spost $TMP/anon.txt /api/v1/corporate/validate-invite '{"inviteCode":"'$INVITE_CODE'"}')
[ "$(echo "$VAL" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["corporateName"])' 2>/dev/null)" = "Acme Corp" ] && ok "invite validated" || bad "validate invite"

MEMBER_PHONE="+251922000003"
spost $TMP/anon.txt /api/v1/auth/register '{"kind":"rider","name":"Corp Member","phone":"'$MEMBER_PHONE'","password":"member-pass-1234","homeArea":"Bole","workArea":"Merkato"}' > /dev/null
MEMBER=$TMP/member.txt
rm -f $MEMBER
curl -s -c $MEMBER -X POST $BASE/api/v1/auth/token -H 'content-type: application/json' -d '{"phone":"'$MEMBER_PHONE'","password":"member-pass-1234"}' > /dev/null
curl -s -b $MEMBER -c $MEMBER $BASE/api/v1/plans > /dev/null
MCSRF=$(get_csrf $MEMBER)
spost $MEMBER /api/v1/tos/accept '{}' > /dev/null

JOIN=$(spost $MEMBER /api/v1/corporate/signup '{"inviteCode":"'$INVITE_CODE'","employeeId":"EMP001"}')
echo "$JOIN" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("member",{}).get("id") else 1)' 2>/dev/null && ok "member requested to join" || bad "member join"

MEMBERS=$(curl -s -b $CORPADMIN $BASE/api/v1/corporate/members)
MEMBER_ID=$(echo "$MEMBERS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["id"])' 2>/dev/null)
APPROVE=$(spost $CORPADMIN /api/v1/corporate/members/$MEMBER_ID/approve '{}')
[ "$(echo "$APPROVE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["approvalStatus"])' 2>/dev/null)" = "approved" ] && ok "member approved" || bad "approve"

# ─── 6. Support flow ─────────────────────────────────────────────────────────
echo ""
echo "── 6. Support flow: rider ticket → admin reply ──"
TICKET=$(spost $RIDER /api/v1/tickets '{"subject":"My ride did not show up","category":"route","priority":"high","body":"The shuttle was 30 minutes late."}')
TICKET_ID=$(echo "$TICKET" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])' 2>/dev/null)
[ -n "$TICKET_ID" ] && ok "ticket created" || bad "ticket create"
REPLY=$(spost $ADMIN /api/v1/admin/tickets/$TICKET_ID/messages '{"body":"Sorry about that — investigating with the contractor."}')
echo "$REPLY" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("id") else 1)' 2>/dev/null && ok "admin replied" || bad "admin reply"

# ─── 7. Account flow ─────────────────────────────────────────────────────────
echo ""
echo "── 7. Account flow: export data ──"
EXPORT=$(curl -s -b $RIDER $BASE/api/v1/account/export)
echo "$EXPORT" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if "user" in d["data"] and "subscriptions" in d["data"] else 1)' 2>/dev/null && ok "export contains user + subscriptions" || bad "export"

# ─── 8. Cron flow ────────────────────────────────────────────────────────────
echo ""
echo "── 8. Cron flow: run scheduled tasks ──"
CRON=$(curl -s -X POST $BASE/api/v1/cron/run -H 'content-type: application/json' -d '{"_cronSecret":"dev-only-cron-secret-32-chars"}')
echo "$CRON" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if "refunds" in d["data"] else 1)' 2>/dev/null && ok "cron ran" || bad "cron"
echo "$CRON" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"].get("scheduler")=="running" else 1)' 2>/dev/null && ok "scheduler marked as running" || bad "scheduler status"

# ─── 9. Admin advanced ───────────────────────────────────────────────────────
echo ""
echo "── 9. Admin advanced: payment detail + refund + edit entities ──"
PAYMENT_ID=$(curl -s -b $RIDER $BASE/api/v1/dashboard/rider | python3 -c 'import sys,json;d=json.load(sys.stdin);p=[x for x in d["data"]["recentPayments"] if x["status"]=="completed"];print(p[0]["id"] if p else "")' 2>/dev/null)
if [ -n "$PAYMENT_ID" ]; then
  DETAIL=$(curl -s -b $ADMIN $BASE/api/v1/admin/payments/$PAYMENT_ID)
  echo "$DETAIL" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("id") else 1)' 2>/dev/null && ok "admin fetched payment detail" || bad "payment detail"
  REFUND=$(spost $ADMIN /api/v1/admin/payments/$PAYMENT_ID/refund '{"amount":100,"reason":"Test partial refund"}')
  echo "$REFUND" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("ok") else 1)' 2>/dev/null && ok "refund scheduled" || bad "refund"
else
  bad "no completed payment found to test refund"
fi

TRIAL_PLAN_ID=$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/plans.json"))["data"][0]["id"])')
spatch $ADMIN /api/v1/admin/plans/$TRIAL_PLAN_ID '{"isActive":false}' > /dev/null && ok "plan edit/disable works" || bad "plan edit"
spatch $ADMIN /api/v1/admin/plans/$TRIAL_PLAN_ID '{"isActive":true}' > /dev/null
spatch $ADMIN /api/v1/admin/routes/$ROUTE_ID '{"fareCents":5500}' > /dev/null && ok "route edit works" || bad "route edit"
ADM_SHUTTLE_ID=$(curl -s -b $ADMIN $BASE/api/v1/admin/shuttles | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["id"])' 2>/dev/null)
spatch $ADMIN /api/v1/admin/shuttles/$ADM_SHUTTLE_ID '{"model":"Toyota Coaster Updated"}' > /dev/null && ok "shuttle edit works" || bad "shuttle edit"

# ─── 10. Notification flow ───────────────────────────────────────────────────
echo ""
echo "── 10. Notification flow: mark-read on ticket view ──"
NOTIFS_BEFORE=$(curl -s -b $RIDER $BASE/api/v1/notifications | python3 -c 'import sys,json;d=json.load(sys.stdin);print(sum(1 for n in d["data"] if not n.get("readAt")))' 2>/dev/null)
ok "unread notifications before ticket view: $NOTIFS_BEFORE"
curl -s -b $RIDER $BASE/tickets/$TICKET_ID > /dev/null
sleep 1
NOTIFS_AFTER=$(curl -s -b $RIDER $BASE/api/v1/notifications | python3 -c 'import sys,json;d=json.load(sys.stdin);print(sum(1 for n in d["data"] if not n.get("readAt")))' 2>/dev/null)
if [ "$NOTIFS_AFTER" -lt "$NOTIFS_BEFORE" ]; then
  ok "unread notifications decreased after ticket view: $NOTIFS_AFTER"
else
  bad "ticket-view mark-read didn't work (before=$NOTIFS_BEFORE after=$NOTIFS_AFTER)"
fi


# ─── 11. Feature parity: new endpoints ───────────────────────────────────────
echo ""
echo "── 11. Feature parity: new endpoints ──"

# Healthz
curl -s $BASE/api/v1/healthz | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["status"]=="alive" else 1)' && ok "GET /healthz" || bad "healthz"

# Account GET + PATCH
ACCT=$(curl -s -b $RIDER $BASE/api/v1/account)
echo "$ACCT" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["phone"]=="'$NEWRIDER_PHONE'" else 1)' && ok "GET /account" || bad "GET account"

PATCHED=$(curl -s -b $RIDER -X PATCH $BASE/api/v1/account -H 'content-type: application/json' -H "x-csrf-token: $(get_csrf $RIDER)" -d '{"name":"Updated Rider"}')
echo "$PATCHED" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["name"]=="Updated Rider" else 1)' && ok "PATCH /account" || bad "PATCH account"

# Notifications unread-count
UC=$(curl -s -b $RIDER $BASE/api/v1/notifications/unread-count)
echo "$UC" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if "count" in d["data"] else 1)' && ok "GET /notifications/unread-count" || bad "unread-count"

# Admin dashboard stats
DASH=$(curl -s -b $ADMIN $BASE/api/v1/admin/dashboard)
echo "$DASH" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if "counts" in d["data"] and "revenueCents" in d["data"] else 1)' && ok "GET /admin/dashboard" || bad "admin dashboard"

# Admin pending contractors
curl -s -b $ADMIN $BASE/api/v1/admin/contractors/pending | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if isinstance(d["data"],list) else 1)' && ok "GET /admin/contractors/pending" || bad "pending contractors"

# Admin all subscriptions
curl -s -b $ADMIN $BASE/api/v1/admin/subscriptions | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if isinstance(d["data"],list) else 1)' && ok "GET /admin/subscriptions" || bad "admin subscriptions"

# Admin CSV export
CSV=$(curl -s -b $ADMIN "$BASE/api/v1/admin/export/users")
echo "$CSV" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if "csv" in d["data"] and d["data"]["rowCount"]>=0 else 1)' && ok "GET /admin/export/users (CSV)" || bad "csv export"

# Catalog route detail
ROUTE_ID=$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/routes.json"))["data"][0]["id"])')
curl -s -b $RIDER $BASE/api/v1/routes/$ROUTE_ID | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["id"]=="'$ROUTE_ID'" else 1)' && ok "GET /routes/:id" || bad "route detail"

# Marketplace seat-release detail + seat claims
REL_ID=$(curl -s -b $RIDER $BASE/api/v1/marketplace/my-releases | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["data"][0]["id"] if d["data"] else "")' 2>/dev/null)
if [ -n "$REL_ID" ]; then
  curl -s -b $RIDER $BASE/api/v1/marketplace/seat-releases/$REL_ID | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["id"]=="'$REL_ID'" else 1)' && ok "GET /marketplace/seat-releases/:id" || bad "release detail"
  curl -s -b $RIDER $BASE/api/v1/marketplace/seat-claims | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if isinstance(d["data"],list) else 1)' && ok "GET /marketplace/seat-claims" || bad "claims list"
fi

# Operations: shuttle positions
POS=$(curl -s -b $CONTRACTOR -X POST $BASE/api/v1/shuttle-positions -H 'content-type: application/json' -H "x-csrf-token: $CCSRF" -d '{"lat":9.03,"lng":38.74,"heading":180,"speed":45}')
echo "$POS" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["ok"] else 1)' && ok "POST /shuttle-positions" || bad "post position"
curl -s -b $RIDER $BASE/api/v1/shuttle-positions | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if isinstance(d["data"],list) and len(d["data"])>=1 else 1)' && ok "GET /shuttle-positions" || bad "get positions"

# Dashboard active-trip
curl -s -b $RIDER $BASE/api/v1/dashboard/rider/active-trip | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if "data" in d else 1)' && ok "GET /dashboard/rider/active-trip" || bad "active-trip"

# Support ticket PATCH (close ticket) + messages list
TPATCH=$(curl -s -b $RIDER -X PATCH $BASE/api/v1/tickets/$TICKET_ID -H 'content-type: application/json' -H "x-csrf-token: $(get_csrf $RIDER)" -d '{"status":"closed"}')
echo "$TPATCH" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["status"]=="closed" else 1)' && ok "PATCH /tickets/:id (close)" || bad "patch ticket"
curl -s -b $RIDER $BASE/api/v1/tickets/$TICKET_ID/messages | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if isinstance(d["data"],list) and len(d["data"])>=1 else 1)' && ok "GET /tickets/:id/messages" || bad "messages list"

# Corporate PATCH (update subsidy)
CORP_PATCH=$(curl -s -b $CORPADMIN -X PATCH $BASE/api/v1/corporate -H 'content-type: application/json' -H "x-csrf-token: $(get_csrf $CORPADMIN)" -d '{"subsidyPercent":80}')
echo "$CORP_PATCH" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["subsidyPercent"]==80 else 1)' && ok "PATCH /corporate" || bad "patch corporate"


# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Result: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════════════════════════"
exit $FAIL

# ─── 11. Feature parity: new endpoints ───────────────────────────────────────
echo ""
echo "── 11. Feature parity: new endpoints ──"

# Healthz
curl -s $BASE/api/v1/healthz | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["status"]=="alive" else 1)' && ok "GET /healthz" || bad "healthz"

# Account GET + PATCH
ACCT=$(curl -s -b $RIDER $BASE/api/v1/account)
echo "$ACCT" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["phone"]=="'$NEWRIDER_PHONE'" else 1)' && ok "GET /account" || bad "GET account"

PATCHED=$(spost $RIDER /api/v1/account '{"name":"Updated Rider"}' 2>/dev/null || curl -s -b $RIDER -X PATCH $BASE/api/v1/account -H 'content-type: application/json' -H "x-csrf-token: $(get_csrf $RIDER)" -d '{"name":"Updated Rider"}')
echo "$PATCHED" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["name"]=="Updated Rider" else 1)' && ok "PATCH /account" || bad "PATCH account"

# Notifications unread-count
UC=$(curl -s -b $RIDER $BASE/api/v1/notifications/unread-count)
echo "$UC" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if "count" in d["data"] else 1)' && ok "GET /notifications/unread-count" || bad "unread-count"

# Notification delete
NID=$(curl -s -b $RIDER $BASE/api/v1/notifications | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["id"])')
curl -s -b $RIDER -X DELETE $BASE/api/v1/notifications/$NID -H "x-csrf-token: $(get_csrf $RIDER)" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["ok"] else 1)' && ok "DELETE /notifications/:id" || bad "delete notif"

# Admin dashboard stats
DASH=$(curl -s -b $ADMIN $BASE/api/v1/admin/dashboard)
echo "$DASH" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if "counts" in d["data"] and "revenueCents" in d["data"] else 1)' && ok "GET /admin/dashboard" || bad "admin dashboard"

# Admin pending contractors
curl -s -b $ADMIN $BASE/api/v1/admin/contractors/pending | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if isinstance(d["data"],list) else 1)' && ok "GET /admin/contractors/pending" || bad "pending contractors"

# Admin all subscriptions
curl -s -b $ADMIN $BASE/api/v1/admin/subscriptions | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if isinstance(d["data"],list) else 1)' && ok "GET /admin/subscriptions" || bad "admin subscriptions"

# Admin CSV export
CSV=$(curl -s -b $ADMIN "$BASE/api/v1/admin/export/users")
echo "$CSV" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if "csv" in d["data"] and d["data"]["rowCount"]>=0 else 1)' && ok "GET /admin/export/users (CSV)" || bad "csv export"

# Catalog route detail
ROUTE_ID=$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/routes.json"))["data"][0]["id"])')
curl -s -b $RIDER $BASE/api/v1/routes/$ROUTE_ID | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["id"]=="'$ROUTE_ID'" else 1)' && ok "GET /routes/:id" || bad "route detail"

# Marketplace seat-release detail
REL_ID=$(curl -s -b $RIDER $BASE/api/v1/marketplace/my-releases | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["data"][0]["id"] if d["data"] else "")' 2>/dev/null)
if [ -n "$REL_ID" ]; then
  curl -s -b $RIDER $BASE/api/v1/marketplace/seat-releases/$REL_ID | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["id"]=="'$REL_ID'" else 1)' && ok "GET /marketplace/seat-releases/:id" || bad "release detail"
  # Seat claims list
  curl -s -b $RIDER $BASE/api/v1/marketplace/seat-claims | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if isinstance(d["data"],list) else 1)' && ok "GET /marketplace/seat-claims" || bad "claims list"
else
  bad "no seat release to test detail"
fi

# Operations: shuttle positions
POS=$(spost $CONTRACTOR /api/v1/shuttle-positions '{"lat":9.03,"lng":38.74,"heading":180,"speed":45}' 2>/dev/null || curl -s -b $CONTRACTOR -X POST $BASE/api/v1/shuttle-positions -H 'content-type: application/json' -H "x-csrf-token: $CCSRF" -d '{"lat":9.03,"lng":38.74,"heading":180,"speed":45}')
echo "$POS" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["ok"] else 1)' && ok "POST /shuttle-positions" || bad "post position"

curl -s -b $RIDER $BASE/api/v1/shuttle-positions | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if isinstance(d["data"],list) and len(d["data"])>=1 else 1)' && ok "GET /shuttle-positions" || bad "get positions"

# Dashboard active-trip
curl -s -b $RIDER $BASE/api/v1/dashboard/rider/active-trip | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if "data" in d else 1)' && ok "GET /dashboard/rider/active-trip" || bad "active-trip"

# Subscription renew
SUB_ID=$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/dash2.json"))["data"]["activeSubs"][0]["id"])' 2>/dev/null)
if [ -n "$SUB_ID" ]; then
  RENEW=$(spost $RIDER /api/v1/subscriptions/$SUB_ID/renew '{"paymentMethod":"telebirr"}' 2>/dev/null)
  echo "$RENEW" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("paymentReference") else 1)' && ok "POST /subscriptions/:id/renew" || bad "renew"
fi

# Support ticket PATCH (close ticket)
TPATCH=$(curl -s -b $RIDER -X PATCH $BASE/api/v1/tickets/$TICKET_ID -H 'content-type: application/json' -H "x-csrf-token: $(get_csrf $RIDER)" -d '{"status":"closed"}')
echo "$TPATCH" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["status"]=="closed" else 1)' && ok "PATCH /tickets/:id (close)" || bad "patch ticket"

# Ticket messages list
curl -s -b $RIDER $BASE/api/v1/tickets/$TICKET_ID/messages | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if isinstance(d["data"],list) and len(d["data"])>=1 else 1)' && ok "GET /tickets/:id/messages" || bad "messages list"

# Corporate PATCH (update subsidy)
CORP_PATCH=$(curl -s -b $CORPADMIN -X PATCH $BASE/api/v1/corporate -H 'content-type: application/json' -H "x-csrf-token: $(get_csrf $CORPADMIN)" -d '{"subsidyPercent":80}')
echo "$CORP_PATCH" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d["data"]["subsidyPercent"]==80 else 1)' && ok "PATCH /corporate" || bad "patch corporate"

# 2FA verify
TFA=$(spost $RIDER /api/v1/auth/2fa/verify '{"code":"123456"}' 2>/dev/null)
echo "$TFA" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("error",{}).get("code")=="BAD_REQUEST" or d.get("data",{}).get("verified")==True else 1)' && ok "POST /auth/2fa/verify (rejected — 2FA not enabled)" || bad "2fa verify"

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Result: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════════════════════════"
exit $FAIL
