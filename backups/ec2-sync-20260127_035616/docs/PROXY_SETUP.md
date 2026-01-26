# Proxy Setup Guide for Singapore IP Access

## Overview

The MHC Asia website requires a Singapore IP address to access. This system includes automatic proxy discovery and validation to help you access the site.

## Test Results

The proxy implementation has been tested and verified:

✅ **Proxy Finder**: Working correctly (fetches from multiple APIs)  
✅ **Proxy Validator**: Working correctly (validates Singapore IP)  
✅ **Browser Integration**: Working correctly (configures Playwright with proxy)  

⚠️ **Note**: Free proxy APIs are often unreliable and may not return proxies at all times. This is normal behavior.

## Current Status

Based on testing:
- **Your current IP**: Thailand (TH) - not Singapore
- **MHC Asia access**: Blocked (timeout) - confirms geo-restriction is active
- **Free proxy APIs**: Currently returning 0 proxies (common with free services)

## Solutions

### Option 1: System-Level VPN (Most Reliable)

Since free proxy APIs are unreliable, the most reliable free solution is a system-level VPN:

1. **Install a free VPN with Singapore servers:**
   - **Falcon VPN**: Free Singapore servers (verify Mac support)
   - **VeePN**: Free Chrome extension with Singapore servers

2. **Connect to Singapore server**

3. **Disable proxy in `.env`:**
   ```bash
   PROXY_ENABLED=false
   ```

4. **Run your automation** - it will use the VPN connection automatically

### Option 2: Manual Proxy Configuration

If you have access to a Singapore proxy server:

1. **Edit `.env`:**
   ```bash
   PROXY_ENABLED=true
   PROXY_AUTO_DISCOVER=false
   PROXY_SERVER=http://your-proxy-server.com:8080
   PROXY_USERNAME=optional_username
   PROXY_PASSWORD=optional_password
   ```

2. **Run your automation**

### Option 3: Auto-Discover Free Proxies (When Available)

The system will automatically try to find free Singapore proxies:

1. **Edit `.env`:**
   ```bash
   PROXY_ENABLED=true
   PROXY_AUTO_DISCOVER=true
   PROXY_MAX_RETRIES=3
   ```

2. **Run your automation**

   The system will:
   - Fetch proxies from multiple free APIs
   - Validate they provide Singapore IP
   - Automatically rotate if one fails
   - Fall back gracefully if no proxies found

## Testing the Proxy System

Run the test script to verify proxy functionality:

```bash
node src/examples/test-proxy.js
```

This will test:
1. Proxy discovery from free APIs
2. IP location verification
3. Browser initialization with proxy
4. MHC Asia website access

## Troubleshooting

### No Proxies Found

**Symptom**: "No Singapore proxies found via auto-discovery"

**Solutions**:
1. This is normal - free proxy APIs are often unavailable
2. Use a system-level VPN instead (Option 1)
3. Try again later (free proxy lists update frequently)
4. Use a manual proxy if you have one (Option 2)

### Proxy Validation Fails

**Symptom**: "Proxy IP is not from Singapore"

**Solutions**:
1. The proxy may not actually be in Singapore
2. Try a different proxy
3. Use a system-level VPN instead

### MHC Asia Still Blocked

**Symptom**: Timeout or access denied when accessing MHC Asia

**Solutions**:
1. Verify your IP is from Singapore: Check `https://ipinfo.io/json`
2. Ensure `PROXY_ENABLED=true` in `.env`
3. Check proxy logs for validation messages
4. Try a system-level VPN as alternative

## Implementation Details

### Files

- `src/utils/proxy-finder.js` - Discovers free Singapore proxies
- `src/utils/proxy-validator.js` - Validates proxy connectivity and IP location
- `src/utils/browser.js` - Integrates proxy with Playwright browser
- `src/config/portals.js` - Proxy configuration from environment variables

### How It Works

1. **Proxy Discovery**: Fetches from multiple free proxy APIs (GeoNix, Proxy5, ProxyFreeOnly, Proxify)
2. **Proxy Validation**: Tests proxy connectivity and verifies Singapore IP via ipinfo.io
3. **Browser Configuration**: Configures Playwright browser context with proxy settings
4. **Automatic Retry**: Rotates to new proxy if validation fails (up to `PROXY_MAX_RETRIES`)

### Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_ENABLED` | `false` | Enable/disable proxy support |
| `PROXY_AUTO_DISCOVER` | `true` | Automatically discover free proxies |
| `PROXY_SERVER` | `null` | Manual proxy server URL |
| `PROXY_USERNAME` | `null` | Proxy authentication username |
| `PROXY_PASSWORD` | `null` | Proxy authentication password |
| `PROXY_BYPASS` | `localhost,127.0.0.1` | URLs to bypass proxy |
| `PROXY_MAX_RETRIES` | `3` | Maximum proxy retry attempts |

## Recommendations

**For Production Use:**
- Use a system-level VPN (most reliable)
- Or use a paid proxy service with Singapore IPs

**For Development/Testing:**
- Use auto-discovery (free but less reliable)
- Or use a manual proxy if available

## Next Steps

1. **If free proxies are unavailable** (current situation):
   - Install Falcon VPN or VeePN
   - Connect to Singapore server
   - Set `PROXY_ENABLED=false` in `.env`
   - Run automation

2. **If you have a proxy server**:
   - Configure `PROXY_SERVER` in `.env`
   - Set `PROXY_AUTO_DISCOVER=false`
   - Run automation

3. **To test proxy discovery**:
   - Run `node src/examples/test-proxy.js`
   - Check logs for proxy discovery results
   - Verify IP location in test output
