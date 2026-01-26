#!/bin/bash

# Script to clean up orphaned Chrome/Chromium browser processes
# This is a safety net in case browsers aren't properly closed
# Run this via cron: */5 * * * * /path/to/cleanup-orphaned-browsers.sh

LOG_FILE="/var/log/browser-cleanup.log"
MAX_AGE_MINUTES=30  # Kill processes older than 30 minutes

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Find orphaned Chrome/Chromium processes
# Look for processes that:
# 1. Are chrome/chromium/headless_shell
# 2. Belong to the ubuntu user (or current user)
# 3. Are older than MAX_AGE_MINUTES
# 4. Don't have a parent process (orphaned)

USER="${SUDO_USER:-$USER}"
if [ -z "$USER" ]; then
    USER="ubuntu"
fi

log_message "Checking for orphaned browser processes (user: $USER, max age: ${MAX_AGE_MINUTES}min)..."

# Find processes
ORPHANED=$(ps aux | grep -E '(chrome|chromium|headless_shell)' | grep -v grep | grep "$USER" | awk '{print $2,$9}' | while read pid start_time; do
    # Calculate process age
    if [ -f "/proc/$pid" ]; then
        # Get process start time
        start_epoch=$(stat -c %Y /proc/$pid 2>/dev/null || echo 0)
        current_epoch=$(date +%s)
        age_seconds=$((current_epoch - start_epoch))
        age_minutes=$((age_seconds / 60))
        
        if [ $age_minutes -gt $MAX_AGE_MINUTES ]; then
            # Check if parent process exists
            ppid=$(ps -o ppid= -p $pid 2>/dev/null | tr -d ' ')
            if [ -n "$ppid" ] && [ "$ppid" != "1" ]; then
                # Check if parent is still running
                if ! ps -p $ppid > /dev/null 2>&1; then
                    echo "$pid $age_minutes"
                fi
            elif [ "$ppid" = "1" ]; then
                # Parent is init - likely orphaned
                echo "$pid $age_minutes"
            fi
        fi
    fi
done)

if [ -z "$ORPHANED" ]; then
    log_message "No orphaned browser processes found."
    exit 0
fi

# Kill orphaned processes
KILLED_COUNT=0
echo "$ORPHANED" | while read pid age; do
    if [ -n "$pid" ]; then
        log_message "Killing orphaned browser process PID $pid (age: ${age} minutes)"
        kill -TERM "$pid" 2>/dev/null
        sleep 2
        # Force kill if still running
        if kill -0 "$pid" 2>/dev/null; then
            log_message "Force killing PID $pid"
            kill -KILL "$pid" 2>/dev/null
        fi
        KILLED_COUNT=$((KILLED_COUNT + 1))
    fi
done

log_message "Cleanup complete. Killed $KILLED_COUNT orphaned browser process(es)."
