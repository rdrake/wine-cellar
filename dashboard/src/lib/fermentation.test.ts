import { describe, it, expect } from "vitest";
import {
  abv,
  attenuation,
  velocity,
  detectStall,
  tempStats,
  daysSince,
  projectedDaysToTarget,
} from "./fermentation";
import type { GravityPoint } from "./fermentation";

// ── ABV ──────────────────────────────────────────────────────────────

describe("abv", () => {
  it("calculates ABV from OG and SG", () => {
    // 1.050 -> 1.010 = 0.040 * 131.25 = 5.25
    expect(abv(1.05, 1.01)).toBeCloseTo(5.25, 2);
  });

  it("returns 0 when OG equals SG", () => {
    expect(abv(1.05, 1.05)).toBe(0);
  });

  it("handles high-gravity fermentation", () => {
    // 1.100 -> 1.000 = 0.100 * 131.25 = 13.125
    expect(abv(1.1, 1.0)).toBeCloseTo(13.125, 2);
  });
});

// ── Attenuation ──────────────────────────────────────────────────────

describe("attenuation", () => {
  it("calculates apparent attenuation percentage", () => {
    // OG=1.050, SG=1.010 => (0.040 / 0.050) * 100 = 80%
    expect(attenuation(1.05, 1.01)).toBeCloseTo(80, 0);
  });

  it("caps at 100%", () => {
    // SG below 1.000 could yield > 100% apparent attenuation
    expect(attenuation(1.05, 0.99)).toBeLessThanOrEqual(100);
  });

  it("returns 0 when OG is 1 or less", () => {
    expect(attenuation(1, 0.99)).toBe(0);
    expect(attenuation(0.999, 0.998)).toBe(0);
  });

  it("returns 0% when SG equals OG", () => {
    expect(attenuation(1.05, 1.05)).toBe(0);
  });
});

// ── Velocity ─────────────────────────────────────────────────────────

describe("velocity", () => {
  it("returns null with fewer than 2 readings", () => {
    expect(velocity([])).toBeNull();
    expect(velocity([{ gravity: 1.05, source_timestamp: "2026-03-20T00:00:00Z" }])).toBeNull();
  });

  it("calculates SG change per day over window", () => {
    const readings: GravityPoint[] = [
      { gravity: 1.050, source_timestamp: "2026-03-20T00:00:00Z" },
      { gravity: 1.040, source_timestamp: "2026-03-21T00:00:00Z" },
      { gravity: 1.030, source_timestamp: "2026-03-22T00:00:00Z" },
    ];
    // Over 48h window: latest=1.030 at day 22, oldest within window=1.050 at day 20
    // delta = (1.030 - 1.050) / 2 = -0.010
    const v = velocity(readings, 48);
    expect(v).toBeCloseTo(-0.01, 4);
  });

  it("returns null when all readings are at the same timestamp", () => {
    const readings: GravityPoint[] = [
      { gravity: 1.050, source_timestamp: "2026-03-20T00:00:00Z" },
      { gravity: 1.040, source_timestamp: "2026-03-20T00:00:00Z" },
    ];
    // days = 0, so returns null
    expect(velocity(readings)).toBeNull();
  });
});

// ── detectStall ──────────────────────────────────────────────────────

describe("detectStall", () => {
  it("returns null with fewer than 10 readings", () => {
    const readings: GravityPoint[] = Array.from({ length: 9 }, (_, i) => ({
      gravity: 1.05 - i * 0.001,
      source_timestamp: new Date(Date.now() - (9 - i) * 3600000).toISOString(),
    }));
    expect(detectStall(readings)).toBeNull();
  });

  it("returns null when gravity is below 0.998 (fermentation complete)", () => {
    const readings: GravityPoint[] = Array.from({ length: 12 }, (_, i) => ({
      gravity: 0.995,
      source_timestamp: new Date(Date.now() - (12 - i) * 3600000 * 6).toISOString(),
    }));
    expect(detectStall(readings)).toBeNull();
  });

  it("detects stall when gravity is unchanged for 48+ hours above 1.005", () => {
    // Create 12 readings over 3 days, all at the same gravity above 1.005
    const readings: GravityPoint[] = Array.from({ length: 12 }, (_, i) => ({
      gravity: 1.020,
      source_timestamp: new Date(Date.now() - (12 - i) * 3600000 * 6).toISOString(),
    }));
    const result = detectStall(readings);
    expect(result).toContain("unchanged");
  });
});

// ── tempStats ────────────────────────────────────────────────────────

describe("tempStats", () => {
  it("returns null when no readings have temperature", () => {
    expect(tempStats([{ temperature: null }, { temperature: null }])).toBeNull();
  });

  it("calculates min, max, and avg", () => {
    const readings = [
      { temperature: 18 },
      { temperature: 22 },
      { temperature: 20 },
      { temperature: null },
    ];
    const result = tempStats(readings);
    expect(result).toEqual({ min: 18, max: 22, avg: 20 });
  });

  it("handles single temperature reading", () => {
    const result = tempStats([{ temperature: 15 }]);
    expect(result).toEqual({ min: 15, max: 15, avg: 15 });
  });
});

// ── daysSince ────────────────────────────────────────────────────────

describe("daysSince", () => {
  it("returns 0 for today", () => {
    expect(daysSince(new Date().toISOString())).toBe(0);
  });

  it("returns correct number of days", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();
    expect(daysSince(fiveDaysAgo)).toBe(5);
  });
});

// ── projectedDaysToTarget ────────────────────────────────────────────

describe("projectedDaysToTarget", () => {
  it("returns null when velocity is not negative (not fermenting)", () => {
    expect(projectedDaysToTarget(1.02, 0.996, 0)).toBeNull();
    expect(projectedDaysToTarget(1.02, 0.996, 0.001)).toBeNull();
  });

  it("returns 0 when already at or past target", () => {
    expect(projectedDaysToTarget(0.995, 0.996, -0.001)).toBe(0);
  });

  it("projects days correctly", () => {
    // SG=1.500, target=1.000, velocity=-0.250/day
    // remaining = 0.500, days = ceil(0.500 / 0.250) = 2
    expect(projectedDaysToTarget(1.5, 1.0, -0.25)).toBe(2);
  });

  it("rounds up to next whole day", () => {
    // SG=1.500, target=1.000, velocity=-0.300/day
    // remaining = 0.500, days = ceil(0.500 / 0.300) = ceil(1.667) = 2
    expect(projectedDaysToTarget(1.5, 1.0, -0.3)).toBe(2);
  });
});
