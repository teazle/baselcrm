# Quick Start Guide

## Installation

1. **Install Node.js dependencies**:
```bash
npm install
```

2. **Install Playwright browsers**:
```bash
npm run install-browsers
```

## Configuration

The `.env` file has been created with your credentials. You can modify it if needed:
- Clinic Assist: `Vincent` / `Testing123!!!`
- MHC Asia: `SSP000170` / `KY08240`

## Testing

### Test Login Functionality

First, test if the login works for both portals:

```bash
npm run test-login
```

This will:
- Open a browser window (not headless)
- Test login to Clinic Assist
- Test login to MHC Asia
- Take screenshots for debugging
- Show results in console

### Run Full Automation

```bash
npm start
```

This runs the main automation workflow.

## Customization

### Understanding the Flow

1. **Clinic Assist** → Extract claim data
2. **MHC Asia** → Submit claim

### Customizing Claim Processing

The claim processing logic needs to be customized based on the actual UI of each portal. Currently, the automation:

1. ✅ Logs into both portals
2. ✅ Navigates to claims sections
3. ⚠️ **Needs customization**: Actual claim extraction and submission

### Where to Customize

1. **Clinic Assist** (`src/automations/clinic-assist.js`):
   - `processClaim()` method - Add logic to extract claim details
   - `navigateToClaims()` - Adjust if navigation is different

2. **MHC Asia** (`src/automations/mhc-asia.js`):
   - `processClaim()` method - Add logic to fill and submit claim forms
   - `navigateToClaims()` - Adjust if navigation is different

3. **Claim Processor** (`src/core/claim-processor.js`):
   - `extractClaimFromClinicAssist()` - Customize claim data extraction

## Debugging

### Screenshots

Screenshots are automatically saved in the `screenshots/` directory:
- `clinic-assist-login-page.png` - Login page
- `clinic-assist-after-login.png` - After successful login
- `mhc-asia-login-page.png` - MHC Asia login page
- `mhc-asia-after-login.png` - After successful login
- Error screenshots when failures occur

### Logs

Check the log files:
- `combined.log` - All logs
- `error.log` - Only errors

### Browser Mode

By default, the browser runs in visible mode (`HEADLESS=false`). This helps you see what's happening. Set `HEADLESS=true` in `.env` to run in background.

## Next Steps

1. **Run test-login** to verify credentials work
2. **Inspect screenshots** to understand the UI structure
3. **Customize selectors** in the automation files based on actual UI
4. **Add claim processing logic** specific to your workflow
5. **Test with real claims** once basic flow works

## Common Issues

### "Element not found" errors
- Check screenshots to see the actual page structure
- Update selectors in the automation files
- The code uses multiple fallback selectors, but you may need to add more

### Login fails
- Verify credentials in `.env`
- Check if the portal URL is correct
- Look at error screenshots in `screenshots/` directory

### Timeout errors
- Increase `TIMEOUT` in `.env`
- Check network connectivity
- Some pages may load slowly - adjust wait times

## Adding More Portals

To add support for additional insurance/TPA portals:

1. Create new file: `src/automations/new-portal.js`
2. Copy structure from `mhc-asia.js` or `clinic-assist.js`
3. Add portal config to `src/config/portals.js`
4. Update `ClaimProcessor` to handle the new portal

## Support

For issues or questions, check:
- Screenshots in `screenshots/` directory
- Logs in `combined.log` and `error.log`
- Browser console (when running in non-headless mode)

