#!/bin/bash
# Syncs code from EC2 to local backup directory
# Usage: ./scripts/sync-from-ec2.sh [--dry-run]

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# EC2 connection details (can be overridden by environment variables)
EC2_HOST="${EC2_HOST:-54.169.85.216}"
EC2_USER="${EC2_USER:-ubuntu}"
EC2_SSH_KEY="${EC2_SSH_KEY:-$HOME/.ssh/baselrpa-singapore-key.pem}"
EC2_PATH="${EC2_PATH:-~/Baselrpacrm}"

# Check if dry-run mode
DRY_RUN=false
if [[ "$1" == "--dry-run" ]] || [[ "$1" == "-n" ]]; then
  DRY_RUN=true
  echo -e "${YELLOW}Running in DRY-RUN mode (no files will be copied)${NC}"
fi

# Create backup directory with timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOCAL_BACKUP="backups/ec2-sync-${TIMESTAMP}"

echo -e "${GREEN}=== EC2 to Local Sync ===${NC}"
echo "EC2 Host: ${EC2_USER}@${EC2_HOST}"
echo "EC2 Path: ${EC2_PATH}"
echo "Local Backup: ${LOCAL_BACKUP}"
echo ""

# Check if SSH key exists
if [ ! -f "$EC2_SSH_KEY" ]; then
  echo -e "${RED}Error: SSH key not found at $EC2_SSH_KEY${NC}"
  echo "Please set EC2_SSH_KEY environment variable or place key at default location"
  exit 1
fi

# Create backup directory
mkdir -p "$LOCAL_BACKUP"

# Build rsync command
RSYNC_CMD="rsync -avz"
if [ "$DRY_RUN" = true ]; then
  RSYNC_CMD="$RSYNC_CMD --dry-run"
fi

# Add SSH options
RSYNC_CMD="$RSYNC_CMD -e \"ssh -i $EC2_SSH_KEY -o StrictHostKeyChecking=no\""

# Add exclusions
RSYNC_CMD="$RSYNC_CMD --exclude='.env'"
RSYNC_CMD="$RSYNC_CMD --exclude='node_modules/'"
RSYNC_CMD="$RSYNC_CMD --exclude='.git/'"
RSYNC_CMD="$RSYNC_CMD --exclude='screenshots/'"
RSYNC_CMD="$RSYNC_CMD --exclude='data/'"
RSYNC_CMD="$RSYNC_CMD --exclude='logs/'"
RSYNC_CMD="$RSYNC_CMD --exclude='backups/'"
RSYNC_CMD="$RSYNC_CMD --exclude='*.log'"
RSYNC_CMD="$RSYNC_CMD --exclude='.DS_Store'"
RSYNC_CMD="$RSYNC_CMD --exclude='playwright-report/'"
RSYNC_CMD="$RSYNC_CMD --exclude='test-results/'"

# Add source and destination
RSYNC_CMD="$RSYNC_CMD \"${EC2_USER}@${EC2_HOST}:${EC2_PATH}/\" \"$LOCAL_BACKUP/\""

echo -e "${YELLOW}Executing rsync...${NC}"
echo ""

# Execute rsync
eval $RSYNC_CMD

echo ""
if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}Dry-run complete. Review the changes above.${NC}"
  echo -e "${YELLOW}Run without --dry-run to actually sync:${NC}"
  echo "  ./scripts/sync-from-ec2.sh"
else
  echo -e "${GREEN}✅ Sync complete!${NC}"
  echo "EC2 code backed up to: $LOCAL_BACKUP"
  echo ""
  echo "Next steps:"
  echo "1. Review changes: ./scripts/review-ec2-changes.sh"
  echo "2. Compare files manually if needed"
  echo "3. Copy important files from $LOCAL_BACKUP to local directory"
fi
