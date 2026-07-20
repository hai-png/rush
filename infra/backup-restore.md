# Addis Ride — Backup & Restore Procedure

This document covers the production backup schedule, retention, restore
procedure, and quarterly restore-test plan for Addis Ride's datastores
(Postgres, S3/MinIO, and Redis). It is the canonical reference for incident
response during a data-loss event.

## Datastores and their criticality

| Datastore | Criticality | Contents | Retention Target |
|-----------|-------------|----------|------------------|
| **Postgres 16** | Critical (tier 1) | Users, riders, contractors, payments, subscriptions, audit_logs, outbox_events, idempotency_records | 7 years (financial/audit compliance) |
| **S3 / MinIO** | Critical (tier 1) | Contractor documents (license, insurance, inspection), audit/payment JSONL archives, daily pg_dump snapshots | Contractor docs: 7 years; archives: indefinite; pg_dump: 90 days hot, 7 years Glacier |
| **Redis** | Non-persistent (tier 3) | Rate-limit counters, OTP-send locks, cron advisory locks, idempotency dedup, GPS cache | Not backed up — all data is recreatable or short-lived |

## Postgres backups

### 1. Daily logical backup (`pg_dump`)

Run as a cron job on the Postgres host (or a sidecar with `pg_dump` access):

```bash
#!/usr/bin/env bash
set -euo pipefail
DATE=$(date -u +%Y%m%dT%H%M%SZ)
BUCKET=addis-ride-backups
KEY="postgres/${DATE}.sql.gz"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  | gzip -9 \
  | aws s3 cp - "s3://${BUCKET}/${KEY}" --endpoint-url "$S3_ENDPOINT"
# Prune: keep 90 days hot, then S3 lifecycle transitions to Glacier.
aws s3api list-objects-v2 --bucket "$BUCKET" --prefix postgres/ \
  --query 'Contents[?LastModified<`'"$(date -u -d '90 days ago' +%Y-%m-%dT%H:%M:%SZ)"'`].Key' \
  --output text | xargs -I{} aws s3api delete-object --bucket "$BUCKET" --key {}
```

Schedule: **daily at 02:00 UTC** (low-traffic window for Addis Ababa,
which is UTC+3 — 05:00 local). RPO ≤ 24h.

### 2. Point-in-time recovery (PITR)

For managed Postgres (Fly.io Postgres, RDS, Cloud SQL): enable continuous
WAL archiving. Fly.io Postgres includes PITR by default with 7-day
retention; extend to 30 days for the production tier. RPO ≤ 5 minutes.

For self-managed Postgres on Hetzner: configure `pgBackRest` with WAL
archive streaming to S3. See `pgbackrest.conf` (in the ops repo, not this
one) for the canonical config.

### 3. Restore procedure (logical backup)

```bash
# 1. Provision a fresh Postgres instance (or recreate the database).
createdb addisride_restore

# 2. Download the most recent (or targeted) backup.
aws s3 cp s3://addis-ride-backups/postgres/<DATE>.sql.gz - --endpoint-url "$S3_ENDPOINT" | gunzip > restore.sql

# 3. Restore.
psql "$DATABASE_URL_RESTORE" < restore.sql

# 4. Run migrations to bring the schema up to the current code version.
bun run db:migrate

# 5. Verify row counts of critical tables match the source.
psql "$DATABASE_URL_RESTORE" -c "SELECT count(*) FROM audit_logs; SELECT count(*) FROM payments; SELECT count(*) FROM users;"
```

Target RTO: **2 hours** from alert to restored service.

### 4. Restore procedure (PITR)

```bash
# Fly.io example — restore to a specific timestamp.
flyctl postgres attach addis-ride-pg --database addisride_restore
flyctl postgres pitr addis-ride-pg --timestamp "2025-01-15T03:00:00Z" --database addisride_restore
```

Target RTO: **30 minutes** (PITR is faster than logical restore for large
databases).

## S3 / MinIO backups

### Bucket versioning + lifecycle

All three production buckets (`addis-ride-documents`,
`addis-ride-archives`, `addis-ride-backups`) have:

- **Versioning**: enabled. Accidental deletes are recoverable via
  `aws s3api list-object-versions` + `copy-object` from a prior version.
- **MFA delete**: enabled on the `addis-ride-backups` bucket (defense in
  depth — an attacker with AWS keys can't delete backups without the MFA
  device).
- **Lifecycle**: `addis-ride-backups` transitions to Glacier after 90 days
  and expires after 7 years. `addis-ride-documents` and
  `addis-ride-archives` have no expiration (7-year retention is enforced by
  the `archive-old-records` cron at the DB layer; S3 keeps the files
  indefinitely for legal hold).

### Cross-region replication

Replicate `addis-ride-documents` and `addis-ride-backups` to a second
region (e.g. `eu-central-1` → `eu-west-1`) for disaster recovery. RPO ≤
15 minutes (S3 replication lag).

## Redis backups

**Not backed up.** All Redis data is either:
- **Short-lived and recreatable**: rate-limit counters reset on TTL, OTP
  locks expire in 5 minutes, GPS cache entries expire in 30 seconds.
- **Lock state**: cron advisory locks are transaction-scoped — a Redis
  flush just means the next worker that fires `pg_try_advisory_xact_lock`
  wins; no data loss.

If Redis is wiped, the only user-visible effect is that in-flight rate
limit counters reset — at most one extra request per IP slips through per
window. Acceptable.

## Quarterly restore test

Every quarter (scheduled in the ops calendar — first Monday of Jan/Apr/Jul/Oct):

1. **Pick a backup**: the most recent daily `pg_dump` from
   `s3://addis-ride-backups/postgres/`.
2. **Restore to a sandbox**: provision a temporary Fly.io Postgres
   (`addis-ride-pg-restore-test`), restore the backup, run migrations.
3. **Smoke-test**: run the `e2e/` Playwright suite against the sandbox
   (point `DATABASE_URL` at the restored instance). All critical-path
   tests must pass.
4. **Verify row counts**: audit_logs, payments, users must match the
   source within ±1 row (the ±1 accounts for in-flight writes during the
   backup).
5. **Document**: file the restore-test report at
   `infra/backup-restore-tests/<YYYYMMDD>.md` with: backup date, restore
   duration, smoke-test result, row-count diff, any issues encountered.
6. **Tear down**: destroy the sandbox Postgres.

If the quarterly restore test fails, treat it as a SEV-2 incident per
`infra/incident-response.md` — a failed restore means our backups are
useless and we are one disk failure away from a total data-loss event.

## Backup integrity checks

Daily (after the `pg_dump` cron completes):

```bash
# Verify the most recent backup is non-empty and decompresses cleanly.
LATEST=$(aws s3api list-objects-v2 --bucket addis-ride-backups --prefix postgres/ \
  --query 'Contents | sort_by(@, &LastModified) | [-1].Key' --output text)
SIZE=$(aws s3api head-object --bucket addis-ride-backups --key "$LATEST" --query ContentLength --output text)
if [ "$SIZE" -lt 1000000 ]; then
  echo "ALERT: backup $LATEST is only $SIZE bytes — likely a failed dump" >&2
  exit 1
fi
aws s3 cp "s3://addis-ride-backups/$LATEST" - --endpoint-url "$S3_ENDPOINT" | gunzip | head -c 100 | grep -q "PostgreSQL database dump" || {
  echo "ALERT: backup $LATEST does not have a valid pg_dump header" >&2
  exit 1
}
```

Wire this into the existing Sentry alert path — failure sends a Sentry
message at `error` level, paging the on-call engineer.
