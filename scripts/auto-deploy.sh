#!/bin/bash

# Auto-deployment script that runs on EC2 after git pull
# This script is called by GitHub Actions or webhook server

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Auto-Deployment Script ===${NC}"
echo ""

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

cd "$PROJECT_DIR"

echo "📁 Project directory: $PROJECT_DIR"
echo ""

# Pull latest changes (if not already done)
if [ "$1" != "skip-pull" ]; then
    echo "📥 Pulling latest changes from Git..."
    git fetch origin
    
    # Get current branch
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    echo "🌿 Current branch: $CURRENT_BRANCH"
    
    # Pull changes
    git reset --hard "origin/$CURRENT_BRANCH"
    echo -e "${GREEN}✅ Code updated${NC}"
else
    echo "⏭️  Skipping git pull (already done)"
fi

# Check if dependencies need updating
echo ""
echo "📦 Checking dependencies..."

if [ -f "package-lock.json" ]; then
    # Check if package.json or package-lock.json changed
    if [ "$1" != "skip-pull" ] || git diff HEAD@{1} HEAD --name-only 2>/dev/null | grep -q "package.json\|package-lock.json"; then
        echo "📦 Installing/updating dependencies..."
        npm install
        
        echo "🌐 Installing Playwright browsers..."
        npm run install-browsers
        
        echo -e "${GREEN}✅ Dependencies updated${NC}"
    else
        echo "ℹ️  No dependency changes detected"
    fi
fi

# Restart PM2 processes if running
echo ""
if command -v pm2 &> /dev/null; then
    echo "🔄 Checking PM2 processes..."
    
    if pm2 list | grep -q "online\|stopped"; then
        echo "🔄 Restarting PM2 processes..."
        pm2 restart all || pm2 reload all || true
        echo -e "${GREEN}✅ PM2 processes restarted${NC}"
    else
        echo "ℹ️  No PM2 processes running"
    fi
else
    echo "ℹ️  PM2 not installed"
fi

# Show deployment status
echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo "📊 Current status:"
echo "  Branch: $(git rev-parse --abbrev-ref HEAD)"
echo "  Commit: $(git log -1 --oneline)"
echo "  Date: $(date)"

if command -v pm2 &> /dev/null; then
    echo ""
    echo "📊 PM2 Status:"
    pm2 status
fi

echo ""
echo -e "${GREEN}✅ Auto-deployment finished successfully!${NC}"
