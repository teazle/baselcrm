# Urban VPN Setup Guide for Singapore Access

This guide explains how to set up Urban VPN with Playwright to access mhcasia.net from Singapore.

## Overview

The automation uses **Playwright with Chromium browser**. To access mhcasia.net, you need a Singapore IP address. This can be achieved using:

1. **Urban VPN Browser Extension** (recommended for this setup)
2. **System-level VPN** (alternative option)

## Option 1: Urban VPN Browser Extension (Recommended)

### Step 1: Install Urban VPN Extension

1. Open Chrome browser on your Mac
2. Go to: https://chromewebstore.google.com/detail/urban-vpn-free-vpn-proxy/eppiocemhmnlbhjplcgkofciiegomcon
3. Click "Add to Chrome" to install the extension

### Step 2: Copy Extension to Project

After installation, copy the extension from Chrome to the project:

```bash
# Find the extension version (usually the latest folder)
ls ~/Library/Application\ Support/Google/Chrome/Default/Extensions/eppiocemhmnlbhjplcgkofciiegomcon/

# Copy the latest version folder (replace VERSION with actual version number)
cp -r ~/Library/Application\ Support/Google/Chrome/Default/Extensions/eppiocemhmnlbhjplcgkofciiegomcon/VERSION extensions/urban-vpn
```

Or use the setup script:

```bash
node scripts/setup-urban-vpn.js
```

This will provide detailed instructions.

### Step 3: Configure Environment

Add to your `.env` file:

```bash
# Enable persistent browser context (required for extensions)
USE_PERSISTENT_CONTEXT=true

# Disable proxy (we're using extension instead)
PROXY_ENABLED=false
```

### Step 4: Configure Urban VPN Extension

**Important**: When the browser launches, you need to manually configure the extension:

1. The browser will open (not headless mode recommended for first setup)
2. Click on the Urban VPN extension icon in the browser
3. Select **Singapore** as the server location
4. Click "Connect" to establish the VPN connection
5. Wait for the connection to be established (usually a few seconds)

**Note**: The extension settings are saved in the persistent browser context, so you only need to configure it once.

### Step 5: Test Access

Run the test script to verify everything works:

```bash
npm run test-mhcasia-access
```

This will:
- Launch browser with Urban VPN extension
- Check your IP location (should show Singapore)
- Test access to mhcasia.net
- Take screenshots for verification

## Option 2: System-Level VPN (Alternative)

If you prefer to use Urban VPN as a system-level application:

1. Download Urban VPN desktop app from: https://www.urban-vpn.com/
2. Install and launch the application
3. Connect to Singapore server
4. Set in `.env`:
   ```bash
   PROXY_ENABLED=false
   USE_PERSISTENT_CONTEXT=false
   ```

The browser will automatically use the system VPN.

## Troubleshooting

### Extension Not Loading

- Make sure the extension is copied to `extensions/urban-vpn/` directory
- Verify `manifest.json` exists in the extension directory
- Check that `USE_PERSISTENT_CONTEXT=true` is set in `.env`

### IP Still Not Singapore

- Open the browser (set `HEADLESS=false` in `.env`)
- Manually check the Urban VPN extension
- Ensure it's connected to Singapore
- Wait a few seconds for connection to establish

### Site Still Blocked

- Verify IP is actually from Singapore using the test script
- Check if mhcasia.net has additional restrictions
- Try clearing browser cache/cookies
- Ensure the extension is enabled and connected

### Browser Crashes or Errors

- Make sure Playwright browsers are installed: `npm run install-browsers`
- Check browser logs for extension-related errors
- Try removing and re-adding the extension

## Important Notes

⚠️ **Privacy Warning**: Urban VPN has been reported to collect data. Use at your own discretion for production environments. Consider using a paid VPN service for production use.

✅ **Extension Persistence**: Once configured, the extension settings are saved in the persistent browser context (`~/.playwright-browser-data`), so you won't need to reconfigure it every time.

## Verification

After setup, you can verify the setup is working:

```bash
# Test IP location and site access
npm run test-mhcasia-access

# Or test the full workflow
npm run test-login
```

The test script will show:
- Your current IP address
- Country/region information
- Whether mhcasia.net is accessible
- Screenshots of the page
