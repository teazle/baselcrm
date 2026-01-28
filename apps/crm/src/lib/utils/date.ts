/**
 * Date utility functions for Singapore timezone (GMT+8 / Asia/Singapore)
 * All dates in the system should use this timezone for consistency
 */

const SINGAPORE_TIMEZONE = 'Asia/Singapore';

/**
 * Format a date/time string to Singapore timezone locale string
 * @param value - ISO date string or Date object
 * @param options - Intl.DateTimeFormatOptions for custom formatting
 * @returns Formatted date string in Singapore timezone
 */
export function formatDateTimeSingapore(
  value?: string | Date | null,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!value) return "--";
  
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : "--";
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
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

/**
 * Format a date to Singapore timezone (date only, no time)
 * @param value - ISO date string or Date object
 * @returns Formatted date string (YYYY-MM-DD format)
 */
export function formatDateSingapore(value?: string | Date | null): string {
  if (!value) return "--";
  
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : "--";
  
  // Format date in Singapore timezone
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
 * Get current date/time in Singapore timezone as ISO string
 * @returns ISO string in Singapore timezone
 */
export function getNowSingaporeISO(): string {
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
export function getTodaySingapore(): string {
  return formatDateSingapore(new Date());
}

/**
 * Create a Date object from a date string interpreted in Singapore timezone
 * @param dateString - Date string (YYYY-MM-DD format)
 * @returns Date object representing the date in Singapore timezone
 */
export function parseDateSingapore(dateString: string): Date {
  // Parse as if in Singapore timezone
  const [year, month, day] = dateString.split('-').map(Number);
  // Create date at noon Singapore time to avoid timezone issues
  const date = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00+08:00`);
  return date;
}

/**
 * Convert a date to Singapore timezone date string (YYYY-MM-DD)
 * Useful for converting UTC timestamps to Singapore date
 * @param value - Date object or ISO string
 * @returns Date string in YYYY-MM-DD format in Singapore timezone
 */
export function toSingaporeDateString(value: string | Date): string {
  return formatDateSingapore(value);
}

/**
 * Format a date to dd/mm/yyyy format (date only, no time)
 * @param value - ISO date string or Date object
 * @returns Formatted date string in dd/mm/yyyy format
 */
export function formatDateDDMMYYYY(value?: string | Date | null): string {
  if (!value) return "--";
  
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : "--";
  
  // Format date in Singapore timezone
  const formatter = new Intl.DateTimeFormat('en-SG', {
    timeZone: SINGAPORE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  const parts = formatter.formatToParts(date);
  const day = parts.find(p => p.type === 'day')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const year = parts.find(p => p.type === 'year')?.value;
  
  return `${day}/${month}/${year}`;
}

/**
 * Format a date/time to dd/mm/yyyy HH:MM:SS format
 * @param value - ISO date string or Date object
 * @returns Formatted date string in dd/mm/yyyy HH:MM:SS format
 */
export function formatDateTimeDDMMYYYY(value?: string | Date | null): string {
  if (!value) return "--";
  
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : "--";
  
  // Format date in Singapore timezone
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
  
  const parts = formatter.formatToParts(date);
  const day = parts.find(p => p.type === 'day')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const year = parts.find(p => p.type === 'year')?.value;
  const hour = parts.find(p => p.type === 'hour')?.value;
  const minute = parts.find(p => p.type === 'minute')?.value;
  const second = parts.find(p => p.type === 'second')?.value;
  
  return `${day}/${month}/${year} ${hour}:${minute}:${second}`;
}
