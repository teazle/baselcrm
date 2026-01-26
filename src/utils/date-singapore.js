/**
 * Date utility functions for Singapore timezone (GMT+8 / Asia/Singapore)
 * For use in Node.js backend code
 */

const SINGAPORE_TIMEZONE = 'Asia/Singapore';

/**
 * Get current date/time in Singapore timezone as ISO string
 * Note: For database storage, using UTC ISO strings (toISOString()) is recommended.
 * This function is useful when you need to format a date as if it were created in Singapore timezone.
 * @returns ISO string in Singapore timezone format
 */
function getNowSingaporeISO() {
  const now = new Date();
  // Get the date/time components in Singapore timezone
  const formatter = new Intl.DateTimeFormat('en-SG', {
    timeZone: SINGAPORE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  const hour = parts.find(p => p.type === 'hour')?.value;
  const minute = parts.find(p => p.type === 'minute')?.value;
  const second = parts.find(p => p.type === 'second')?.value;
  
  // Return as ISO string in Singapore timezone (GMT+8)
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}

/**
 * Get current date in Singapore timezone (date only, YYYY-MM-DD)
 * @returns Date string in YYYY-MM-DD format
 */
function getTodaySingapore() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-SG', {
    timeZone: SINGAPORE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  
  return `${year}-${month}-${day}`;
}

/**
 * Format a date to Singapore timezone date string (YYYY-MM-DD)
 * Useful for converting UTC timestamps to Singapore date
 * @param {string|Date} value - Date object or ISO string
 * @returns Date string in YYYY-MM-DD format in Singapore timezone
 */
function toSingaporeDateString(value) {
  if (!value) return null;
  
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  
  const formatter = new Intl.DateTimeFormat('en-SG', {
    timeZone: SINGAPORE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  
  return `${year}-${month}-${day}`;
}

/**
 * Format a date/time string to Singapore timezone locale string
 * @param {string|Date} value - ISO date string or Date object
 * @param {Object} options - Intl.DateTimeFormatOptions for custom formatting
 * @returns Formatted date string in Singapore timezone
 */
function formatDateTimeSingapore(value, options = {}) {
  if (!value) return "--";
  
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : "--";
  
  const defaultOptions = {
    timeZone: SINGAPORE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };
  
  return new Intl.DateTimeFormat('en-SG', { ...defaultOptions, ...options }).format(date);
}

module.exports = {
  getNowSingaporeISO,
  getTodaySingapore,
  toSingaporeDateString,
  formatDateTimeSingapore,
  SINGAPORE_TIMEZONE,
};
