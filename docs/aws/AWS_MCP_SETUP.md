# AWS MCP Server Setup Guide

## 🎯 What is AWS MCP?

AWS MCP (Model Context Protocol) servers allow you to interact with AWS services directly from your IDE (like Cursor) using AI assistants. This can help you:
- Create and manage AWS EC2 instances (for Singapore server)
- Deploy your automation to AWS
- Manage AWS resources
- All from within your IDE!

---

## 📋 Prerequisites

1. **AWS Account** with appropriate permissions
2. **AWS CLI v2** installed
3. **Python 3.10+** installed
4. **uv** (Python package manager) - from Astral
5. **MCP Client** (Cursor IDE supports MCP)

---

## 🚀 Installation Steps

### Step 1: Install Dependencies

```bash
# Install uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install Python 3.10 using uv
uv python install 3.10

# Install AWS CLI v2 (if not already installed)
# macOS:
brew install awscli

# Or download from: https://aws.amazon.com/cli/
```

### Step 2: Configure AWS Credentials

```bash
# Configure AWS credentials
aws configure

# Or use AWS SSO
aws login

# Verify
aws sts get-caller-identity
```

### Step 3: Install AWS MCP Servers

AWS provides multiple MCP servers. For your use case (creating/managing EC2 instances in Singapore), you'll need:

#### Option A: AWS API MCP Server (Comprehensive)

```bash
# Install using uvx
uvx awslabs.aws-api-mcp-server@latest

# Or install globally
pip install awslabs-aws-api-mcp-server
```

#### Option B: AWS EC2 MCP Server (EC2-specific)

```bash
# Install EC2-specific server
uvx awslabs.aws-ec2-mcp-server@latest
```

#### Option C: AWS Full Stack MCP Server (All services)

```bash
# Install full stack server
uvx awslabs.aws-full-stack-mcp-server@latest
```

---

## ⚙️ Configure MCP in Cursor

### Step 1: Find Cursor MCP Configuration

Cursor stores MCP configuration in:
- **macOS**: `~/Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **Windows**: `%APPDATA%\Cursor\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
- **Linux**: `~/.config/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

### Step 2: Create/Edit MCP Configuration

Create or edit the MCP settings file:

```json
{
  "mcpServers": {
    "aws-api": {
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
```

**For Singapore region specifically:**
```json
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
```

### Step 3: Restart Cursor

Restart Cursor IDE for changes to take effect.

---

## 🔧 Available AWS MCP Servers

### 1. **AWS API MCP Server** (Recommended)
- **Package**: `awslabs.aws-api-mcp-server`
- **What it does**: Full AWS API access (EC2, S3, Lambda, etc.)
- **Best for**: General AWS management

### 2. **AWS EC2 MCP Server**
- **Package**: `awslabs.aws-ec2-mcp-server`
- **What it does**: EC2-specific operations
- **Best for**: Managing EC2 instances

### 3. **AWS S3 MCP Server**
- **Package**: `awslabs.aws-s3-mcp-server`
- **What it does**: S3 operations
- **Best for**: File storage management

### 4. **AWS Lambda MCP Server**
- **Package**: `awslabs.aws-lambda-mcp-server`
- **What it does**: Lambda function management
- **Best for**: Serverless functions

### 5. **AWS Full Stack MCP Server**
- **Package**: `awslabs.aws-full-stack-mcp-server`
- **What it does**: All AWS services
- **Best for**: Complete AWS management

---

## 🎯 Recommended Setup for Your Use Case

For creating and managing Singapore EC2 instances for your automation:

### Recommended: AWS API MCP Server

```json
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
```

**Why this one?**
- ✅ Full AWS API access
- ✅ Can create EC2 instances
- ✅ Can manage all AWS services
- ✅ Most comprehensive

---

## 🔐 IAM Permissions Required

Your AWS user/role needs these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "iam:GetUser",
        "iam:ListRoles",
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    }
  ]
}
```

Or use AWS managed policy:
- `AmazonEC2FullAccess` (for EC2 operations)
- `IAMReadOnlyAccess` (for IAM read operations)

---

## ✅ Verification

### Test MCP Server

1. **Restart Cursor**
2. **Open a chat/command** in Cursor
3. **Ask**: "List my EC2 instances in Singapore region"
4. **If working**: You'll see your EC2 instances

### Test AWS Connection

```bash
# Test AWS CLI
aws ec2 describe-instances --region ap-southeast-1

# Test MCP server directly
uvx awslabs.aws-api-mcp-server@latest
```

---

## 🚀 Use Cases with AWS MCP

Once set up, you can ask Cursor to:

1. **Create EC2 instance in Singapore**:
   - "Create a t4g.small EC2 instance in Singapore region"

2. **Deploy your automation**:
   - "Deploy my automation code to the EC2 instance"

3. **Manage instances**:
   - "List all my EC2 instances"
   - "Stop/start my Singapore EC2 instance"

4. **Set up infrastructure**:
   - "Create security groups for my automation"
   - "Set up auto-scaling for my instances"

---

## 📝 Quick Setup Script

```bash
#!/bin/bash
# Quick AWS MCP setup script

echo "Installing AWS MCP Server..."

# Install uv if not installed
if ! command -v uv &> /dev/null; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi

# Install Python 3.10
uv python install 3.10

# Verify AWS CLI
if ! command -v aws &> /dev/null; then
    echo "Please install AWS CLI first: https://aws.amazon.com/cli/"
    exit 1
fi

# Configure AWS (if not already)
if [ ! -f ~/.aws/credentials ]; then
    echo "Configuring AWS credentials..."
    aws configure
fi

# Test AWS connection
echo "Testing AWS connection..."
aws sts get-caller-identity

echo "AWS MCP Server setup complete!"
echo "Now configure MCP in Cursor IDE settings."
```

---

## 🔍 Troubleshooting

### Issue: MCP server not found

```bash
# Make sure uvx is in PATH
export PATH="$HOME/.local/bin:$PATH"

# Test installation
uvx awslabs.aws-api-mcp-server@latest --help
```

### Issue: AWS credentials not working

```bash
# Check credentials
aws sts get-caller-identity

# Reconfigure if needed
aws configure

# Or use SSO
aws login
```

### Issue: Region not set

```bash
# Set default region
aws configure set region ap-southeast-1

# Or in MCP config, set AWS_REGION
```

### Issue: Permissions denied

- Check IAM permissions
- Ensure user has EC2 permissions
- Try with `AmazonEC2FullAccess` policy

---

## 📚 Additional Resources

- **AWS MCP Documentation**: https://docs.aws.amazon.com/aws-mcp/
- **AWS MCP GitHub**: https://github.com/awslabs/aws-mcp
- **MCP Protocol**: https://modelcontextprotocol.io/
- **Cursor MCP Docs**: Check Cursor IDE documentation

---

## ✅ Checklist

- [ ] AWS account created
- [ ] AWS CLI installed and configured
- [ ] uv installed
- [ ] Python 3.10 installed
- [ ] AWS MCP server installed
- [ ] MCP configured in Cursor
- [ ] AWS credentials configured
- [ ] IAM permissions set
- [ ] Cursor restarted
- [ ] MCP server tested

---

## 🎯 Next Steps

1. **Install dependencies** (uv, Python, AWS CLI)
2. **Configure AWS credentials**
3. **Install AWS MCP server**
4. **Configure MCP in Cursor**
5. **Test with**: "List my EC2 instances in Singapore"

Once set up, you can use Cursor to manage your AWS infrastructure directly! 🚀
