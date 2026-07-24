#!/usr/bin/env bash
# Selects the correct prisma schema based on DATABASE_PROVIDER env var.
# Defaults to sqlite for backward compat. Use DATABASE_PROVIDER=postgres
# in production.
set -euo pipefail
PROVIDER="${DATABASE_PROVIDER:-sqlite}"
SCHEMA_FILE="prisma/schema.${PROVIDER}.prisma"
if [ ! -f "$SCHEMA_FILE" ]; then
  echo "ERROR: DATABASE_PROVIDER=$PROVIDER but $SCHEMA_FILE not found"
  echo "Valid values: sqlite, postgres"
  exit 1
fi
# Symlink schema.prisma to the chosen variant
ln -sf "$SCHEMA_FILE" prisma/schema.prisma
echo "Selected schema: $SCHEMA_FILE -> prisma/schema.prisma"
