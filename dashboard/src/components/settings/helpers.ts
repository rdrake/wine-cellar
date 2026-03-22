// ── Helpers ──────────────────────────────────────────────────────────

export function batteryColor(pct: number): string {
  if (pct > 50) return "text-green-600 dark:text-green-400";
  if (pct > 20) return "text-yellow-600 dark:text-yellow-400";
  return "text-destructive";
}

export function signalLabel(rssi: number): { text: string; color: string } {
  if (rssi > -50) return { text: "Excellent", color: "text-green-600 dark:text-green-400" };
  if (rssi > -70) return { text: "Good", color: "text-green-600 dark:text-green-400" };
  if (rssi > -85) return { text: "Fair", color: "text-yellow-600 dark:text-yellow-400" };
  return { text: "Weak", color: "text-destructive" };
}
