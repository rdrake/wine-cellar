import { formatDistanceToNow, parseISO } from "date-fns";

/**
 * Parse a date string that may or may not have a timezone suffix.
 * SQLite datetime('now') returns "2026-03-22 13:41:01" without Z — treat as UTC.
 */
export function parseUtc(dateStr: string): Date {
  if (dateStr.endsWith("Z") || dateStr.includes("+")) return parseISO(dateStr);
  // Bare date "2026-03-28" needs full ISO suffix; datetime "2026-03-28 13:00:00" just needs Z
  if (dateStr.includes("T") || dateStr.includes(" ")) return parseISO(dateStr + "Z");
  return parseISO(dateStr + "T00:00:00Z");
}

/** "3 days ago", "in 6 days", etc. — direction is automatic based on date vs now. */
export function timeAgo(dateStr: string): string {
  return formatDistanceToNow(parseUtc(dateStr), { addSuffix: true });
}

/** Compact relative time: "just now", "5m ago", "3h ago", "yesterday", "12d ago", or "Mar 4". */
export function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
