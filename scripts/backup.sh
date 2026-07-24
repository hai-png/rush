#!/usr/bin/env bash
# L fix: backup.sh now verifies integrity, computes a checksum, and traps errors.
# Previously: no integrity check, no checksum, partial files could be gzipped
# and stored if sqlite3 .backup failed partway.
set -euo pipefail

DB_FILE="${DATABASE_URL:-./db/custom.db}"
DB_FILE="${DB_FILE#file:}"  # strip file: prefix if present
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_FILE="${BACKUP_DIR}/db-$(date +%Y%m%d-%H%M%S).db"

mkdir -p "$BACKUP_DIR"

# Clean up partial files on any error.
trap 'rm -f "$BACKUP_FILE" "${BACKUP_FILE}.gz"; echo "Backup failed — partial files cleaned up" >&2; exit 1' ERR

if [ ! -f "$DB_FILE" ]; then
  echo "ERROR: Database file not found: $DB_FILE" >&2
  exit 1
fi

echo "Backing up $DB_FILE → $BACKUP_FILE"
sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"

# Integrity check before compression.
INTEGRITY=$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" 2>&1)
if [ "$INTEGRITY" != "ok" ]; then
  echo "ERROR: Backup integrity check failed: $INTEGRITY" >&2
  rm -f "$BACKUP_FILE"
  exit 1
fi
echo "  Integrity check: OK"

# Compress.
gzip "$BACKUP_FILE"
echo "  Compressed: ${BACKUP_FILE}.gz"

# Compute + store sha256 checksum.
sha256sum "${BACKUP_FILE}.gz" > "${BACKUP_FILE}.gz.sha256"
echo "  Checksum: ${BACKUP_FILE}.gz.sha256"

# Retention: delete backups older than 30 days.
find "$BACKUP_DIR" -name "db-*.db.gz" -mtime +30 -delete
find "$BACKUP_DIR" -name "db-*.db.gz.sha256" -mtime +30 -delete
echo "  Retention: removed backups older than 30 days"

echo "Backup complete: ${BACKUP_FILE}.gz"
