function escapeCSV(value: unknown): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCSV).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCSV).join(","));
  }
  return lines.join("\n");
}

export function readingsToCSV(
  readings: { source_timestamp: string; gravity: number; temperature: number | null; source: string }[],
): string {
  // Sort chronologically (API returns newest-first)
  const sorted = [...readings].sort(
    (a, b) => new Date(a.source_timestamp).getTime() - new Date(b.source_timestamp).getTime(),
  );
  return toCSV(
    ["Timestamp", "Gravity", "Temperature_C", "Source"],
    sorted.map((r) => [r.source_timestamp, r.gravity, r.temperature, r.source]),
  );
}

export function deviceReadingsToCSV(
  readings: { source_timestamp: string; gravity: number; temperature: number | null; battery: number | null; rssi: number | null; source: string }[],
): string {
  const sorted = [...readings].sort(
    (a, b) => new Date(a.source_timestamp).getTime() - new Date(b.source_timestamp).getTime(),
  );
  return toCSV(
    ["Timestamp", "Gravity", "Temperature_C", "Battery_Pct", "RSSI_dBm", "Source"],
    sorted.map((r) => [r.source_timestamp, r.gravity, r.temperature, r.battery, r.rssi, r.source]),
  );
}

export function activitiesToCSV(
  activities: { recorded_at: string; stage: string; type: string; title: string; details: Record<string, unknown> | null }[],
): string {
  // Sort chronologically (API returns newest-first)
  const sorted = [...activities].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
  );
  return toCSV(
    ["Timestamp", "Stage", "Type", "Title", "Details"],
    sorted.map((a) => [a.recorded_at, a.stage, a.type, a.title, a.details ? JSON.stringify(a.details) : ""]),
  );
}

export function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
