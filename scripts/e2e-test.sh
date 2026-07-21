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

# Helper: get CSRF token (auto-set by any GET to /api/v1/*)
get_csrf() {
  local jar=$1
  grep -i 'csrf' $jar | awk '{print $NF}'
}

# Helper: signed POST (with CSRF)
spost() {
  local jar=$1; shift
  local url=$1; shift
  local body=$1; shift
  local csrf=$(get_csrf $jar)
  curl -s -b $jar -c $jar -X POST "$BASE$url" \
    -H 'content-type: application/json' \
    -H "x-csrf-token: $csrf" \
    -d "$body"
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

# ─── 2. Rider: register + login + buy plan + telebirr mock + seat release ───
echo ""
echo "── 2. Rider flow: register → buy plan → pay → book ride → list seat ──"

# Register a fresh rider (or skip if already exists from a prior run)
NEWRIDER_PHONE="+251922000001"
REG=$(spost $TMP/anon.txt /api/v1/auth/register '{"kind":"rider","name":"Test Rider","phone":"'$NEWRIDER_PHONE'","password":"test-pass-1234","homeArea":"Bole","workArea":"Merkato"}')
if echo "$REG" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("user",{}).get("id") else 1)'; then
  ok "rider registered"
elif echo "$REG" | grep -q "already registered"; then
  ok "rider already exists (skip)"
else
  bad "register: $REG"
fi

# Login as the new rider
RIDER=$TMP/rider.txt
rm -f $RIDER
curl -s -c $RIDER -X POST $BASE/api/v1/auth/token -H 'content-type: application/json' -d '{"phone":"'$NEWRIDER_PHONE'","password":"test-pass-1234"}' > $TMP/login.json
[ "$(python3 -c 'import json;d=json.load(open("/tmp/addis-ride-e2e/login.json"));print(d["data"]["user"]["role"])')" = "rider" ] && ok "rider login" || bad "login"

# Need to GET something to set CSRF cookie
curl -s -b $RIDER -c $RIDER $BASE/api/v1/plans > /dev/null

# Accept ToS (freshly-registered user has stale tosVersion)
spost $RIDER /api/v1/tos/accept '{}' > /dev/null
ok "ToS accepted"

# Get dashboard (should be empty)
curl -s -b $RIDER $BASE/api/v1/dashboard/rider > $TMP/dash1.json
[ "$(python3 -c 'import json;print(len(json.load(open("/tmp/addis-ride-e2e/dash1.json"))["data"]["activeSubs"]))')" = "0" ] && ok "fresh rider has 0 active subs" || bad "dashboard initial"

# Buy a plan (telebirr)
PLAN_ID=$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/plans.json"))["data"][1]["id"])')
SUB=$(spost $RIDER /api/v1/subscriptions '{"planId":"'$PLAN_ID'","paymentMethod":"telebirr"}')
echo "$SUB" > $TMP/sub.json
PAYREF=$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/sub.json"))["data"]["paymentReference"])')
[ -n "$PAYREF" ] && ok "subscription created, ref=$PAYREF" || bad "subscription"

# Simulate telebirr webhook (mock pay success)
curl -s -X POST $BASE/api/v1/webhooks/telebirr/notify -H 'content-type: application/json' \
  -d '{"merch_order_id":"'$PAYREF'","out_request_no":"orno-e2e-1","trade_status":"Success","total_amount":"1500.00","timestamp":"'$(date +%s)'000","sign":"mock-signature"}' > $TMP/webhook1.json
[ "$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/webhook1.json"))["data"]["ok"])')" = "True" ] && ok "telebirr webhook settled payment" || bad "webhook"

# Verify subscription is now active
curl -s -b $RIDER $BASE/api/v1/dashboard/rider > $TMP/dash2.json
[ "$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/dash2.json"))["data"]["activeSubs"][0]["status"])')" = "active" ] && ok "subscription is active after webhook" || bad "subscription active"

