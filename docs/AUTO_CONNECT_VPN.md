# Auto-Connect Urban VPN to Singapore

## Overview

For automated extraction and form filling, the Urban VPN extension needs to automatically connect to Singapore when the browser launches. This document explains the setup and limitations.

## Current Implementation

The system attempts to auto-connect Urban VPN to Singapore using:

1. **Browser Preferences Configuration**: Modifies Chrome preferences to set Singapore as default
2. **Extension Popup Interaction**: Programmatically clicks Singapore and connects
3. **IP Verification**: Checks that connection is successful

## Setup

### Automatic Configuration

The system will automatically:
- Configure browser preferences to default to Singapore
- Attempt to connect the extension on browser launch
- Verify the connection by checking IP location

### Manual One-Time Setup (Recommended)

For the most reliable setup, manually configure the extension once:

1. **Run a test script** (browser will open):
   ```bash
   npm run test-mhcasia-access
   ```

2. **When browser opens**:
   - Click the Urban VPN extension icon
   - Select **Singapore** from the server list
   - Click **Connect**
   - Wait for connection to establish

3. **Settings Persist**: Once configured, the extension settings are saved in the persistent browser context (`~/.playwright-browser-data`), so it will remember Singapore for future runs.

## Limitations

⚠️ **Extension Auto-Connect Limitations**:
- Browser extensions are designed for manual interaction
- Auto-connect may not work 100% reliably
- Extension popup structure can change with updates
- Some extensions block programmatic access

## Recommended Solution for Production Automation

For **reliable automated extraction**, we recommend using a **proxy server** instead of the extension:

### Option 1: Use Proxy Server (Most Reliable)

1. **Get a Singapore proxy server**:
   - Use a paid VPN service that provides proxy endpoints
   - Or use the built-in proxy auto-discovery (free proxies)

2. **Configure in `.env`**:
   ```bash
   PROXY_ENABLED=true
   PROXY_AUTO_DISCOVER=true
   USE_PERSISTENT_CONTEXT=false
   ```

3. **Or use a specific proxy**:
   ```bash
   PROXY_ENABLED=true
   PROXY_SERVER=http://singapore-proxy.example.com:8080
   PROXY_USERNAME=your_username  # if required
   PROXY_PASSWORD=your_password  # if required
   USE_PERSISTENT_CONTEXT=false
   ```

### Option 2: System-Level VPN

1. Install Urban VPN desktop app
2. Connect to Singapore
3. Set in `.env`:
   ```bash
   PROXY_ENABLED=false
   USE_PERSISTENT_CONTEXT=false
   ```

The browser will automatically use the system VPN.

## Testing

Test the setup:

```bash
# Test IP location and mhcasia.net access
npm run test-mhcasia-access
```

The test will:
- Check if IP is from Singapore
- Verify access to mhcasia.net
- Show connection status

## Troubleshooting

### Extension Not Connecting Automatically

1. **Check if extension is loaded**:
   - Look for Urban VPN icon in browser toolbar
   - If missing, verify extension is in `extensions/urban-vpn/`

2. **Manual Configuration**:
   - Open browser (set `HEADLESS=false`)
   - Manually connect to Singapore once
   - Settings will persist

3. **Use Proxy Instead**:
   - Switch to proxy server configuration
   - More reliable for automation

### IP Still Not Singapore

1. **Verify Extension Connection**:
   - Check extension icon shows "Connected"
   - Verify it's connected to Singapore

2. **Clear Browser Data**:
   ```bash
   rm -rf ~/.playwright-browser-data
   ```
   Then reconfigure the extension

3. **Use Proxy Server**:
   - Proxy servers are more reliable for automation
   - See Option 1 above

### Site Still Blocked

1. **Verify IP is Singapore**:
   - Run test script to check IP location
   - Should show `Country: SG`

2. **Check Site Requirements**:
   - Some sites have additional restrictions
   - May require specific user agents or headers

## Best Practices for Automation

For **production automation**, we recommend:

1. ✅ **Use Proxy Server** (most reliable)
2. ✅ **System-Level VPN** (if available)
3. ⚠️ **Extension** (works but may need manual setup)

The extension approach works best when:
- You manually configure it once
- Settings persist in browser context
- You don't need 100% reliability

For **fully automated** extraction without manual intervention, use a proxy server.
