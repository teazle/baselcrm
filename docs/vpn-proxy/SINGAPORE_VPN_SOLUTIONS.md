# Singapore VPN/Proxy Solutions for mhcasia.net Access

## Current Situation

We've tried two approaches:
1. ❌ **Urban VPN Extension** - Not working, keeps asking to retry
2. ❌ **Free Proxy Auto-Discovery** - All proxy APIs are failing/unavailable

## Working Solutions

### Option 1: System-Level VPN (Recommended)

**Best for automation** - Most reliable and doesn't require browser configuration.

1. **Install Urban VPN Desktop App** (or any VPN with Singapore servers):
   - Download from: https://www.urban-vpn.com/
   - Or use another VPN service (NordVPN, ExpressVPN, etc.)

2. **Connect to Singapore server** in the VPN app

3. **Update `.env`**:
   ```bash
   PROXY_ENABLED=false
   USE_PERSISTENT_CONTEXT=false
   ```

4. **Run your automation** - Browser will automatically use system VPN

### Option 2: Paid Proxy Service

**Best for production** - More reliable than free proxies.

1. **Get a Singapore proxy** from a paid service:
   - Bright Data (formerly Luminati)
   - Smartproxy
   - Oxylabs
   - Proxy-Cheap

2. **Update `.env`**:
   ```bash
   PROXY_ENABLED=true
   PROXY_AUTO_DISCOVER=false
   PROXY_SERVER=http://your-proxy-server.com:8080
   PROXY_USERNAME=your_username  # if required
   PROXY_PASSWORD=your_password  # if required
   USE_PERSISTENT_CONTEXT=false
   ```

### Option 3: Manual Proxy Configuration

If you have access to a Singapore proxy server:

1. **Update `.env`**:
   ```bash
   PROXY_ENABLED=true
   PROXY_AUTO_DISCOVER=false
   PROXY_SERVER=http://proxy-ip:port
   USE_PERSISTENT_CONTEXT=false
   ```

## Quick Setup (System VPN)

Since the extension isn't working, here's the fastest solution:

```bash
# 1. Install Urban VPN desktop app (or any VPN)
# 2. Connect to Singapore
# 3. Update .env:
echo "PROXY_ENABLED=false" >> .env
echo "USE_PERSISTENT_CONTEXT=false" >> .env

# 4. Test
npm run test-mhcasia-proxy
```

## Why Free Proxies Failed

- Free proxy APIs are often unreliable
- Many are blocked or rate-limited
- Singapore proxies are less common in free lists
- APIs may require authentication or have changed

## Recommendation

**For automated extraction**, use **Option 1 (System-Level VPN)**:
- ✅ Most reliable
- ✅ No browser configuration needed
- ✅ Works consistently
- ✅ Easy to set up

The browser will automatically route through the system VPN when it's connected to Singapore.

## Testing

After setting up, test with:
```bash
npm run test-mhcasia-proxy
```

This will verify:
- IP is from Singapore
- mhcasia.net is accessible
- Login page loads
