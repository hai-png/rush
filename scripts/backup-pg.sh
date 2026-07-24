#!/usr/bin/env bash
set -euo pipefail

DB_HOST=172.18.0.4
DB_PORT=5432
DB_NAME=addisride
DB_USER=addisride
DB_PASS=addisride_dev_only_change_me

S3_HOST=172.18.0.3
S3_PORT=9000
S3_ACCESS_KEY=addisride
S3_SECRET_KEY=addisride_dev_only_change_me_32chars
S3_BUCKET=addisride-backups
S3_PREFIX=daily

BACKUP_DIR=/tmp
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/addisride-pg-$TIMESTAMP.dump"
BACKUP_FILE_GZ="${BACKUP_FILE}.gz"

trap 'rm -f "$BACKUP_FILE" "$BACKUP_FILE_GZ"; echo "Backup failed — partial files cleaned up" >&2; exit 1' ERR

echo "Dumping PostgreSQL database $DB_NAME from $DB_HOST:$DB_PORT ..."
PGPASSWORD="$DB_PASS" docker exec -i infra-postgres-1 pg_dump -U "$DB_USER" -h localhost "$DB_NAME" > "$BACKUP_FILE"

echo "  Dump size: $(stat -c%s "$BACKUP_FILE") bytes"

gzip "$BACKUP_FILE"
echo "  Compressed: $BACKUP_FILE_GZ ($(stat -c%s "$BACKUP_FILE_GZ") bytes)"

sha256sum "$BACKUP_FILE_GZ" > "${BACKUP_FILE_GZ}.sha256"
echo "  Checksum: ${BACKUP_FILE_GZ}.sha256"

S3_OBJECT="$S3_PREFIX/$(basename "$BACKUP_FILE_GZ")"
CHECKSUM_OBJECT="$S3_PREFIX/$(basename "${BACKUP_FILE_GZ}").sha256"

echo "Uploading to S3/MinIO ($S3_HOST:$S3_PORT/$S3_BUCKET/$S3_OBJECT) ..."
docker cp "$BACKUP_FILE_GZ" infra-minio-1:/tmp/upload.dump.gz
docker exec infra-minio-1 mc cp "/tmp/upload.dump.gz" "local/$S3_BUCKET/$S3_OBJECT"
docker cp "${BACKUP_FILE_GZ}.sha256" infra-minio-1:/tmp/upload.dump.gz.sha256
docker exec infra-minio-1 mc cp "/tmp/upload.dump.gz.sha256" "local/$S3_BUCKET/$CHECKSUM_OBJECT"
docker exec infra-minio-1 rm -f /tmp/upload.dump.gz /tmp/upload.dump.gz.sha256

echo "Uploaded. Listing:"
docker exec infra-minio-1 mc ls "local/$S3_BUCKET/$S3_PREFIX/"

rm -f "$BACKUP_FILE_GZ" "${BACKUP_FILE_GZ}.sha256"
echo "Backup complete"
