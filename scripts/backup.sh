#!/bin/bash
# OPS-01: Simple SQLite backup script. Run via cron daily.
# For Postgres, replace with: pg_dump $DATABASE_URL | gzip > $BACKUP_DIR/db-$(date +%Y%m%d).sql.gz
set -e
DB_FILE="${DATABASE_URL#file:}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/db-$TIMESTAMP.db"

if [ -f "$DB_FILE" ]; then
  sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"
  gzip "$BACKUP_FILE"
  echo "Backup created: ${BACKUP_FILE}.gz"
  # Keep only last 30 days of backups
  find "$BACKUP_DIR" -name "db-*.db.gz" -mtime +30 -delete
  echo "Old backups cleaned (older than 30 days)"
else
  echo "Database file not found: $DB_FILE"
  exit 1
fi