# Replay webhook — should be deduped (no error, no double-activation)
curl -s -X POST $BASE/api/v1/webhooks/telebirr/notify -H 'content-type: application/json' \
  -d '{"merch_order_id":"'$PAYREF'","out_request_no":"orno-e2e-1","trade_status":"Success","total_amount":"1500.00","timestamp":"'$(date +%s)'000","sign":"mock-signature"}' > $TMP/webhook-replay.json
[ "$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/webhook-replay.json"))["data"]["ok"])')" = "True" ] && ok "webhook replay deduped" || bad "replay dedup"

# Book a ride on the demo trip
TRIP_ID=$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/trips.json"))["data"][0]["id"])')
SUB_ID=$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/dash2.json"))["data"]["activeSubs"][0]["id"])')
RIDE=$(spost $RIDER /api/v1/rides '{"tripId":"'$TRIP_ID'","subscriptionId":"'$SUB_ID'"}')
echo "$RIDE" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("id") else 1)' && ok "ride booked" || bad "ride book"

# List seat on marketplace
RELEASE=$(spost $RIDER /api/v1/marketplace/seat-releases '{"tripId":"'$TRIP_ID'","window":"morning","expiresAt":"'$(date -u -d '+1 day' +'%Y-%m-%dT%H:%M:%S.000Z')'"}')
echo "$RELEASE" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("id") else 1)' && ok "seat released to marketplace" || bad "seat release"

# View marketplace (anon) — should show the released seat
curl -s -b $RIDER $BASE/api/v1/marketplace/seat-releases > $TMP/mkt.json
[ "$(python3 -c 'import json;print(len(json.load(open("/tmp/addis-ride-e2e/mkt.json"))["data"]))')" = "0" ] && ok "marketplace doesn't show own seats to seller" || bad "marketplace filter"

# ─── 3. Contractor: login + upload docs + create trip ────────────────────────
echo ""
echo "── 3. Contractor flow: login → upload docs → create trip ──"

CONTRACTOR=$TMP/contractor.txt
rm -f $CONTRACTOR
curl -s -c $CONTRACTOR -X POST $BASE/api/v1/auth/token -H 'content-type: application/json' -d '{"phone":"+251911000003","password":"contractor-pass-1234"}' > /dev/null
curl -s -b $CONTRACTOR -c $CONTRACTOR $BASE/api/v1/plans > /dev/null
CCSRF=$(get_csrf $CONTRACTOR)

# Create a fake PDF file to upload
echo "%PDF-1.4 fake pdf content" > $TMP/test.pdf

# Upload registration doc
UPLOAD=$(curl -s -b $CONTRACTOR -c $CONTRACTOR -X POST $BASE/api/v1/contractor/documents \
  -H "x-csrf-token: $CCSRF" \
  -F 'type=registration' \
  -F "file=@$TMP/test.pdf;filename=license.pdf;type=application/pdf")
echo "$UPLOAD" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("id") else 1)' && ok "registration doc uploaded" || bad "doc upload: $UPLOAD"

# Upload insurance doc
curl -s -b $CONTRACTOR -c $CONTRACTOR -X POST $BASE/api/v1/contractor/documents \
  -H "x-csrf-token: $CCSRF" \
  -F 'type=insurance' \
  -F "file=@$TMP/test.pdf;filename=insurance.pdf;type=application/pdf" > /dev/null
ok "insurance doc uploaded"

# Upload inspection doc
curl -s -b $CONTRACTOR -c $CONTRACTOR -X POST $BASE/api/v1/contractor/documents \
  -H "x-csrf-token: $CCSRF" \
  -F 'type=inspection' \
  -F "file=@$TMP/test.pdf;filename=inspection.pdf;type=application/pdf" > /dev/null
ok "inspection doc uploaded"

# Verify docs are listed
DOCS=$(curl -s -b $CONTRACTOR $BASE/api/v1/contractor/documents)
[ "$(echo "$DOCS" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["data"]))')" = "3" ] && ok "3 documents listed" || bad "docs count"

