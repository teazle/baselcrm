# Urban VPN Auto-Connect to Singapore - Setup Complete

## ✅ What's Been Implemented

1. **Automatic Extension Configuration**: 
   - Browser preferences are modified to set Singapore as default
   - Extension auto-connect attempts on browser launch
   - IP verification after connection

2. **Multiple Connection Methods**:
   - Browser preferences modification
   - Extension popup interaction
   - JavaScript-based connection
   - IP verification

## 🚀 Quick Start

The system is now configured to automatically connect Urban VPN to Singapore. Just run your automation:

```bash
# Test the setup
npm run test-mhcasia-access

# Or run your extraction
npm run extract-daily
```

## ⚙️ Current Configuration

Your `.env` is set to:
- `USE_PERSISTENT_CONTEXT=true` - Extension will be loaded
- `PROXY_ENABLED=true` - Proxy is available as fallback
- `PROXY_AUTO_DISCOVER=true` - Auto-discovers Singapore proxies

**Note**: When using the extension, proxy auto-discovery is automatically disabled to avoid conflicts.

## 🔧 How It Works

1. **On Browser Launch**:
   - Extension is loaded from `extensions/urban-vpn/`
   - Browser preferences are configured for Singapore
   - Auto-connect attempts to connect to Singapore
   - IP is verified to confirm Singapore connection

2. **If Auto-Connect Fails**:
   - System will attempt to use proxy as fallback (if enabled)
   - Or you can manually configure extension once (settings persist)

## 📝 Manual Setup (If Needed)

If auto-connect doesn't work on first run:

1. **Run with visible browser**:
   ```bash
   # Make sure HEADLESS=false in .env
   npm run test-mhcasia-access
   ```

2. **When browser opens**:
   - Click Urban VPN icon
   - Select Singapore
   - Click Connect
   - Settings will persist for future runs

## 🎯 For Production Automation

For **100% reliable automation**, consider:

### Option 1: Use Proxy Server (Recommended)
```bash
# In .env
PROXY_ENABLED=true
PROXY_AUTO_DISCOVER=true
USE_PERSISTENT_CONTEXT=false
FORCE_PROXY=true
```

### Option 2: System-Level VPN
- Install Urban VPN desktop app
- Connect to Singapore
- Set `PROXY_ENABLED=false` and `USE_PERSISTENT_CONTEXT=false`

## ✅ Verification

Check if it's working:

```bash
npm run test-mhcasia-access
```

You should see:
- ✓ IP is from Singapore (SG)
- ✓ mhcasia.net is accessible
- ✓ Login page loads successfully

## 🔍 Troubleshooting

**Extension not connecting?**
- Check `extensions/urban-vpn/` exists
- Verify `USE_PERSISTENT_CONTEXT=true` in `.env`
- Try manual configuration once (settings persist)

**IP still not Singapore?**
- Extension may need manual setup on first run
- Use proxy server for more reliable automation
- Check extension icon shows "Connected"

**Site still blocked?**
- Verify IP is actually Singapore
- Check site requirements
- Try using proxy server instead

## 📚 Files Created

- `src/utils/browser.js` - Auto-connect logic
- `src/utils/urban-vpn-config.js` - Preferences configuration
- `src/examples/test-mhcasia-access.js` - Test script
- `docs/AUTO_CONNECT_VPN.md` - Detailed documentation

## Next Steps

1. **Test the setup**: Run `npm run test-mhcasia-access`
2. **If it works**: You're all set! Run your extractions
3. **If it doesn't**: Manually configure extension once, or use proxy server

The extension settings persist in `~/.playwright-browser-data`, so once configured, it will work automatically for future runs.
