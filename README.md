# Clinic Claim Automation System

A browser automation system for processing insurance claims across multiple portals using Playwright.

## Features

- **Multi-Portal Support**: Automate claims processing across different insurance/TPA portals
- **Modular Architecture**: Easy to add new portals and automation modules
- **Error Handling**: Comprehensive logging and error recovery
- **Screenshot Capture**: Automatic screenshots for debugging
- **Configurable**: Environment-based configuration for credentials and settings

## Supported Portals

- **Clinic Assist**: Clinic management software
- **MHC Asia**: Insurance/TPA portal

## Setup

1. **Install dependencies**:
```bash
npm install
```

2. **Install Playwright browsers**:
```bash
npm run install-browsers
```

3. **Configure environment variables**:
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
- Clinic Assist URL, username, and password
- MHC Asia URL, username, and password
- Browser settings (headless mode, timeout, etc.)

## Usage

### Basic Usage

Run the automation:
```bash
npm start
```

### Programmatic Usage

```javascript
import { ClaimProcessor } from './src/core/claim-processor.js';

const processor = new ClaimProcessor();
await processor.init();

// Process a single claim workflow
const claimData = {
  id: 'CLAIM-001',
  patientName: 'John Doe',
  // ... other claim fields
};

await processor.processClaimWorkflow(claimData);

// Or process multiple claims for a specific portal
const claims = [/* array of claim objects */];
await processor.processClaimsForPortal('MHC_ASIA', claims);

await processor.close();
```

## Project Structure

```
├── src/
│   ├── automations/          # Portal-specific automation modules
│   │   ├── clinic-assist.js  # Clinic Assist automation
│   │   └── mhc-asia.js       # MHC Asia automation
│   ├── config/               # Configuration files
│   │   └── portals.js        # Portal configurations
│   ├── core/                 # Core automation logic
│   │   └── claim-processor.js # Main claim processor
│   ├── utils/                # Utility modules
│   │   ├── browser.js        # Browser management
│   │   └── logger.js         # Logging utility
│   └── index.js              # Main entry point
├── screenshots/              # Screenshots (auto-generated)
├── .env                      # Environment variables (not in git)
└── package.json
```

## Adding New Portals

1. Create a new automation class in `src/automations/`:
```javascript
export class NewPortalAutomation {
  constructor(page) {
    this.page = page;
    this.config = PORTALS.NEW_PORTAL;
  }
  
  async login() { /* ... */ }
  async processClaim(claimData) { /* ... */ }
  async logout() { /* ... */ }
}
```

2. Add portal configuration to `src/config/portals.js`:
```javascript
export const PORTALS = {
  // ... existing portals
  NEW_PORTAL: {
    name: 'New Portal',
    url: process.env.NEW_PORTAL_URL,
    username: process.env.NEW_PORTAL_USERNAME,
    password: process.env.NEW_PORTAL_PASSWORD,
  },
};
```

3. Update `ClaimProcessor` to handle the new portal.

## Configuration

### Environment Variables

- `CLINIC_ASSIST_URL`: Clinic Assist login URL
- `CLINIC_ASSIST_USERNAME`: Clinic Assist username
- `CLINIC_ASSIST_PASSWORD`: Clinic Assist password
- `MHC_ASIA_URL`: MHC Asia login URL
- `MHC_ASIA_USERNAME`: MHC Asia username
- `MHC_ASIA_PASSWORD`: MHC Asia password
- `HEADLESS`: Run browser in headless mode (true/false)
- `SLOW_MO`: Delay between actions in milliseconds
- `TIMEOUT`: Default timeout in milliseconds

### Proxy/VPN Configuration (for Singapore IP Access)

The MHC Asia website requires a Singapore IP address. The system supports two approaches:

#### Option 1: Automatic Free Proxy Discovery (Recommended - Free)

The system can automatically discover and use free Singapore proxies:

```bash
PROXY_ENABLED=true
PROXY_AUTO_DISCOVER=true
PROXY_MAX_RETRIES=3
```

**How it works:**
- Automatically fetches free Singapore proxies from multiple sources (GeoNix, Proxy5, ProxyFreeOnly, Proxify)
- Validates proxies to ensure they provide Singapore IP addresses
- Automatically rotates to a new proxy if one fails
- Fully automated - no manual setup required

**Pros:**
- 100% free
- Fully automated
- Works on all platforms (Mac, Windows, Linux)
- No time limits

**Cons:**
- Free proxies may be slower or less reliable
- May need to retry if proxy fails

#### Option 2: Manual Proxy Configuration

If you have a specific proxy server:

```bash
PROXY_ENABLED=true
PROXY_AUTO_DISCOVER=false
PROXY_SERVER=http://proxy.example.com:8080
PROXY_USERNAME=optional_username
PROXY_PASSWORD=optional_password
PROXY_BYPASS=localhost,127.0.0.1
```

#### Option 3: System-Level VPN (Alternative)

If you prefer using a VPN application:

1. Install a free VPN with Singapore servers:
   - **Falcon VPN**: Free Singapore servers (verify Mac support)
   - **VeePN**: Free Chrome extension with Singapore servers
2. Connect to a Singapore server
3. Disable proxy in `.env`:
   ```bash
   PROXY_ENABLED=false
   ```

**Note:** Most free VPNs have limitations:
- Proton VPN Free: Does NOT include Singapore servers
- TurisVPN Free: Only US servers
- SuperFreeVPN: No Mac version, security concerns
- Hotspot Shield: 45-day trial only

## Logging

Logs are written to:
- `combined.log`: All logs
- `error.log`: Error logs only
- Console: Formatted output

## Screenshots

Screenshots are automatically captured at key points:
- Login pages
- After login
- Error states
- Claims pages

Screenshots are saved in the `screenshots/` directory.

## Troubleshooting

1. **Login fails**: Check credentials in `.env` and verify the portal is accessible
2. **Element not found**: The automation uses multiple selectors. Check screenshots to see the actual page structure
3. **Timeout errors**: Increase `TIMEOUT` in `.env` or check network connectivity
4. **SSL errors**: The browser is configured to ignore HTTPS errors for self-signed certificates
5. **MHC Asia access denied / IP blocked**: 
   - Ensure `PROXY_ENABLED=true` in `.env`
   - Check logs for proxy validation messages
   - If auto-discovery fails, try a system-level VPN (see Proxy/VPN Configuration above)
   - Verify proxy provides Singapore IP by checking logs
6. **Proxy connection errors**:
   - The system will automatically retry with different proxies (up to `PROXY_MAX_RETRIES` times)
   - If all proxies fail, consider using a system-level VPN
   - Check your internet connection and firewall settings

## Development

### Testing Individual Portals

You can test individual portal automations:

```javascript
import { BrowserManager } from './src/utils/browser.js';
import { ClinicAssistAutomation } from './src/automations/clinic-assist.js';

const browserManager = new BrowserManager();
await browserManager.init();
const page = await browserManager.newPage();

const automation = new ClinicAssistAutomation(page);
await automation.login();
// ... test your automation
await automation.logout();

await browserManager.close();
```

## Notes

- The automation uses flexible selectors to handle different UI variations
- Screenshots are taken at critical points for debugging
- All actions have timeouts and error handling
- The system is designed to be extensible for new portals

## License

MIT

