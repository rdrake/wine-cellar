import { describe, it, expect } from "vitest";
import {
  calculateDrinkWindow,
  addMonths,
  type CellaringContext,
} from "../src/lib/winemaking/cellaring";

function baseContext(
  overrides: Partial<CellaringContext> = {},
): CellaringContext {
  return {
    wineType: "red",
    sourceMaterial: "fresh_grapes",
    bottledAt: "2026-10-01",
    oakType: "french",
    oakDurationDays: 120,
    mlfStatus: "complete",
    totalSo2Ppm: 50,
    finalPh: 3.4,
    finalGravity: 0.994,
    ...overrides,
  };
}

describe("addMonths", () => {
  it("adds months within the same year", () => {
    expect(addMonths("2026-01-15", 3)).toBe("2026-04-15");
  });

  it("crosses year boundary", () => {
    expect(addMonths("2026-10-01", 6)).toBe("2027-04-01");
  });

  it("handles zero months", () => {
    expect(addMonths("2026-06-01", 0)).toBe("2026-06-01");
  });
});

describe("calculateDrinkWindow", () => {
  it("full red, oaked, MLF complete — long window", () => {
    const ctx = baseContext();
    const result = calculateDrinkWindow(ctx);

    // Base: full red oaked = 12/24/60/120 months
    // Adjustments: MLF complete (1.15), low gravity <0.996 (1.05)
    // Combined factor: 1.15 * 1.05 = 1.2075
    // ready = round(12 * 1.2075) = 14, peak start = round(24 * 1.2075) = 29
    // peak end = round(60 * 1.2075) = 72, past peak = round(120 * 1.2075) = 145
    const pastPeakYear = new Date(result.pastPeakDate + "T00:00:00Z").getUTCFullYear();
    expect(pastPeakYear).toBeGreaterThanOrEqual(2033);
  });

  it("high pH (3.8) produces shorter window than normal (3.4)", () => {
    const normalCtx = baseContext({ finalPh: 3.4 });
    const highPhCtx = baseContext({ finalPh: 3.8 });

    const normal = calculateDrinkWindow(normalCtx);
    const highPh = calculateDrinkWindow(highPhCtx);

    expect(highPh.pastPeakDate < normal.pastPeakDate).toBe(true);
    expect(highPh.peakEnd < normal.peakEnd).toBe(true);
  });

  it("low SO2 (20 ppm) produces shorter window than normal (50 ppm)", () => {
    const normalCtx = baseContext({ totalSo2Ppm: 50 });
    const lowSo2Ctx = baseContext({ totalSo2Ppm: 20 });

    const normal = calculateDrinkWindow(normalCtx);
    const lowSo2 = calculateDrinkWindow(lowSo2Ctx);

    expect(lowSo2.pastPeakDate < normal.pastPeakDate).toBe(true);
    expect(lowSo2.peakEnd < normal.peakEnd).toBe(true);
  });

  it("long oak (365 days) produces longer window than no oak", () => {
    const noOakCtx = baseContext({
      oakType: "none",
      oakDurationDays: 0,
      mlfStatus: "not_planned",
      finalGravity: 1.0,
      totalSo2Ppm: 50,
      finalPh: 3.4,
    });
    const longOakCtx = baseContext({
      oakType: "french",
      oakDurationDays: 365,
      mlfStatus: "not_planned",
      finalGravity: 1.0,
      totalSo2Ppm: 50,
      finalPh: 3.4,
    });

    const noOak = calculateDrinkWindow(noOakCtx);
    const longOak = calculateDrinkWindow(longOakCtx);

    // Long oak: base is oaked red (12/24/60/120) * 1.20
    // No oak: base is light red no oak (6/12/36/60) * 1.0
    expect(longOak.pastPeakDate > noOak.pastPeakDate).toBe(true);
    expect(longOak.peakEnd > noOak.peakEnd).toBe(true);
  });

  it("kit white — short window (past peak < 18 months)", () => {
    const ctx = baseContext({
      wineType: "white",
      sourceMaterial: "kit",
      oakType: "none",
      oakDurationDays: 0,
      mlfStatus: "not_planned",
      totalSo2Ppm: 50,
      finalPh: 3.2,
      finalGravity: 1.0,
      bottledAt: "2026-10-01",
    });

    const result = calculateDrinkWindow(ctx);

    // Base: kit white = 1/3/6/12 months, no adjustments
    // Past peak should be 12 months = 2027-10-01
    const pastPeak = new Date(result.pastPeakDate + "T00:00:00Z");
    const bottled = new Date("2026-10-01T00:00:00Z");
    const monthsDiff =
      (pastPeak.getUTCFullYear() - bottled.getUTCFullYear()) * 12 +
      (pastPeak.getUTCMonth() - bottled.getUTCMonth());
    expect(monthsDiff).toBeLessThan(18);
  });

  it("returns adjustment explanation when pH is high", () => {
    const ctx = baseContext({ finalPh: 3.8 });
    const result = calculateDrinkWindow(ctx);

    expect(result.adjustmentNote).not.toBeNull();
    expect(result.adjustmentNote).toContain("pH");
  });

  it("returns null adjustmentNote when no adjustments apply", () => {
    const ctx = baseContext({
      totalSo2Ppm: 50,
      finalPh: 3.4,
      oakDurationDays: 90,
      mlfStatus: "not_planned",
      finalGravity: 1.0,
      oakType: "french",
    });
    const result = calculateDrinkWindow(ctx);

    expect(result.adjustmentNote).toBeNull();
  });

  it("returns storage note always", () => {
    const ctx = baseContext();
    const result = calculateDrinkWindow(ctx);

    expect(result.storageNote).toBe(
      "Store bottles on their side at 12-16\u00B0C in a dark, vibration-free location.",
    );
  });

  it("adjustment note says 'Shortened' for shortening factors", () => {
    const ctx = baseContext({
      finalPh: 3.8,
      mlfStatus: "not_planned",
      finalGravity: 1.0,
      oakDurationDays: 90,
    });
    const result = calculateDrinkWindow(ctx);

    expect(result.adjustmentNote).toContain("Shortened");
  });

  it("adjustment note says 'Extended' for extending factors", () => {
    const ctx = baseContext({
      oakDurationDays: 365,
      totalSo2Ppm: 50,
      finalPh: 3.4,
      mlfStatus: "not_planned",
      finalGravity: 1.0,
    });
    const result = calculateDrinkWindow(ctx);

    expect(result.adjustmentNote).toContain("Extended");
    expect(result.adjustmentNote).toContain("oak");
  });
});
