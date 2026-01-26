# AWS Account Configuration for MCP

## Current Situation

You have multiple AWS accounts/profiles:
- **default profile**: Account `283708190059` (wrong account - different project)
- **new-profile**: Need to check if this is the correct account
- **Target account**: `646192482927` (correct account for this project)

## Solution Options

### Option 1: Use Existing Profile (if new-profile is correct)

If `new-profile` is already configured with account `646192482927`:

Update `.cursor/mcp.json` to use `new-profile`:

```json
{
  "mcpServers": {
    "aws-singapore": {
      "command": "uvx",
      "args": [
        "awslabs.aws-api-mcp-server@latest"
      ],
      "env": {
        "AWS_PROFILE": "new-profile",
        "AWS_REGION": "ap-southeast-1"
      }
    }
  }
}
```

### Option 2: Create New Profile for This Project

Create a dedicated profile for this project:

```bash
# Create new profile
aws configure --profile baselrpa

# Enter:
# - AWS Access Key ID: (for account 646192482927)
# - AWS Secret Access Key: (for account 646192482927)
# - Default region: ap-southeast-1
# - Default output format: json
```

Then update `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "aws-singapore": {
      "command": "uvx",
      "args": [
        "awslabs.aws-api-mcp-server@latest"
      ],
      "env": {
        "AWS_PROFILE": "baselrpa",
        "AWS_REGION": "ap-southeast-1"
      }
    }
  }
}
```

### Option 3: Switch Default Profile

If you want to make account `646192482927` the default:

```bash
# Configure default profile with new credentials
aws configure

# Enter credentials for account 646192482927
```

## Verify Correct Account

After configuration, verify:

```bash
# Check which account the profile uses
aws sts get-caller-identity --profile <profile-name>

# Should show Account: 646192482927
```

## Update MCP Configuration

Once you've identified or created the correct profile, update `.cursor/mcp.json` with the correct `AWS_PROFILE` value.
