import { formatDistanceToNow, parseISO } from "date-fns";

/**
 * Parse a date string that may or may not have a timezone suffix.
 * SQLite datetime('now') returns "2026-03-22 13:41:01" without Z — treat as UTC.
 */
function parseUtc(dateStr: string): Date {
  if (dateStr.endsWith("Z") || dateStr.includes("+")) return parseISO(dateStr);
  return parseISO(dateStr + "Z");
}

/** "3 days ago", "about 2 months ago", etc. */
export function timeAgo(dateStr: string): string {
  return formatDistanceToNow(parseUtc(dateStr), { addSuffix: true });
}

/** "in 6 days", "in about 2 months", etc. */
export function timeUntil(dateStr: string): string {
  return formatDistanceToNow(parseUtc(dateStr), { addSuffix: true });
}