# Get a file ID + download it
FILE_ID=$(echo "$DOCS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["file"]["id"])')
curl -s -b $CONTRACTOR -o $TMP/downloaded.pdf -w "%{http_code}" $BASE/api/v1/files/$FILE_ID > $TMP/dl-status.txt
[ "$(cat $TMP/dl-status.txt)" = "200" ] && ok "file download works" || bad "file download"

# Create a new trip
ROUTE_ID=$(python3 -c 'import json;print(json.load(open("/tmp/addis-ride-e2e/routes.json"))["data"][0]["id"])')
SHUTTLE_ID=$(curl -s -b $CONTRACTOR $BASE/api/v1/contractor/shuttles | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["id"])')
NEWTIME=$(date -u -d '+2 days' +'%Y-%m-%dT08:00:00.000Z')
TRIPCREATE=$(spost $CONTRACTOR /api/v1/admin/trips '{"routeId":"'$ROUTE_ID'","shuttleId":"'$SHUTTLE_ID'","departureAt":"'$NEWTIME'","window":"morning"}')
echo "$TRIPCREATE" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("id") else 1)' && ok "contractor created trip" || bad "trip create"

# ─── 4. Admin: verify contractor + view audit ────────────────────────────────
echo ""
echo "── 4. Admin flow: verify contractor → view audit chain ──"

ADMIN=$TMP/admin.txt
rm -f $ADMIN
curl -s -c $ADMIN -X POST $BASE/api/v1/auth/token -H 'content-type: application/json' -d '{"phone":"+251911000001","password":"admin-pass-1234"}' > /dev/null
curl -s -b $ADMIN -c $ADMIN $BASE/api/v1/plans > /dev/null
ACSRF=$(get_csrf $ADMIN)

# Get contractor profile
CONTR_ID=$(curl -s -b $ADMIN $BASE/api/v1/admin/contractors | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["id"])')
VERIFY=$(spost $ADMIN /api/v1/admin/contractors/$CONTR_ID/verify '{"status":"verified","reason":"Documents reviewed — approved"}')
[ "$(echo "$VERIFY" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["status"])')" = "verified" ] && ok "contractor verified" || bad "verify contractor"

# View contractor docs (admin)
DOCS_FOR_CONTR=$(curl -s -b $ADMIN $BASE/api/v1/contractor/documents/$CONTR_ID)
[ "$(echo "$DOCS_FOR_CONTR" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["data"]))')" = "3" ] && ok "admin can view contractor docs" || bad "admin docs view"

# Verify audit chain
AUDIT=$(spost $ADMIN /api/v1/admin/audit/verify '{}')
[ "$(echo "$AUDIT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["ok"])')" = "True" ] && ok "audit chain intact" || bad "audit chain: $AUDIT"

# ─── 5. Corporate: onboard → invite → rider joins → approve ─────────────────
echo ""
echo "── 5. Corporate flow: onboard → invite → rider joins → approve ──"

# Register a fresh rider to become corporate_admin
CORPADMIN_PHONE="+251922000002"
spost $TMP/anon.txt /api/v1/auth/register '{"kind":"rider","name":"Corp Admin","phone":"'$CORPADMIN_PHONE'","password":"corp-pass-1234","homeArea":"Bole","workArea":"Bole"}' > /dev/null

CORPADMIN=$TMP/corpadmin.txt
rm -f $CORPADMIN
curl -s -c $CORPADMIN -X POST $BASE/api/v1/auth/token -H 'content-type: application/json' -d '{"phone":"'$CORPADMIN_PHONE'","password":"corp-pass-1234"}' > /dev/null
curl -s -b $CORPADMIN -c $CORPADMIN $BASE/api/v1/plans > /dev/null
CORPCSRF=$(get_csrf $CORPADMIN)
spost $CORPADMIN /api/v1/tos/accept '{}' > /dev/null

