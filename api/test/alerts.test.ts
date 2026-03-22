import { describe, it, expect } from "vitest";
import { evaluateAlerts, type BatchAlertContext } from "../src/lib/alerts";

/** Helper: generate an ISO timestamp offset from "now" by the given hours. */
function hoursAgo(hours: number, base = new Date("2026-03-20T12:00:00Z")): string {
  return new Date(base.getTime() - hours * 3600_000).toISOString();
}

/** Build a minimal context, merging overrides. */
function ctx(overrides: Partial<BatchAlertContext> = {}): BatchAlertContext {
  return {
    batchId: "batch-1",
    userId: "user-1",
    stage: "primary_fermentation",
    wineType: "red",
    targetGravity: null,
    hasAssignedDevice: true,
    readings: [],
    ...overrides,
  };
}

/** Generate N evenly-spaced readings over `spanHours`, with linearly interpolated gravity. */
function linearReadings(
  n: number,
  startGravity: number,
  endGravity: number,
  spanHours: number,
  opts: { temp?: number | null; base?: Date } = {},
): BatchAlertContext["readings"] {
  const base = opts.base ?? new Date("2026-03-20T12:00:00Z");
  const temp = opts.temp === undefined ? 20 : opts.temp;
  return Array.from({ length: n }, (_, i) => {
    const frac = n === 1 ? 1 : i / (n - 1);
    return {
      gravity: startGravity + (endGravity - startGravity) * frac,
      temperature: temp,
      source_timestamp: new Date(base.getTime() - spanHours * 3600_000 * (1 - frac)).toISOString(),
    };
  });
}

