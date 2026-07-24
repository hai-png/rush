#!/usr/bin/env bash
# C-13 fix: scrub .env from git history and rotate all secrets.
#
# WARNING: This rewrites git history. All collaborators must clone fresh.
# Run this BEFORE the production deployment.
#
# Usage:  bash scripts/scrub-env-from-history.sh
#
# After running:
#   1. Rotate ALL secrets (AUTH_SECRET, CRON_SECRET, TELEBIRR_*, etc.)
#   2. Force-push: git push origin --force --all
#   3. Inform all devs to clone fresh (git pull will FAIL)
#
set -euo pipefail

echo "=== C-13: Scrub .env from git history ==="
echo ""

if ! command -v git-filter-repo &>/dev/null && ! command -v bfg &>/dev/null; then
  echo "ERROR: Need git-filter-repo or bfg installed."
  echo "  Install git-filter-repo:  pip install git-filter-repo"
  echo "  OR brew install bfg"
  exit 1
fi

echo "Step 1: Creating a backup of the current repo..."
BACKUP="../rush-backup-$(date +%Y%m%d-%H%M%S).gitbundle"
git bundle create "$BACKUP" --all
echo "  Backup saved to: $BACKUP"

echo ""
echo "Step 2: Scrub .env from history..."
if command -v git-filter-repo &>/dev/null; then
  git-filter-repo --path .env --invert-paths --force
else
  java -jar /usr/local/bin/bfg.jar --delete-files .env
  git reflog expire --expire=now --all && git gc --prune=now --aggressive
fi

echo ""
echo "Step 3: Verify .env is gone..."
if git log --all --full-history --diff-filter=A --follow -- .env | grep -q 'commit '; then
  echo "  WARNING: .env is still in history somewhere. Manual check needed."
else
  echo "  OK: .env removed from history."
fi

echo ""
echo "=== Done ==="
echo ""
echo "NEXT STEPS (manual):"
echo "  1. Rotate ALL secrets (AUTH_SECRET, CRON_SECRET, TELEBIRR_*, RESEND_API_KEY, TWILIO_AUTH_TOKEN)"
echo "  2. Update .env with new secrets"
echo "  3. Force-push: git push origin --force --all"
echo "  4. All devs: git clone <url> (fresh clone)"
echo "  5. Add pre-commit hook to prevent future secret commits"
