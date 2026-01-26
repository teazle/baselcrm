# AWS MCP Setup - Next Steps

## ✅ What's Already Done

- ✅ `uv` is installed (`/Users/vincent/.local/bin/uv`)
- ✅ AWS CLI is installed (`/opt/homebrew/bin/aws`)
- ✅ Python 3.13.7 is installed
- ✅ MCP configuration file created (`.cursor/mcp.json`)

## 🔧 Next Steps

### Step 1: Verify AWS Credentials

```bash
# Check if AWS credentials are configured
aws sts get-caller-identity

# If not configured, set up credentials:
aws configure
# Enter:
# - AWS Access Key ID
# - AWS Secret Access Key
# - Default region: ap-southeast-1 (Singapore)
# - Default output format: json
```

### Step 2: Test AWS MCP Server Installation

```bash
# Test if AWS MCP server can be installed/run
uvx awslabs.aws-api-mcp-server@latest --help
```

### Step 3: Configure MCP in Cursor

The MCP configuration file has been created at `.cursor/mcp.json`.

**Option A: Cursor Auto-Detection**
- Cursor should automatically detect `.cursor/mcp.json` in your project
- Restart Cursor if needed

**Option B: Manual Configuration**
1. Open Cursor Settings
2. Go to: **File → Preferences → Cursor Settings**
3. Navigate to **MCP** section
4. Click "Add new global MCP server" or "Refresh"
5. The configuration from `.cursor/mcp.json` should be loaded

**Option C: Global Configuration**
If project-level doesn't work, add to global config:
- **macOS**: `~/Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- Create the file with the same content as `.cursor/mcp.json`

### Step 4: Restart Cursor

After configuration:
1. **Restart Cursor IDE** completely
2. Wait for MCP servers to initialize
3. Check MCP status in Cursor settings

### Step 5: Test AWS MCP

Once Cursor restarts, test by asking:

```
"List my EC2 instances in Singapore region"
```

Or:

```
"Create a t4g.small EC2 instance in Singapore region for my automation"
```

## 🔍 Troubleshooting

### If MCP Server Not Found

```bash
# Make sure uvx is in PATH
export PATH="$HOME/.local/bin:$PATH"

# Test installation
uvx awslabs.aws-api-mcp-server@latest --help
```

### If AWS Credentials Not Working

```bash
# Check credentials
aws sts get-caller-identity

# Reconfigure if needed
aws configure

# Or use AWS SSO
aws login
```

### If Region Issues

```bash
# Set default region
aws configure set region ap-southeast-1

# Or in .cursor/mcp.json, ensure AWS_REGION is set
```

### If Cursor Doesn't Detect MCP

1. **Check Cursor version** - MCP support requires recent version
2. **Check settings location** - May vary by Cursor version
3. **Try global config** instead of project config
4. **Check Cursor logs** for MCP errors

## 📋 IAM Permissions Needed

Your AWS user needs these permissions for EC2 operations:

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

Or use AWS managed policy: `AmazonEC2FullAccess`

## 🎯 What You Can Do After Setup

Once AWS MCP is working, you can ask Cursor to:

1. **Create EC2 Instance**:
   ```
   "Create a t4g.small EC2 instance in Singapore region with Ubuntu 22.04"
   ```

2. **Deploy Your Automation**:
   ```
   "Deploy my automation code to the EC2 instance"
   ```

3. **Manage Infrastructure**:
   ```
   "Set up security groups for my automation server"
   "Create an SSH key pair for my EC2 instance"
   ```

4. **Monitor Resources**:
   ```
   "List all my EC2 instances"
   "Show me the status of my Singapore EC2 instance"
   ```

## ✅ Verification Checklist

- [ ] AWS credentials configured (`aws sts get-caller-identity` works)
- [ ] AWS MCP server testable (`uvx awslabs.aws-api-mcp-server@latest --help`)
- [ ] `.cursor/mcp.json` created in project
- [ ] Cursor restarted
- [ ] MCP server shows as active in Cursor settings
- [ ] Can ask Cursor to list EC2 instances

## 🚀 Quick Test

After setup, try this in Cursor:

```
"Use AWS MCP to list EC2 instances in Singapore region (ap-southeast-1)"
```

If it works, you'll see your EC2 instances (or empty list if none exist).

---

**Ready to continue?** Run the verification steps above and let me know if you encounter any issues!
