# MCP Server Troubleshooting

## Finding MCP Servers in Cursor

### Where to Look

1. **Cursor Settings**:
   - File → Preferences → Cursor Settings
   - Look for "MCP" or "Model Context Protocol" section
   - Should show "aws-basel" as an available server

2. **Agent Mode**:
   - Press `Ctrl+Alt+B` (or `Cmd+Option+B` on Mac) to open Agent mode
   - MCP servers should be available in the chat interface

3. **Command Palette**:
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "MCP" to see MCP-related commands

### If MCP Server Doesn't Appear

#### Check 1: File Location
The MCP configuration should be at:
- **Project level**: `.cursor/mcp.json` (in your project root)
- **Global level**: `~/Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

#### Check 2: File Format
Ensure the JSON is valid:
```bash
# Validate JSON
cat .cursor/mcp.json | python3 -m json.tool
```

#### Check 3: Restart Cursor
- **Completely quit** Cursor (Cmd+Q on Mac)
- **Reopen** Cursor
- Wait a few seconds for MCP servers to initialize

#### Check 4: Check Cursor Version
- MCP support requires Cursor version with MCP support
- Update Cursor if you're on an older version

#### Check 5: Check Logs
- Look for MCP-related errors in Cursor's developer console
- Help → Toggle Developer Tools
- Check Console tab for MCP errors

### Manual Configuration

If project-level config doesn't work, try global config:

**Location**: `~/Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

Create the file with:
```json
{
  "mcpServers": {
    "aws-basel": {
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

### Testing MCP Server

1. **Test command directly**:
   ```bash
   uvx awslabs.aws-api-mcp-server@latest
   ```

2. **Test AWS connection**:
   ```bash
   aws sts get-caller-identity --profile baselrpa
   ```

3. **Test in Cursor**:
   - Open Agent mode (Ctrl+Alt+B)
   - Ask: "List my EC2 instances using AWS MCP"
   - Or: "Use aws-basel to list EC2 instances"

### Common Issues

**Issue**: MCP server not showing in Cursor
- **Solution**: Restart Cursor completely, check file location

**Issue**: "Command not found" errors
- **Solution**: Ensure `uvx` is in PATH: `export PATH="$HOME/.local/bin:$PATH"`

**Issue**: AWS credentials not working
- **Solution**: Verify profile: `aws sts get-caller-identity --profile baselrpa`

**Issue**: Wrong AWS account
- **Solution**: Check AWS_PROFILE in mcp.json matches your profile name

### Verification

After setup, verify:
1. MCP server appears in Cursor settings
2. Can ask Cursor to use AWS MCP
3. Commands execute successfully