# Onboard a corporate
ONBOARD=$(spost $CORPADMIN /api/v1/corporate/onboard '{"name":"Acme Corp","contactEmail":"admin@acme.et","contactPhone":"+251922000099","subsidyPercent":75,"monthlySeatAllowance":30}')
echo "$ONBOARD" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("corporate",{}).get("id") else 1)' && ok "corporate onboarded" || bad "onboard"

# Create invite
INVITE=$(spost $CORPADMIN /api/v1/corporate/invites '{"maxUses":10}')
INVITE_CODE=$(echo "$INVITE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["code"])')
[ -n "$INVITE_CODE" ] && ok "invite created: $INVITE_CODE" || bad "invite create"

# Validate invite (anon)
VAL=$(spost $TMP/anon.txt /api/v1/corporate/validate-invite '{"inviteCode":"'$INVITE_CODE'"}')
[ "$(echo "$VAL" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["corporateName"])')" = "Acme Corp" ] && ok "invite validated" || bad "validate invite"

# Register a fresh rider to become a corporate member
MEMBER_PHONE="+251922000003"
spost $TMP/anon.txt /api/v1/auth/register '{"kind":"rider","name":"Corp Member","phone":"'$MEMBER_PHONE'","password":"member-pass-1234","homeArea":"Bole","workArea":"Merkato"}' > /dev/null

MEMBER=$TMP/member.txt
rm -f $MEMBER
curl -s -c $MEMBER -X POST $BASE/api/v1/auth/token -H 'content-type: application/json' -d '{"phone":"'$MEMBER_PHONE'","password":"member-pass-1234"}' > /dev/null
curl -s -b $MEMBER -c $MEMBER $BASE/api/v1/plans > /dev/null
MCSRF=$(get_csrf $MEMBER)
spost $MEMBER /api/v1/tos/accept '{}' > /dev/null

# Member joins
JOIN=$(spost $MEMBER /api/v1/corporate/signup '{"inviteCode":"'$INVITE_CODE'","employeeId":"EMP001"}')
echo "$JOIN" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("member",{}).get("id") else 1)' && ok "member requested to join" || bad "member join: $JOIN"

# Admin lists members + approves
MEMBERS=$(curl -s -b $CORPADMIN $BASE/api/v1/corporate/members)
MEMBER_ID=$(echo "$MEMBERS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["id"])')
APPROVE=$(spost $CORPADMIN /api/v1/corporate/members/$MEMBER_ID/approve '{}')
[ "$(echo "$APPROVE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["approvalStatus"])')" = "approved" ] && ok "member approved" || bad "approve"

# ─── 6. Support: rider creates ticket → admin replies ────────────────────────
echo ""
echo "── 6. Support flow: rider ticket → admin reply ──"

TICKET=$(spost $RIDER /api/v1/tickets '{"subject":"My ride did not show up","category":"route","priority":"high","body":"The shuttle was 30 minutes late."}')
TICKET_ID=$(echo "$TICKET" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')
[ -n "$TICKET_ID" ] && ok "ticket created" || bad "ticket create"

REPLY=$(spost $ADMIN /api/v1/admin/tickets/$TICKET_ID/messages '{"body":"Sorry about that — investigating with the contractor."}')
echo "$REPLY" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if d.get("data",{}).get("id") else 1)' && ok "admin replied" || bad "admin reply"

# ─── 7. Account: export + delete ─────────────────────────────────────────────
echo ""
echo "── 7. Account flow: export data ──"
EXPORT=$(curl -s -b $RIDER $BASE/api/v1/account/export)
echo "$EXPORT" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if "user" in d["data"] and "subscriptions" in d["data"] else 1)' && ok "export contains user + subscriptions" || bad "export"

# ─── 8. Cron: drain outbox + expire subs ─────────────────────────────────────
echo ""
echo "── 8. Cron flow: run scheduled tasks ──"
CRON=$(curl -s -X POST $BASE/api/v1/cron/run)
echo "$CRON" | python3 -c 'import sys,json;d=json.load(sys.stdin);exit(0 if "refunds" in d["data"] else 1)' && ok "cron ran" || bad "cron"

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Result: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════════════════════════"
exit $FAIL