describe("evaluateAlerts", () => {
  // ── Empty readings ──────────────────────────────────────────────────
  it("returns empty array when readings is empty", () => {
    const result = evaluateAlerts(ctx({ readings: [] }));
    expect(result).toEqual([]);
  });

  // ── temp_high ───────────────────────────────────────────────────────
  it("fires temp_high when latest temperature >= 30", () => {
    const readings = [
      { gravity: 1.05, temperature: 31, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ readings }));
    expect(result.some((a) => a.type === "temp_high")).toBe(true);
  });

  it("does not fire temp_high when temperature is 29", () => {
    const readings = [
      { gravity: 1.05, temperature: 29, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ readings }));
    expect(result.some((a) => a.type === "temp_high")).toBe(false);
  });

  it("fires temp_high at exactly 30", () => {
    const readings = [
      { gravity: 1.05, temperature: 30, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ readings }));
    expect(result.some((a) => a.type === "temp_high")).toBe(true);
  });

  it("fires temp_high for white wine at 22°C", () => {
    const readings = [
      { gravity: 1.05, temperature: 22, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ wineType: "white", readings }));
    expect(result.some((a) => a.type === "temp_high")).toBe(true);
  });

  it("does not fire temp_high for white wine at 21°C", () => {
    const readings = [
      { gravity: 1.05, temperature: 21, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ wineType: "white", readings }));
    expect(result.some((a) => a.type === "temp_high")).toBe(false);
  });

  it("fires temp_high for rosé at 22°C", () => {
    const readings = [
      { gravity: 1.05, temperature: 22, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ wineType: "rosé", readings }));
    expect(result.some((a) => a.type === "temp_high")).toBe(true);
  });

  it("does not fire temp_high for red wine at 29°C", () => {
    const readings = [
      { gravity: 1.05, temperature: 29, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ wineType: "red", readings }));
    expect(result.some((a) => a.type === "temp_high")).toBe(false);
  });

  it("uses 30°C default for unknown wine type", () => {
    const readings = [
      { gravity: 1.05, temperature: 25, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ wineType: "sparkling", readings }));
    expect(result.some((a) => a.type === "temp_high")).toBe(false);
  });

  // ── temp_low ────────────────────────────────────────────────────────
  it("fires temp_low when latest temperature <= 8", () => {
    const readings = [
      { gravity: 1.05, temperature: 5, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ readings }));
    expect(result.some((a) => a.type === "temp_low")).toBe(true);
  });

  it("does not fire temp_low when temperature is above threshold", () => {
    const readings = [
      { gravity: 1.05, temperature: 11, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ readings }));
    expect(result.some((a) => a.type === "temp_low")).toBe(false);
  });

  it("fires temp_low at exactly 8", () => {
    const readings = [
      { gravity: 1.05, temperature: 8, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ readings }));
    expect(result.some((a) => a.type === "temp_low")).toBe(true);
  });

  it("fires temp_low for red wine at 10°C", () => {
    const readings = [
      { gravity: 1.05, temperature: 10, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ wineType: "red", readings }));
    expect(result.some((a) => a.type === "temp_low")).toBe(true);
  });

  it("does not fire temp_low for red wine at 11°C", () => {
    const readings = [
      { gravity: 1.05, temperature: 11, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ wineType: "red", readings }));
    expect(result.some((a) => a.type === "temp_low")).toBe(false);
  });

  it("does not fire temp_low for white wine at 10°C", () => {
    const readings = [
      { gravity: 1.05, temperature: 10, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ wineType: "white", readings }));
    expect(result.some((a) => a.type === "temp_low")).toBe(false);
  });

  it("skips temp checks when temperature is null", () => {
    const readings = [
      { gravity: 1.05, temperature: null, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ readings }));
    expect(result.some((a) => a.type === "temp_high")).toBe(false);
    expect(result.some((a) => a.type === "temp_low")).toBe(false);
  });

  // ── no_readings ─────────────────────────────────────────────────────
  it("fires no_readings when device assigned and last reading > 48h old", () => {
    const readings = [
      { gravity: 1.05, temperature: 20, source_timestamp: hoursAgo(50) },
    ];
    const result = evaluateAlerts(ctx({ hasAssignedDevice: true, readings }));
    expect(result.some((a) => a.type === "no_readings")).toBe(true);
  });

  it("does not fire no_readings when no device assigned", () => {
    const readings = [
      { gravity: 1.05, temperature: 20, source_timestamp: hoursAgo(50) },
    ];
    const result = evaluateAlerts(ctx({ hasAssignedDevice: false, readings }));
    expect(result.some((a) => a.type === "no_readings")).toBe(false);
  });

  it("does not fire no_readings when last reading is recent", () => {
    const readings = [
      { gravity: 1.05, temperature: 20, source_timestamp: hoursAgo(1) },
    ];
    const result = evaluateAlerts(ctx({ hasAssignedDevice: true, readings }));
    expect(result.some((a) => a.type === "no_readings")).toBe(false);
  });

  it("does not fire no_readings when readings is empty (nothing to be stale)", () => {
    const result = evaluateAlerts(ctx({ hasAssignedDevice: true, readings: [] }));
    // Empty readings → no latest reading to check staleness
    expect(result.some((a) => a.type === "no_readings")).toBe(false);
  });

  // ── stall ───────────────────────────────────────────────────────────
  it("detects stall when gravity stuck above 1.005 with near-zero 48h velocity", () => {
    // 12 readings over 10 days. First 6 drop from 1.050 → 1.020 (days 0-5),
    // then flat at 1.020 for the remaining 5 days.
    const base = new Date("2026-03-20T12:00:00Z");
    const readings: BatchAlertContext["readings"] = [];
    for (let i = 0; i < 6; i++) {
      readings.push({
        gravity: 1.05 - i * 0.006,
        temperature: 20,
        source_timestamp: new Date(base.getTime() - (10 - i) * 86400_000).toISOString(),
      });
    }
    // Flat readings at 1.020 from day 5 to day 10
    for (let i = 0; i < 6; i++) {
      readings.push({
        gravity: 1.02,
        temperature: 20,
        source_timestamp: new Date(base.getTime() - (4 - i) * 86400_000).toISOString(),
      });
    }

    const result = evaluateAlerts(ctx({ readings }));
    expect(result.some((a) => a.type === "stall")).toBe(true);
  });

  it("does not fire stall when gravity < 0.998 (fermentation complete)", () => {
    // Flat readings at 0.995 — technically stalled but gravity says done
    const base = new Date("2026-03-20T12:00:00Z");
    const readings: BatchAlertContext["readings"] = [];
    for (let i = 0; i < 12; i++) {
      readings.push({
        gravity: 0.995,
        temperature: 20,
        source_timestamp: new Date(base.getTime() - (11 - i) * 86400_000).toISOString(),
      });
    }

    const result = evaluateAlerts(ctx({ readings }));
    expect(result.some((a) => a.type === "stall")).toBe(false);
  });

  it("does not fire stall with fewer than 10 readings", () => {
    const readings = linearReadings(9, 1.05, 1.05, 240, { temp: 20 });
    const result = evaluateAlerts(ctx({ readings }));
    expect(result.some((a) => a.type === "stall")).toBe(false);
  });

  it("detects stall via velocity ratio (48h < 20% of 7d)", () => {
    // Build readings: active drop for first 5 days, then near-flat for last 3 days
    const base = new Date("2026-03-20T12:00:00Z");
    const readings: BatchAlertContext["readings"] = [];

    // Days -8 to -3: active fermentation dropping from 1.050 to 1.020
    for (let i = 0; i < 6; i++) {
      readings.push({
        gravity: 1.05 - i * 0.006,
        temperature: 20,
        source_timestamp: new Date(base.getTime() - (8 - i) * 86400_000).toISOString(),
      });
    }
    // Days -2 to 0: very slow — tiny drop from 1.020 to 1.0198
    for (let i = 0; i < 5; i++) {
      readings.push({
        gravity: 1.02 - i * 0.00005,
        temperature: 20,
        source_timestamp: new Date(base.getTime() - (2 - i * 0.5) * 86400_000).toISOString(),
      });
    }

    const result = evaluateAlerts(ctx({ readings }));
    expect(result.some((a) => a.type === "stall")).toBe(true);
  });

  // ── stage_suggestion: primary → secondary ───────────────────────────
  it("suggests secondary_fermentation when gravity < 1.020 and velocity slowing", () => {
    // 12 readings over 10 days. Active drop early, slow in last 48h.
    // Gravity ends at 1.015 (< 1.020). 48h velocity < 50% of 7d velocity.
    const base = new Date("2026-03-20T12:00:00Z");
    const readings: BatchAlertContext["readings"] = [];

    // Days -10 to -3: drop from 1.050 to 1.018
    for (let i = 0; i < 8; i++) {
      readings.push({
        gravity: 1.05 - i * 0.004,
        temperature: 20,
        source_timestamp: new Date(base.getTime() - (10 - i) * 86400_000).toISOString(),
      });
    }
    // Days -2 to 0: very slow drop from 1.018 to 1.015
    for (let i = 0; i < 4; i++) {
      readings.push({
        gravity: 1.018 - i * 0.001,
        temperature: 20,
        source_timestamp: new Date(base.getTime() - (2 - i * 0.666) * 86400_000).toISOString(),
      });
    }

    const result = evaluateAlerts(ctx({ stage: "primary_fermentation", readings }));
    expect(result.some((a) => a.type === "stage_suggestion")).toBe(true);
    const suggestion = result.find((a) => a.type === "stage_suggestion")!;
    expect(suggestion.context.suggestedStage).toBe("secondary_fermentation");
  });

  // ── stage_suggestion: secondary → stabilization ─────────────────────
  it("suggests stabilization when gravity stable and < 1.000 in secondary", () => {
    // 12 readings over 5 days, all near 0.996. 72h range < 0.001.
    const base = new Date("2026-03-20T12:00:00Z");
    const readings: BatchAlertContext["readings"] = [];
    for (let i = 0; i < 12; i++) {
      readings.push({
        gravity: 0.996 + (i % 2 === 0 ? 0.0002 : -0.0002),
        temperature: 20,
        source_timestamp: new Date(base.getTime() - (5 - i * (5 / 11)) * 86400_000).toISOString(),
      });
    }

    const result = evaluateAlerts(ctx({ stage: "secondary_fermentation", readings }));
    expect(result.some((a) => a.type === "stage_suggestion")).toBe(true);
    const suggestion = result.find((a) => a.type === "stage_suggestion")!;
    expect(suggestion.context.suggestedStage).toBe("stabilization");
  });

  it("suggests stabilization when gravity within 0.002 of targetGravity in secondary", () => {
    const base = new Date("2026-03-20T12:00:00Z");
    const readings: BatchAlertContext["readings"] = [];
    // All readings at ~1.005 and target is 1.004 → within 0.002
    for (let i = 0; i < 12; i++) {
      readings.push({
        gravity: 1.005 + (i % 2 === 0 ? 0.0001 : -0.0001),
        temperature: 20,
        source_timestamp: new Date(base.getTime() - (5 - i * (5 / 11)) * 86400_000).toISOString(),
      });
    }

    const result = evaluateAlerts(
      ctx({ stage: "secondary_fermentation", targetGravity: 1.004, readings }),
    );
    expect(result.some((a) => a.type === "stage_suggestion")).toBe(true);
    const suggestion = result.find((a) => a.type === "stage_suggestion")!;
    expect(suggestion.context.suggestedStage).toBe("stabilization");
  });

  // ── No stage_suggestion for ineligible stages ──────────────────────
  it("does not suggest stage change for must_prep", () => {
    const readings = linearReadings(12, 1.05, 1.01, 240, { temp: 20 });
    const result = evaluateAlerts(ctx({ stage: "must_prep", readings }));
    expect(result.some((a) => a.type === "stage_suggestion")).toBe(false);
  });

  it("does not suggest stage change for stabilization", () => {
    const readings = linearReadings(12, 1.0, 0.996, 120, { temp: 20 });
    const result = evaluateAlerts(ctx({ stage: "stabilization", readings }));
    expect(result.some((a) => a.type === "stage_suggestion")).toBe(false);
  });

  it("does not suggest stage change for bottling", () => {
    const readings = linearReadings(12, 1.0, 0.996, 120, { temp: 20 });
    const result = evaluateAlerts(ctx({ stage: "bottling", readings }));
    expect(result.some((a) => a.type === "stage_suggestion")).toBe(false);
  });

  // ── Multiple alerts can fire together ───────────────────────────────
  it("can produce both temp_high and stall in the same evaluation", () => {
    const base = new Date("2026-03-20T12:00:00Z");
    const readings: BatchAlertContext["readings"] = [];
    for (let i = 0; i < 12; i++) {
      readings.push({
        gravity: 1.02,
        temperature: i === 11 ? 32 : 20,
        source_timestamp: new Date(base.getTime() - (11 - i) * 86400_000).toISOString(),
      });
    }

    const result = evaluateAlerts(ctx({ readings }));
    const types = result.map((a) => a.type);
    expect(types).toContain("temp_high");
    expect(types).toContain("stall");
  });
});
