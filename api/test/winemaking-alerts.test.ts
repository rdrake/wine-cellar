import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  evaluateTimelineAlerts,
  type TimelineAlertContext,
} from "../src/lib/winemaking/alerts";

function makeContext(overrides: Partial<TimelineAlertContext> = {}): TimelineAlertContext {
  return {
    batchName: "Cab Sav 2025",
    rackingCount: 0,
    lastRackingAt: null,
    daysSinceLastSo2: null,
    daysSinceLastRacking: null,
    mlfStatus: null,
    mlfInoculatedAt: null,
    stage: "secondary_fermentation",
    estimatedRackingDates: [],
    estimatedBottlingDate: null,
    ...overrides,
  };
}

// Fix "today" so date comparisons are deterministic
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-21T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("evaluateTimelineAlerts", () => {
  // ── Racking due ───────────────────────────────────────────────────

  it("fires racking_due_1 when date has passed and rackingCount is 0", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({
        estimatedRackingDates: ["2026-03-15", "2026-06-01", "2026-09-01"],
        rackingCount: 0,
      }),
    );
    const racking1 = alerts.find((a) => a.type === "racking_due_1");
    expect(racking1).toBeDefined();
    expect(racking1!.context.message).toContain("First racking is due");
    expect(racking1!.context.message).toContain("Cab Sav 2025");
  });

  it("does NOT fire racking_due_1 when already racked once", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({
        estimatedRackingDates: ["2026-03-15", "2026-06-01", "2026-09-01"],
        rackingCount: 1,
        lastRackingAt: "2026-03-14",
      }),
    );
    expect(alerts.find((a) => a.type === "racking_due_1")).toBeUndefined();
  });

  it("fires racking_due_2 when second racking date passed and only 1 racking done", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({
        estimatedRackingDates: ["2026-01-01", "2026-03-10", "2026-09-01"],
        rackingCount: 1,
        lastRackingAt: "2026-01-01",
      }),
    );
    expect(alerts.find((a) => a.type === "racking_due_1")).toBeUndefined();
    const racking2 = alerts.find((a) => a.type === "racking_due_2");
    expect(racking2).toBeDefined();
    expect(racking2!.context.message).toContain("Second racking");
  });

  it("does NOT fire racking_due when date is in the future", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({
        estimatedRackingDates: ["2026-06-01"],
        rackingCount: 0,
      }),
    );
    expect(alerts.find((a) => a.type === "racking_due_1")).toBeUndefined();
  });

  // ── SO2 due ───────────────────────────────────────────────────────

  it("fires so2_due when 42+ days since last SO2", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({ daysSinceLastSo2: 42 }),
    );
    const so2 = alerts.find((a) => a.type === "so2_due");
    expect(so2).toBeDefined();
    expect(so2!.context.message).toContain("SO2 addition");
  });

  it("does NOT fire so2_due when only 30 days since last SO2", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({ daysSinceLastSo2: 30 }),
    );
    expect(alerts.find((a) => a.type === "so2_due")).toBeUndefined();
  });

  it("fires so2_due when racked recently without SO2 after", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({
        daysSinceLastRacking: 2,
        daysSinceLastSo2: null, // never added SO2
      }),
    );
    const so2 = alerts.find((a) => a.type === "so2_due");
    expect(so2).toBeDefined();
  });

  it("fires so2_due when racked recently and last SO2 was before racking", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({
        daysSinceLastRacking: 1,
        daysSinceLastSo2: 10, // SO2 was 10 days ago, racking 1 day ago
      }),
    );
    const so2 = alerts.find((a) => a.type === "so2_due");
    expect(so2).toBeDefined();
  });

  it("does NOT fire so2_due when racked recently but SO2 was added after", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({
        daysSinceLastRacking: 3,
        daysSinceLastSo2: 1, // SO2 added after racking
      }),
    );
    expect(alerts.find((a) => a.type === "so2_due")).toBeUndefined();
  });

  // ── MLF check ─────────────────────────────────────────────────────

  it("fires mlf_check 28+ days after inoculation", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({
        mlfStatus: "in_progress",
        mlfInoculatedAt: "2026-02-15", // ~34 days ago on 2026-03-21
      }),
    );
    const mlf = alerts.find((a) => a.type === "mlf_check");
    expect(mlf).toBeDefined();
    expect(mlf!.context.message).toContain("Check MLF progress");
    expect(mlf!.context.message).toContain("malic acid");
  });

  it("does NOT fire mlf_check if fewer than 28 days", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({
        mlfStatus: "in_progress",
        mlfInoculatedAt: "2026-03-10", // only 11 days ago
      }),
    );
    expect(alerts.find((a) => a.type === "mlf_check")).toBeUndefined();
  });

  it("does NOT fire mlf_check if mlf is not in_progress", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({
        mlfStatus: "complete",
        mlfInoculatedAt: "2026-01-01",
      }),
    );
    expect(alerts.find((a) => a.type === "mlf_check")).toBeUndefined();
  });

  // ── Bottling ready ────────────────────────────────────────────────

  it("fires bottling_ready when date passed and 3 rackings done", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({
        estimatedBottlingDate: "2026-03-01",
        rackingCount: 3,
      }),
    );
    const bottling = alerts.find((a) => a.type === "bottling_ready");
    expect(bottling).toBeDefined();
    expect(bottling!.context.message).toContain("earliest bottling window");
  });

  it("does NOT fire bottling_ready when fewer than 3 rackings", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({
        estimatedBottlingDate: "2026-03-01",
        rackingCount: 2,
      }),
    );
    expect(alerts.find((a) => a.type === "bottling_ready")).toBeUndefined();
  });

  it("does NOT fire bottling_ready when date is in the future", () => {
    const alerts = evaluateTimelineAlerts(
      makeContext({
        estimatedBottlingDate: "2026-12-01",
        rackingCount: 3,
      }),
    );
    expect(alerts.find((a) => a.type === "bottling_ready")).toBeUndefined();
  });

  // ── No alerts when nothing applies ────────────────────────────────

  it("returns empty array when no conditions are met", () => {
    const alerts = evaluateTimelineAlerts(makeContext());
    expect(alerts).toEqual([]);
  });
});
