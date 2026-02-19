#!/bin/bash
# =============================================
# COMMUNITY CARPOOL — EDGE FUNCTIONS BACKUP
# Project: tbkjealpnoriwdosvmju (ap-southeast-1)
# =============================================
# Usage: cd "/Users/ny/Downloads/Carpooling CodeBase" && bash backups/backup-edge-functions.sh
# Creates a timestamped zip of all edge function source files.
# =============================================

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
EF_DIR="$PROJECT_DIR/Supabse Edge Functions"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT="$SCRIPT_DIR/edge-functions-$TIMESTAMP.zip"

if [ ! -d "$EF_DIR" ]; then
  echo "ERROR: Edge functions directory not found at: $EF_DIR"
  exit 1
fi

echo "Backing up edge functions..."
cd "$PROJECT_DIR"
zip -r "$OUTPUT" "Supabse Edge Functions/" --exclude "*/node_modules/*" --exclude "*/.DS_Store"

echo "✅ Backup created: $OUTPUT"
echo ""
echo "Edge functions included:"
ls "$EF_DIR"
