# Quick AWS MCP Setup - Ready to Use! ✅

## ✅ Status: Everything is Ready!

Your system is already set up:
- ✅ `uv` installed
- ✅ AWS CLI installed  
- ✅ Python 3.13.7 installed
- ✅ AWS credentials configured (Account: 283708190059)
- ✅ MCP configuration created (`.cursor/mcp.json`)

## 🚀 Final Steps (2 minutes)

### Step 1: Test MCP Server Installation

```bash
# This will download and test the AWS MCP server
uvx awslabs.aws-api-mcp-server@latest --help
```

### Step 2: Restart Cursor IDE

1. **Quit Cursor completely** (Cmd+Q on Mac)
2. **Reopen Cursor**
3. Cursor should automatically detect `.cursor/mcp.json`

### Step 3: Verify MCP is Working

In Cursor, open a chat and ask:

```
"Use AWS MCP to list EC2 instances in Singapore region (ap-southeast-1)"
```

Or:

```
"Create a t4g.small EC2 instance in Singapore region with Ubuntu 22.04 for my automation"
```

## 📋 What's Configured

**MCP Configuration** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "aws-singapore": {
      "command": "uvx",
      "args": ["awslabs.aws-api-mcp-server@latest"],
      "env": {
        "AWS_PROFILE": "default",
        "AWS_REGION": "ap-southeast-1"
      }
    }
  }
}
```

**AWS Region**: `ap-southeast-1` (Singapore) ✅

## 🎯 What You Can Do Now

Once Cursor restarts, you can ask it to:

1. **Create EC2 Instance**:
   ```
   "Create a t4g.small EC2 instance in Singapore with Ubuntu 22.04"
   ```

2. **Deploy Automation**:
   ```
   "Deploy my automation code to the EC2 instance"
   ```

3. **Manage Infrastructure**:
   ```
   "Set up security groups for port 22 (SSH)"
   "Create an SSH key pair for my server"
   ```

4. **Monitor**:
   ```
   "List all my EC2 instances"
   "Show me the public IP of my Singapore instance"
   ```

## 🔧 If MCP Doesn't Work

### Option 1: Check Cursor Settings
1. File → Preferences → Cursor Settings
2. Look for "MCP" section
3. Check if "aws-singapore" appears

### Option 2: Use Global Config
If project-level doesn't work, add to global config:

**Location**: `~/Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

Create the file with same content as `.cursor/mcp.json`

### Option 3: Manual Test
```bash
# Test MCP server directly
uvx awslabs.aws-api-mcp-server@latest
```

## ✅ Verification

After restarting Cursor, verify:

- [ ] MCP server shows in Cursor settings
- [ ] Can ask Cursor to list EC2 instances
- [ ] Cursor can interact with AWS

## 🎉 You're Ready!

Just **restart Cursor** and start using AWS MCP to manage your Singapore EC2 instances!

---

**Next**: Restart Cursor and test with: "List my EC2 instances in Singapore region"
