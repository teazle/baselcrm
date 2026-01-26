#!/bin/bash
# Compares EC2 sync backup with local files
# Usage: ./scripts/review-ec2-changes.sh [backup-directory]

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Find latest backup directory if not specified
if [ -z "$1" ]; then
  # Find the most recent backup directory
  EC2_SYNC_DIR=$(ls -td backups/ec2-sync-* 2>/dev/null | head -1)
  if [ -z "$EC2_SYNC_DIR" ]; then
    echo -e "${RED}Error: No EC2 backup directory found${NC}"
    echo "Run ./scripts/sync-from-ec2.sh first"
    exit 1
  fi
else
  EC2_SYNC_DIR="$1"
fi

if [ ! -d "$EC2_SYNC_DIR" ]; then
  echo -e "${RED}Error: Backup directory not found: $EC2_SYNC_DIR${NC}"
  exit 1
fi

echo -e "${GREEN}=== Comparing EC2 Backup with Local Files ===${NC}"
echo "EC2 Backup: $EC2_SYNC_DIR"
echo "Local Directory: $(pwd)"
echo ""

# Counters
DIFF_COUNT=0
NEW_COUNT=0
MISSING_COUNT=0
SAME_COUNT=0

# Report file
REPORT_FILE="sync-report-$(date +%Y%m%d_%H%M%S).md"
echo "# EC2 to Local Sync Report" > "$REPORT_FILE"
echo "Generated: $(date)" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "## Summary" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# Find all files in EC2 backup (excluding the backup directory structure)
echo -e "${YELLOW}Scanning files...${NC}"

# Process each file in the EC2 backup
while IFS= read -r -d '' file; do
  # Get relative path from backup directory
  rel_path="${file#$EC2_SYNC_DIR/}"
  local_file="$rel_path"
  
  # Skip if it's a directory
  if [ -d "$file" ]; then
    continue
  fi
  
  if [ -f "$local_file" ]; then
    # File exists in both places, check if different
    if ! diff -q "$file" "$local_file" > /dev/null 2>&1; then
      DIFF_COUNT=$((DIFF_COUNT + 1))
      echo -e "${YELLOW}DIFF:${NC} $rel_path"
      echo "## Different: $rel_path" >> "$REPORT_FILE"
      echo "" >> "$REPORT_FILE"
      echo "\`\`\`diff" >> "$REPORT_FILE"
      diff -u "$local_file" "$file" | head -50 >> "$REPORT_FILE" 2>&1 || true
      echo "\`\`\`" >> "$REPORT_FILE"
      echo "" >> "$REPORT_FILE"
    else
      SAME_COUNT=$((SAME_COUNT + 1))
    fi
  else
    # File exists on EC2 but not locally
    NEW_COUNT=$((NEW_COUNT + 1))
    echo -e "${BLUE}NEW:${NC} $rel_path (exists on EC2, not in local)"
    echo "## New on EC2: $rel_path" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    echo "This file exists on EC2 but not in local repository." >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
  fi
done < <(find "$EC2_SYNC_DIR" -type f -print0)

# Check for files that exist locally but not on EC2 (in important directories only)
echo ""
echo -e "${YELLOW}Checking for files that exist locally but not on EC2...${NC}"

for local_file in $(find src scripts -type f 2>/dev/null | head -100); do
  if [ -f "$local_file" ]; then
    ec2_file="$EC2_SYNC_DIR/$local_file"
    if [ ! -f "$ec2_file" ]; then
      MISSING_COUNT=$((MISSING_COUNT + 1))
      echo -e "${RED}MISSING:${NC} $local_file (exists locally, not on EC2)"
      echo "## Missing on EC2: $local_file" >> "$REPORT_FILE"
      echo "" >> "$REPORT_FILE"
      echo "This file exists locally but not on EC2." >> "$REPORT_FILE"
      echo "" >> "$REPORT_FILE"
    fi
  fi
done

# Update summary in report
{
  echo "- Files that differ: $DIFF_COUNT"
  echo "- New files on EC2: $NEW_COUNT"
  echo "- Files missing on EC2: $MISSING_COUNT"
  echo "- Files that are the same: $SAME_COUNT"
  echo ""
  echo "## Recommendations"
  echo ""
  echo "1. Review files marked as DIFF - these may contain fixes from EC2"
  echo "2. Review NEW files - these may be important additions"
  echo "3. Review MISSING files - decide if they should be on EC2"
  echo ""
} >> "$REPORT_FILE"

# Print summary
echo ""
echo -e "${GREEN}=== Summary ===${NC}"
echo -e "Files that differ: ${YELLOW}$DIFF_COUNT${NC}"
echo -e "New files on EC2: ${BLUE}$NEW_COUNT${NC}"
echo -e "Files missing on EC2: ${RED}$MISSING_COUNT${NC}"
echo -e "Files that are the same: ${GREEN}$SAME_COUNT${NC}"
echo ""
echo -e "${GREEN}Detailed report saved to: $REPORT_FILE${NC}"
echo ""
echo "Next steps:"
echo "1. Review the report: cat $REPORT_FILE"
echo "2. For each DIFF file, decide whether to keep EC2 version or local version"
echo "3. Copy important files from $EC2_SYNC_DIR to local directory"
echo "4. Commit changes: git add . && git commit -m 'Sync from EC2'"
