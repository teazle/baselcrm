# Browser Cleanup Solution

## Problem
Browser instances (Chrome/headless_shell) were not being properly closed, causing memory exhaustion on the EC2 instance. This happened because:
1. `process.exit()` bypasses cleanup (skips `finally` blocks)
2. Incomplete `close()` method (didn't close contexts)
3. No exit handlers for uncaught exceptions

## Solution: Hybrid Approach (Recommended)

### ✅ **Primary Solution: Safe Exit Wrapper** (Best Practice)

**Why this is better:**
- ✅ **Proactive**: Prevents the issue before it happens
- ✅ **Centralized**: One utility manages all cleanup
- ✅ **Gradual adoption**: Can be adopted file-by-file
- ✅ **Follows Playwright best practices**: Explicit context cleanup
- ✅ **Works with existing code**: BrowserManager auto-registers cleanup

**How it works:**
1. `BrowserManager` automatically registers cleanup with `safe-exit.js`
2. When `safeExit()` is called, all registered cleanup functions run
3. Even if `process.exit()` is called directly, signal handlers catch it

**Usage:**
```javascript
// OLD WAY (bypasses cleanup):
process.exit(1);

// NEW WAY (ensures cleanup):
import { safeExit } from '../utils/safe-exit.js';
await safeExit(1);  // or safeExitSync(1) if you can't await
```

### ✅ **Safety Net: Cron Job** (Backup)

**Why this helps:**
- ✅ **No code changes needed**: Works immediately
- ✅ **Catches edge cases**: Handles crashes, kills, etc.
- ✅ **Low maintenance**: Set it and forget it

**Setup:**
```bash
# On the EC2 instance, add to crontab:
crontab -e

# Add this line (runs every 5 minutes):
*/5 * * * * /home/ubuntu/Baselrpacrm/scripts/cleanup-orphaned-browsers.sh
```

## Implementation Status

### ✅ Completed
1. ✅ Improved `BrowserManager.close()` - now closes all contexts explicitly
2. ✅ Created `safe-exit.js` utility for centralized cleanup
3. ✅ Integrated BrowserManager with safe-exit (auto-registers cleanup)
4. ✅ Created cleanup cron script as safety net

### 📋 Recommended Next Steps

**Option A: Gradual Migration (Recommended)**
- Replace `process.exit()` with `safeExit()` in critical files first
- Files that run frequently or in production
- Test files can be updated later

**Option B: Full Migration**
- Replace all 78 instances across 37 files
- Use find/replace: `process.exit(` → `safeExitSync(`
- More thorough but requires testing

**Option C: Keep Current + Cron**
- Don't change code, just use cron job
- Less ideal but works as temporary solution

## Recommendation

**Use Option A (Gradual Migration) + Cron Job**

**Why:**
1. **Safe Exit Wrapper** is the proper solution (prevents issues)
2. **Cron Job** provides safety net (catches edge cases)
3. **Gradual migration** reduces risk (test as you go)
4. **BrowserManager already integrated** - cleanup happens automatically for new BrowserManager instances

**Priority files to update:**
1. `src/index.js` - Main entry point
2. `src/core/claim-processor.js` - Core processing
3. `src/core/claim-workflow.js` - Workflow execution
4. Production scripts in `src/examples/` that run frequently

## Testing

After implementing, monitor:
```bash
# Check for orphaned processes
ps aux | grep -E '(chrome|chromium|headless_shell)' | grep -v grep

# Check memory usage
free -h

# Check cleanup script logs
tail -f /var/log/browser-cleanup.log
```
