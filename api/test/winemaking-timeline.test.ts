import { describe, it, expect } from "vitest";
import {
  projectTimeline,
  computeCurrentPhase,
  addDays,
  isPastStage,
  type TimelineContext,
  type CurrentPhaseContext,
} from "../src/lib/winemaking/timeline";

function baseContext(overrides: Partial<TimelineContext> = {}): TimelineContext {
  return {
    stage: "primary_fermentation",
    wineType: "red",
    sourceMaterial: "fresh_grapes",
    mlfStatus: "not_planned",
    startedAt: "2026-01-01",
    velocityPerDay: null,
    latestGravity: null,
    targetGravity: null,
    rackingCount: 0,
    lastRackingAt: null,
    mlfInoculatedAt: null,
    ...overrides,
  };
}

describe("addDays", () => {
  it("adds positive days", () => {
    expect(addDays("2026-01-01", 10)).toBe("2026-01-11");
  });

  it("crosses month boundary", () => {
    expect(addDays("2026-01-25", 10)).toBe("2026-02-04");
  });

  it("handles zero days", () => {
    expect(addDays("2026-03-15", 0)).toBe("2026-03-15");
  });
});

describe("isPastStage", () => {
  it("returns false when at the target stage", () => {
    expect(isPastStage("primary_fermentation", "primary_fermentation")).toBe(
      false,
    );
  });

  it("returns true when past the target", () => {
    expect(isPastStage("secondary_fermentation", "primary_fermentation")).toBe(
      true,
    );
  });

  it("returns false when before the target", () => {
    expect(isPastStage("must_prep", "primary_fermentation")).toBe(false);
  });

  it("returns false for unknown stages", () => {
    expect(isPastStage("unknown", "primary_fermentation")).toBe(false);
  });
});

describe("projectTimeline", () => {
  it("projects end of primary from velocity (estimated confidence)", () => {
    const ctx = baseContext({
      velocityPerDay: -0.010,
      latestGravity: 1.05,
      targetGravity: 0.995,
    });
    const milestones = projectTimeline(ctx);
    const primary = milestones.find(
      (m) => m.label === "End of primary fermentation",
    );
    expect(primary).toBeDefined();
    expect(primary!.confidence).toBe("estimated");
    // remaining = 1.050 - 0.995 = 0.055, velocity = 0.010/day → 6 days from today
    const today = new Date().toISOString().slice(0, 10);
    const expectedDate = new Date(today + "T00:00:00Z");
    expectedDate.setUTCDate(expectedDate.getUTCDate() + 6);
    expect(primary!.estimated_date).toBe(expectedDate.toISOString().slice(0, 10));
    expect(primary!.basis).toContain("velocity");
  });

  it("uses typical duration when no velocity data (rough confidence)", () => {
    const ctx = baseContext({
      wineType: "white",
      sourceMaterial: "fresh_grapes",
    });
    const milestones = projectTimeline(ctx);
    const primary = milestones.find(
      (m) => m.label === "End of primary fermentation",
    );
    expect(primary).toBeDefined();
    expect(primary!.confidence).toBe("rough");
    // 14 days for whites
    expect(primary!.estimated_date).toBe("2026-01-15");
  });

  it("uses 7-day typical primary for reds", () => {
    const ctx = baseContext({ wineType: "red" });
    const milestones = projectTimeline(ctx);
    const primary = milestones.find(
      (m) => m.label === "End of primary fermentation",
    );
    expect(primary!.estimated_date).toBe("2026-01-08");
  });

  it("uses 7-day typical primary for kits", () => {
    const ctx = baseContext({
      wineType: "white",
      sourceMaterial: "kit",
    });
    const milestones = projectTimeline(ctx);
    const primary = milestones.find(
      (m) => m.label === "End of primary fermentation",
    );
    expect(primary!.estimated_date).toBe("2026-01-08");
  });

  it("skips end-of-primary when past primary stage", () => {
    const ctx = baseContext({ stage: "secondary_fermentation" });
    const milestones = projectTimeline(ctx);
    const primary = milestones.find(
      (m) => m.label === "End of primary fermentation",
    );
    expect(primary).toBeUndefined();
  });

  it("projects racking schedule for reds (3 rackings)", () => {
    const ctx = baseContext({ wineType: "red" });
    const milestones = projectTimeline(ctx);
    const rackings = milestones.filter((m) => m.label.includes("racking"));
    expect(rackings.length).toBeGreaterThanOrEqual(2);
    expect(rackings[0].label).toBe("First racking");
    expect(rackings[1].label).toBe("Second racking");
    // First racking is 2 weeks after primary end (day 7 + 14 = day 21)
    expect(rackings[0].estimated_date).toBe("2026-01-22");
  });

  it("projects MLF completion when in_progress", () => {
    const ctx = baseContext({
      mlfStatus: "in_progress",
      mlfInoculatedAt: "2026-01-10",
    });
    const milestones = projectTimeline(ctx);
    const mlf = milestones.find((m) => m.label === "MLF completion");
    expect(mlf).toBeDefined();
    expect(mlf!.confidence).toBe("rough");
    // 42 days after 2026-01-10
    expect(mlf!.estimated_date).toBe("2026-02-21");
  });

  it("skips MLF when not_planned", () => {
    const ctx = baseContext({ mlfStatus: "not_planned" });
    const milestones = projectTimeline(ctx);
    const mlf = milestones.find((m) => m.label === "MLF completion");
    expect(mlf).toBeUndefined();
  });

  it("skips MLF when pending (not yet inoculated)", () => {
    const ctx = baseContext({
      mlfStatus: "pending",
      mlfInoculatedAt: null,
    });
    const milestones = projectTimeline(ctx);
    const mlf = milestones.find((m) => m.label === "MLF completion");
    expect(mlf).toBeUndefined();
  });

  it("marks completed rackings", () => {
    const ctx = baseContext({
      rackingCount: 2,
      lastRackingAt: "2026-02-15",
    });
    const milestones = projectTimeline(ctx);
    const rackings = milestones.filter((m) => m.label.includes("racking"));
    expect(rackings[0].completed).toBe(true);
    expect(rackings[1].completed).toBe(true);
    expect(rackings[2].completed).toBeUndefined();
  });

  it("uses lastRackingAt as anchor when rackings completed", () => {
    const ctx = baseContext({
      rackingCount: 1,
      lastRackingAt: "2026-02-01",
    });
    const milestones = projectTimeline(ctx);
    const first = milestones.find((m) => m.label === "First racking");
    expect(first!.estimated_date).toBe("2026-02-01");
    expect(first!.completed).toBe(true);
  });

  it("projects earliest bottling for kit white", () => {
    const ctx = baseContext({
      wineType: "white",
      sourceMaterial: "kit",
    });
    const milestones = projectTimeline(ctx);
    const bottling = milestones.find((m) => m.label === "Earliest bottling");
    expect(bottling).toBeDefined();
    expect(bottling!.confidence).toBe("rough");
    // Primary: 7 days → Jan 8
    // First racking: +14 → Jan 22
    // Second racking: +75 → Apr 7
    // Third racking: +90 → Jul 6
    // Bottling: +30 (kit) → Aug 5
    expect(bottling!.estimated_date).toBe("2026-08-05");
  });

  it("projects earliest bottling for red with 180-day aging", () => {
    const ctx = baseContext({
      wineType: "red",
      sourceMaterial: "fresh_grapes",
    });
    const milestones = projectTimeline(ctx);
    const bottling = milestones.find((m) => m.label === "Earliest bottling");
    // Primary: 7 → Jan 8
    // First racking: +14 → Jan 22
    // Second: +75 → Apr 7
    // Third: +90 → Jul 6
    // Bottling: +180 → Jan 2, 2027
    expect(bottling!.estimated_date).toBe("2027-01-02");
  });

  it("projects earliest bottling for white with 90-day aging", () => {
    const ctx = baseContext({
      wineType: "white",
      sourceMaterial: "fresh_grapes",
    });
    const milestones = projectTimeline(ctx);
    const bottling = milestones.find((m) => m.label === "Earliest bottling");
    // Primary: 14 → Jan 15
    // First racking: +14 → Jan 29
    // Second: +75 → Apr 14
    // Third: +90 → Jul 13
    // Bottling: +90 → Oct 11
    expect(bottling!.estimated_date).toBe("2026-10-11");
  });
});

