# Automation Guide

This guide explains how to use the date range extraction and daily automation scripts to capture queue list data from Clinic Assist and save it to the CRM.

## Overview

The automation system extracts patient visit data from Clinic Assist's Queue List reports and saves it to the Supabase CRM. Two main scripts are available:

1. **Date Range Extraction**: Process multiple dates at once (e.g., backfill historical data)
2. **Daily Extraction**: Run daily to capture yesterday's data (designed for cron jobs)

## Prerequisites

- Node.js installed and configured
- Environment variables set in `.env` file:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` (required for server-side automation)
  - Clinic Assist credentials (username, password, etc.)
- Browser dependencies installed: `npm run install-browsers`

## Date Range Extraction

Extract data for a range of dates, automatically skipping dates that already have data.

### Usage

**Basic usage (default: Dec 27, 2025 to today):**
```bash
npm run extract-date-range
```

**Specify date range:**
```bash
npm run extract-date-range 2025-12-27 2026-01-12
```

**Or directly:**
```bash
node src/examples/extract-date-range.js 2025-12-27 2026-01-12
```

### Features

- **Incremental processing**: Automatically skips dates that already have visits in the database
- **Efficient**: Single database query to check existing dates, then processes only missing dates
- **Session reuse**: Logs in once and processes all dates in sequence (much faster than individual logins)
- **Error resilience**: Continues processing even if one date fails
- **Progress logging**: Shows progress and summary statistics

### Example Output

```
=== Date Range Extraction ===
Date range: 2025-12-27 to 2026-01-12
Querying existing visit dates from database...
Found 1 dates with existing data in range
Processing 16 dates: 2025-12-27 to 2026-01-11

[1/16] Processing date: 2025-12-27
Extracted 21 items for 2025-12-27
✅ Successfully saved 21/21 items for 2025-12-27
...

=== Extraction Summary ===
Total dates processed: 16
Successful: 15
Failed: 1
Skipped (no data): 0
```

## Daily Automation

Extract data for yesterday's date. Designed to be run via cron job or scheduled task.

### Usage

```bash
npm run extract-daily
```

Or directly:
```bash
node src/examples/extract-daily.js
```

### Features

- **Processes yesterday's date**: Avoids processing incomplete current day data
- **Idempotent**: Skips if data already exists for yesterday
- **Exit codes**: Returns 0 (success) or 1 (failure) for cron monitoring
- **Lightweight**: Optimized for automated execution

### Exit Codes

- `0`: Success (data extracted or already exists)
- `1`: Failure (error during extraction)

## Setting Up Daily Automation

### Option 1: System Cron (Recommended for Production)

System cron is the simplest and most reliable method for production environments.

#### Linux/macOS

1. Open crontab:
```bash
crontab -e
```

2. Add a cron job (runs daily at 2 AM):
```bash
0 2 * * * cd /path/to/Baselrpacrm && /usr/local/bin/node src/examples/extract-daily.js >> logs/daily-extraction.log 2>&1
```

**Important**: 
- Replace `/path/to/Baselrpacrm` with your actual project path
- Replace `/usr/local/bin/node` with your Node.js path (find it with `which node`)
- Ensure the `logs/` directory exists: `mkdir -p logs`

3. Verify the cron job:
```bash
crontab -l
```

#### Windows (Task Scheduler)

1. Open Task Scheduler
2. Create Basic Task
3. Set trigger: Daily at 2:00 AM
4. Set action: Start a program
   - Program: `C:\Program Files\nodejs\node.exe` (or your Node.js path)
   - Arguments: `src\examples\extract-daily.js`
   - Start in: `C:\path\to\Baselrpacrm` (your project path)
5. Configure to run whether user is logged on or not

### Option 2: Node-Cron (Alternative)

For more control or if you prefer a Node.js-based scheduler, you can use `node-cron`. This requires the script to run continuously as a background service.

1. Install node-cron:
```bash
npm install node-cron
```

2. Create a scheduler script (see `src/examples/extract-daily-scheduler.js` - optional)

3. Run as background service:
```bash
node src/examples/extract-daily-scheduler.js
```

**Note**: System cron is recommended for production as it's simpler, more reliable, and doesn't require keeping a Node.js process running.

## Log Files

### Cron Logs

If using system cron with log redirection:
```bash
# Logs will be in:
logs/daily-extraction.log
```

### Application Logs

The scripts use Winston logger configured in `src/utils/logger.js`. Check your log configuration for log file locations.

## Troubleshooting

### "Supabase client not available"

- Check that `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in `.env`
- Verify the `.env` file is in the project root
- Ensure you're using `SUPABASE_SERVICE_ROLE_KEY` (not `SUPABASE_ANON_KEY`) for server-side automation

### "No items extracted"

- This may be normal if there were no visits on that date
- Check the Clinic Assist report manually to verify
- Review browser automation logs for errors

### Browser automation fails

- Ensure Playwright browsers are installed: `npm run install-browsers`
- Check network connectivity to Clinic Assist
- Verify credentials in `.env` file
- Check if Clinic Assist requires 2FA or has changed its UI

### Cron job not running

- Verify cron syntax: `crontab -l`
- Check cron logs: `grep CRON /var/log/syslog` (Linux) or check system logs
- Ensure Node.js path is correct: `which node`
- Ensure file paths are absolute or relative to the working directory
- Check file permissions: scripts must be executable

### Database connection errors

- Verify Supabase project is not paused
- Check `SUPABASE_URL` format (should be `https://xxx.supabase.co`)
- Verify `SUPABASE_SERVICE_ROLE_KEY` is correct
- Check network connectivity to Supabase

## Monitoring

### Check Last Extraction

Query the database to see the latest extracted data:
```sql
SELECT visit_date, COUNT(*) as count 
FROM visits 
WHERE source = 'Clinic Assist' 
GROUP BY visit_date 
ORDER BY visit_date DESC 
LIMIT 10;
```

### Monitor Cron Execution

```bash
# Check cron log (if using log redirection)
tail -f logs/daily-extraction.log

# Check last cron execution (Linux)
grep CRON /var/log/syslog | tail -20
```

## Best Practices

1. **Run daily extraction in off-peak hours** (e.g., 2 AM) to avoid system load
2. **Monitor logs regularly** to catch errors early
3. **Keep backups** of your Supabase database
4. **Test date range extraction** on a small range first before processing large date ranges
5. **Use service role key** for automation (never use anon key for server-side scripts)
6. **Verify data quality** periodically by checking the CRM interface

## Environment Variables

Required in `.env`:

```env
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Clinic Assist
CLINIC_ASSIST_URL=https://clinicassist.sg:1080
CLINIC_ASSIST_USERNAME=your_username
CLINIC_ASSIST_PASSWORD=your_password
CLINIC_ASSIST_CLINIC_GROUP=ssoc

# Optional
SUPABASE_SYSTEM_USER_ID=your_user_id (defaults to admin user if not set)
```

## Support

For issues or questions:
1. Check logs for error messages
2. Review this documentation
3. Verify environment variables are set correctly
4. Test with a single date first before running date ranges
