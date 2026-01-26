#!/bin/bash

# AWS MCP Server Setup Script
# This script sets up AWS MCP server for use with Cursor IDE

set -e

echo "=== AWS MCP Server Setup ==="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo -e "${YELLOW}Installing uv (Python package manager)...${NC}"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
else
    echo -e "${GREEN}uv found: $(uv --version)${NC}"
fi

# Install Python 3.10
echo -e "${YELLOW}Installing Python 3.10...${NC}"
uv python install 3.10

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}AWS CLI not found.${NC}"
    echo "Please install AWS CLI:"
    echo "  macOS: brew install awscli"
    echo "  Or download from: https://aws.amazon.com/cli/"
    exit 1
else
    echo -e "${GREEN}AWS CLI found: $(aws --version)${NC}"
fi

# Check AWS credentials
echo -e "${YELLOW}Checking AWS credentials...${NC}"
if [ ! -f ~/.aws/credentials ] && [ ! -f ~/.aws/config ]; then
    echo -e "${YELLOW}AWS credentials not found. Configuring...${NC}"
    aws configure
else
    echo -e "${GREEN}AWS credentials found${NC}"
fi

# Test AWS connection
echo -e "${YELLOW}Testing AWS connection...${NC}"
if aws sts get-caller-identity &> /dev/null; then
    echo -e "${GREEN}AWS connection successful${NC}"
    aws sts get-caller-identity
else
    echo -e "${RED}AWS connection failed. Please configure credentials.${NC}"
    aws configure
fi

# Install AWS MCP Server
echo -e "${YELLOW}Installing AWS API MCP Server...${NC}"
uvx awslabs.aws-api-mcp-server@latest --help &> /dev/null || echo "Server will be installed on first use"

# Find Cursor MCP config location
CURSOR_MCP_CONFIG=""
if [[ "$OSTYPE" == "darwin"* ]]; then
    CURSOR_MCP_CONFIG="$HOME/Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    CURSOR_MCP_CONFIG="$HOME/.config/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    CURSOR_MCP_CONFIG="$APPDATA/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json"
fi

echo ""
echo -e "${GREEN}=== Setup Complete ===${NC}"
echo ""
echo "Next steps:"
echo "1. Configure MCP in Cursor:"
echo "   Location: $CURSOR_MCP_CONFIG"
echo ""
echo "2. Add this configuration:"
cat << 'EOF'
{
  "mcpServers": {
    "aws-singapore": {
      "command": "uvx",
      "args": [
        "awslabs.aws-api-mcp-server@latest"
      ],
      "env": {
        "AWS_PROFILE": "default",
        "AWS_REGION": "ap-southeast-1"
      }
    }
  }
}
EOF
echo ""
echo "3. Restart Cursor IDE"
echo ""
echo "4. Test by asking: 'List my EC2 instances in Singapore region'"