describe("computeCurrentPhase", () => {
  it("returns primary fermentation with estimated total days for red", () => {
    const result = computeCurrentPhase({
      stage: "primary_fermentation",
      wineType: "red",
      sourceMaterial: "fresh_grapes",
      stageEnteredAt: "2026-03-17",
      now: "2026-03-22",
    });
    expect(result.label).toBe("Primary Fermentation");
    expect(result.stage).toBe("primary_fermentation");
    expect(result.daysElapsed).toBe(5);
    expect(result.estimatedTotalDays).toBe(7);
  });

  it("returns 14-day estimate for white primary", () => {
    const result = computeCurrentPhase({
      stage: "primary_fermentation",
      wineType: "white",
      sourceMaterial: "fresh_grapes",
      stageEnteredAt: "2026-03-10",
      now: "2026-03-22",
    });
    expect(result.daysElapsed).toBe(12);
    expect(result.estimatedTotalDays).toBe(14);
  });

  it("returns 7-day estimate for kit primary", () => {
    const result = computeCurrentPhase({
      stage: "primary_fermentation",
      wineType: "white",
      sourceMaterial: "kit",
      stageEnteredAt: "2026-03-20",
      now: "2026-03-22",
    });
    expect(result.estimatedTotalDays).toBe(7);
  });

  it("returns null estimatedTotalDays for stabilization (open-ended)", () => {
    const result = computeCurrentPhase({
      stage: "stabilization",
      wineType: "red",
      sourceMaterial: "fresh_grapes",
      stageEnteredAt: "2026-01-01",
      now: "2026-03-22",
    });
    expect(result.label).toBe("Stabilization & Aging");
    expect(result.daysElapsed).toBe(80);
    expect(result.estimatedTotalDays).toBeNull();
  });

  it("returns secondary fermentation with null estimate", () => {
    const result = computeCurrentPhase({
      stage: "secondary_fermentation",
      wineType: "red",
      sourceMaterial: "fresh_grapes",
      stageEnteredAt: "2026-03-10",
      now: "2026-03-22",
    });
    expect(result.label).toBe("Secondary Fermentation");
    expect(result.daysElapsed).toBe(12);
    expect(result.estimatedTotalDays).toBeNull();
  });

  it("falls back to batchStartedAt when stageEnteredAt is null", () => {
    const result = computeCurrentPhase({
      stage: "must_prep",
      wineType: "red",
      sourceMaterial: "fresh_grapes",
      stageEnteredAt: null,
      now: "2026-03-22",
      batchStartedAt: "2026-03-20",
    });
    expect(result.daysElapsed).toBe(2);
  });
});
