# Setup Correct AWS Account (646192482927)

## Current Status

Both existing profiles use account `283708190059` (wrong account):
- `default` profile → Account 283708190059
- `new-profile` profile → Account 283708190059

**Target**: Account `646192482927` (correct account for this project)

## Solution: Create New Profile

### Step 1: Create Profile for Correct Account

```bash
# Create a new profile specifically for this project
aws configure --profile baselrpa

# When prompted, enter:
# AWS Access Key ID: [Your access key for account 646192482927]
# AWS Secret Access Key: [Your secret key for account 646192482927]
# Default region name: ap-southeast-1
# Default output format: json
```

### Step 2: Verify the Profile

```bash
# Check that the profile uses the correct account
aws sts get-caller-identity --profile baselrpa

# Should show:
# "Account": "646192482927"
```

### Step 3: Update MCP Configuration

Once the profile is created and verified, I'll update `.cursor/mcp.json` to use the `baselrpa` profile.

## Alternative: If You Have Credentials Already

If you already have AWS credentials for account `646192482927`, you can:

### Option A: Add to Existing Profile

Edit `~/.aws/credentials`:

```ini
[baselrpa]
aws_access_key_id = YOUR_ACCESS_KEY
aws_secret_access_key = YOUR_SECRET_KEY
```

Edit `~/.aws/config`:

```ini
[profile baselrpa]
region = ap-southeast-1
output = json
```

### Option B: Use Environment Variables

You can also set credentials via environment variables in the MCP config (less secure):

```json
{
  "mcpServers": {
    "aws-singapore": {
      "command": "uvx",
      "args": ["awslabs.aws-api-mcp-server@latest"],
      "env": {
        "AWS_ACCESS_KEY_ID": "your-key",
        "AWS_SECRET_ACCESS_KEY": "your-secret",
        "AWS_REGION": "ap-southeast-1"
      }
    }
  }
}
```

## Next Steps

1. **Create the profile** with account 646192482927 credentials
2. **Verify** it works: `aws sts get-caller-identity --profile baselrpa`
3. **I'll update** `.cursor/mcp.json` to use the correct profile
4. **Restart Cursor** to apply changes

## Quick Command

```bash
# Create profile
aws configure --profile baselrpa

# Verify
aws sts get-caller-identity --profile baselrpa
```

Once you've created the profile, let me know and I'll update the MCP configuration!
