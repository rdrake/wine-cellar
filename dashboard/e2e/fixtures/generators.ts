import { randomUUID } from "crypto";

export interface CurveParams {
  og: number;
  currentSg: number;
  days: number;
  tempTarget: number;
  tempVariance: number;
  readingsPerDay: number;
  style: "red" | "white";
  stallAtSg?: number;
  velocityMultiplier?: number;
}

export interface ReadingRow {
  id: string;
  gravity: number;
  temperature: number;
  battery: number;
  rssi: number;
  timestamp: string; // ISO 8601
}

// Deterministic seeded PRNG (mulberry32) — no Math.random() so runs are reproducible
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller for Gaussian noise
function gaussian(rng: () => number, mean: number, stddev: number): number {
  const u1 = rng();
  const u2 = rng();
  return mean + stddev * Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
}

export function generateFermentationCurve(params: CurveParams): ReadingRow[] {
  const {
    og,
    currentSg,
    days,
    tempTarget,
    tempVariance,
    readingsPerDay,
    style,
    stallAtSg,
    velocityMultiplier = 1.0,
  } = params;

  const totalReadings = days * readingsPerDay;
  const readings: ReadingRow[] = [];
  const rng = mulberry32(Math.round(og * 10000) + days);

  // Fermentation rate constant (per hour)
  // Reds at 27C: ~0.012 SG/day = 0.0005/hr; whites at 16C: ~0.006 SG/day = 0.00025/hr
  const baseRate = style === "red" ? 0.0005 : 0.00025;
  const rate = baseRate * velocityMultiplier;

  // Total SG drop needed
  const totalDrop = og - currentSg;

  // Time parameters
  const lagHours = style === "red" ? 18 : 24;
  const peakHours = style === "red" ? 72 : 96;

  // Anchor timestamp: "now" minus `days` days
  const now = new Date();
  const startTime = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  for (let i = 0; i < totalReadings; i++) {
    const hoursElapsed = (i / readingsPerDay) * 24;

    // Gravity curve
    let progress: number;
    if (hoursElapsed < lagHours) {
      // Lag phase: very slow start
      progress = 0.02 * (hoursElapsed / lagHours);
    } else if (hoursElapsed < peakHours) {
      // Exponential phase: rapid fermentation
      const phaseProgress = (hoursElapsed - lagHours) / (peakHours - lagHours);
      progress = 0.02 + 0.5 * phaseProgress;
    } else {
      // Deceleration phase: exponential decay toward target
      const hoursAfterPeak = hoursElapsed - peakHours;
      const decayRate = rate * 2;
      progress = 0.52 + (1 - 0.52) * (1 - Math.exp(-decayRate * hoursAfterPeak));
    }

    let gravity = og - totalDrop * Math.min(progress, 1);

    // Stall: flatten at stallAtSg
    if (stallAtSg !== undefined && gravity <= stallAtSg) {
      gravity = stallAtSg + gaussian(rng, 0, 0.0002);
    }

    // Clamp
    gravity = Math.max(gravity, currentSg);

    // Temperature: ambient + fermentation heat + noise
    let temp = tempTarget;
    if (hoursElapsed >= lagHours && hoursElapsed < peakHours * 1.5) {
      // Fermentation exotherm: +1-2C during active phase
      const heatFraction = Math.sin(
        (Math.PI * (hoursElapsed - lagHours)) / (peakHours * 1.5 - lagHours)
      );
      temp += heatFraction * (style === "red" ? 2.0 : 1.0);
    }
    // If stalled, temp drifts toward a cooler ambient
    if (stallAtSg !== undefined && gravity <= stallAtSg + 0.002) {
      temp = tempTarget - 2;
    }
    temp = gaussian(rng, temp, tempVariance * 0.3);

    const timestamp = new Date(startTime.getTime() + hoursElapsed * 60 * 60 * 1000);

    // Battery: starts at 100%, drains ~0.1%/day
    const batteryDrain = (hoursElapsed / 24) * 0.1;
    const battery = Math.max(10, 100 - batteryDrain + gaussian(rng, 0, 0.2));

    // RSSI: WiFi signal around -60 dBm with variance
    const rssi = gaussian(rng, -60, 5);

    readings.push({
      id: randomUUID(),
      gravity: Math.round(gravity * 10000) / 10000,
      temperature: Math.round(temp * 100) / 100,
      battery: Math.round(Math.min(100, Math.max(0, battery)) * 10) / 10,
      rssi: Math.round(Math.max(-100, Math.min(-20, rssi))),
      timestamp: timestamp.toISOString(),
    });
  }

  return readings;
}
