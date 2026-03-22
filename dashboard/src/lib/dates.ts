import { formatDistanceToNow, parseISO } from "date-fns";

/**
 * Parse a date string that may or may not have a timezone suffix.
 * SQLite datetime('now') returns "2026-03-22 13:41:01" without Z — treat as UTC.
 */
function parseUtc(dateStr: string): Date {
  if (dateStr.endsWith("Z") || dateStr.includes("+")) return parseISO(dateStr);
  // Bare date "2026-03-28" needs full ISO suffix; datetime "2026-03-28 13:00:00" just needs Z
  if (dateStr.includes("T") || dateStr.includes(" ")) return parseISO(dateStr + "Z");
  return parseISO(dateStr + "T00:00:00Z");
}

/** "3 days ago", "in 6 days", etc. — direction is automatic based on date vs now. */
export function timeAgo(dateStr: string): string {
  return formatDistanceToNow(parseUtc(dateStr), { addSuffix: true });
}
