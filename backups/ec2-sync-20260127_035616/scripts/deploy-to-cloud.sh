#!/bin/bash

# Deployment script for Singapore cloud server
# This script helps set up the automation on a cloud server

set -e

echo "=== Claim Automation Deployment Script ==="
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo "Please do not run as root. Use a regular user with sudo privileges."
   exit 1
fi

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check Node.js
echo "Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js not found. Installing...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo -e "${GREEN}Node.js found: $(node --version)${NC}"
fi

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}npm not found. Please install Node.js first.${NC}"
    exit 1
fi

echo -e "${GREEN}npm found: $(npm --version)${NC}"

# Install system dependencies for Playwright
echo ""
echo "Installing system dependencies for Playwright..."
sudo apt update
sudo apt install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    git

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}.env file not found. Creating template...${NC}"
    cat > .env << 'EOF'
# Clinic Assist Credentials
CLINIC_ASSIST_URL=https://clinicassist.sg:1080/
CLINIC_ASSIST_USERNAME=your-username
CLINIC_ASSIST_PASSWORD=your-password

# MHC Asia Credentials
MHC_ASIA_URL=https://www.mhcasia.net/mhc/
MHC_ASIA_USERNAME=your-username
MHC_ASIA_PASSWORD=your-password

# Browser Settings
HEADLESS=true
SLOW_MO=500
TIMEOUT=30000
CLINIC_ASSIST_CLINIC_GROUP=ssoc

# Proxy Configuration (DISABLED - using Singapore server directly)
PROXY_ENABLED=false
USE_PERSISTENT_CONTEXT=false
EOF
    echo -e "${YELLOW}Please edit .env file with your credentials${NC}"
    echo "Run: nano .env"
fi

# Install npm dependencies
echo ""
echo "Installing npm dependencies..."
npm install

# Install Playwright browsers
echo ""
echo "Installing Playwright browsers (this may take a few minutes)..."
npm run install-browsers

# Create screenshots directory
mkdir -p screenshots
chmod 755 screenshots

# Create data directories
mkdir -p data/extractions
mkdir -p data/batch-extractions

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your credentials: nano .env"
echo "2. Test login: npm run test-login"
echo "3. Test workflow: npm run test-workflow"
echo "4. Run automation: npm run extract-daily"
echo ""
echo "Optional: Install PM2 for process management:"
echo "  sudo npm install -g pm2"
echo "  pm2 start src/examples/extract-daily.js --name claim-automation"
echo "  pm2 save"
echo "  pm2 startup"
