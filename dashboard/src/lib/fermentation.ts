// dashboard/src/lib/fermentation.ts

/** Gravity point — minimum shape needed for time-series calcs */
export interface GravityPoint {
  gravity: number;
  source_timestamp: string;
}

/** ABV estimate from OG and current SG. */
export function abv(og: number, sg: number): number {
  return (og - sg) * 131.25;
}

/** Apparent attenuation %, capped at 100. */
export function attenuation(og: number, sg: number): number {
  if (og <= 1) return 0;
  return Math.min(100, ((og - sg) / (og - 1)) * 100);
}

/** SG velocity: points dropped per day over the given window (negative = dropping). */
export function velocity(readings: GravityPoint[], windowHours = 48): number | null {
  if (readings.length < 2) return null;
  const latest = readings[readings.length - 1];
  const cutoff = new Date(new Date(latest.source_timestamp).getTime() - windowHours * 3600000);
  const oldest = readings.find((r) => new Date(r.source_timestamp) >= cutoff);
  if (!oldest || oldest === latest) return null;
  const days = (new Date(latest.source_timestamp).getTime() - new Date(oldest.source_timestamp).getTime()) / 86400000;
  if (days <= 0) return null;
  return (latest.gravity - oldest.gravity) / days;
}

/** Stall detection. Returns null if not enough data, a reason string if stalled. */
export function detectStall(readings: GravityPoint[]): string | null {
  if (readings.length < 10) return null;
  const v48 = velocity(readings, 48);
  const v7d = velocity(readings, 168);
  if (v48 === null || v7d === null) return null;
  const latest = readings[readings.length - 1];
  if (latest.gravity < 0.998) return null;
  if (Math.abs(v48) < 0.0005 && latest.gravity > 1.005) {
    return "Gravity unchanged for 48+ hours";
  }
  if (v7d !== 0 && Math.abs(v48) < Math.abs(v7d) * 0.2 && latest.gravity > 1.005) {
    return "Velocity dropped to <20% of 7-day average";
  }
  return null;
}

/** Temperature stats from readings that have temperature. */
export function tempStats(readings: { temperature: number | null }[]): { min: number; max: number; avg: number } | null {
  const temps = readings.map((r) => r.temperature).filter((t): t is number => t != null);
  if (temps.length === 0) return null;
  return {
    min: Math.min(...temps),
    max: Math.max(...temps),
    avg: temps.reduce((a, b) => a + b, 0) / temps.length,
  };
}

/** Days since a given ISO timestamp. */
export function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
}

/** Projected days to reach target gravity based on current velocity. */
export function projectedDaysToTarget(currentSG: number, targetSG: number, velocityPerDay: number): number | null {
  if (velocityPerDay >= 0) return null;
  const remaining = currentSG - targetSG;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / Math.abs(velocityPerDay));
}
