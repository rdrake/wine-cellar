import { describe, it, expect } from "vitest";
import {
  generateNudges,
  type NudgeContext,
} from "../src/lib/winemaking/nudges";

function makeContext(overrides: Partial<NudgeContext> = {}): NudgeContext {
  return {
    stage: "must_prep",
    wineType: "red",
    sourceMaterial: "fresh_grapes",
    volumeLiters: 23,
    mlfStatus: null,
    latestGravity: null,
    latestTemp: null,
    totalSo2Additions: 0,
    ...overrides,
  };
}

function findNudge(nudges: ReturnType<typeof generateNudges>, id: string) {
  return nudges.find((n) => n.id === id) ?? null;
}

describe("winemaking nudges", () => {
  describe("so2-crushing", () => {
    it("shows SO2 nudge at must_prep for fresh grapes with no SO2", () => {
      const nudges = generateNudges(
        makeContext({ stage: "must_prep", sourceMaterial: "fresh_grapes", totalSo2Additions: 0, volumeLiters: 23 })
      );
      const nudge = findNudge(nudges, "so2-crushing");
      expect(nudge).not.toBeNull();
      expect(nudge!.priority).toBe("action");
      expect(nudge!.message).toContain("1.7g");
      expect(nudge!.message).toContain("23L");
      expect(nudge!.detail).toContain("24 hours");
    });

    it("does not show SO2 nudge for kits", () => {
      const nudges = generateNudges(
        makeContext({ sourceMaterial: "kit" })
      );
      expect(findNudge(nudges, "so2-crushing")).toBeNull();
    });

    it("does not show SO2 nudge if SO2 already added", () => {
      const nudges = generateNudges(
        makeContext({ totalSo2Additions: 1 })
      );
      expect(findNudge(nudges, "so2-crushing")).toBeNull();
    });
  });

  describe("initial-measurements", () => {
    it("shows measurement reminder at must_prep", () => {
      const nudges = generateNudges(makeContext({ stage: "must_prep" }));
      const nudge = findNudge(nudges, "initial-measurements");
      expect(nudge).not.toBeNull();
      expect(nudge!.priority).toBe("info");
      expect(nudge!.message).toContain("Brix");
    });

    it("does not show measurement reminder at other stages", () => {
      const nudges = generateNudges(makeContext({ stage: "primary_fermentation" }));
      expect(findNudge(nudges, "initial-measurements")).toBeNull();
    });
  });

  describe("punch-down", () => {
    it("shows punch-down for red in primary fermentation", () => {
      const nudges = generateNudges(
        makeContext({ stage: "primary_fermentation", wineType: "red" })
      );
      const nudge = findNudge(nudges, "punch-down");
      expect(nudge).not.toBeNull();
      expect(nudge!.priority).toBe("info");
      expect(nudge!.message).toContain("Punch down");
    });

    it("shows punch-down for ros\u00e9 in primary fermentation", () => {
      const nudges = generateNudges(
        makeContext({ stage: "primary_fermentation", wineType: "ros\u00e9" })
      );
      expect(findNudge(nudges, "punch-down")).not.toBeNull();
    });

    it("does not show punch-down for white", () => {
      const nudges = generateNudges(
        makeContext({ stage: "primary_fermentation", wineType: "white" })
      );
      expect(findNudge(nudges, "punch-down")).toBeNull();
    });
  });

  describe("temp-high-primary", () => {
    it("warns when temperature is >= 29", () => {
      const nudges = generateNudges(
        makeContext({ stage: "primary_fermentation", latestTemp: 30 })
      );
      const nudge = findNudge(nudges, "temp-high-primary");
      expect(nudge).not.toBeNull();
      expect(nudge!.priority).toBe("warning");
      expect(nudge!.message).toContain("30");
    });

    it("warns at exactly 29", () => {
      const nudges = generateNudges(
        makeContext({ stage: "primary_fermentation", latestTemp: 29 })
      );
      expect(findNudge(nudges, "temp-high-primary")).not.toBeNull();
    });

    it("does not warn when temperature is below 29", () => {
      const nudges = generateNudges(
        makeContext({ stage: "primary_fermentation", latestTemp: 28 })
      );
      expect(findNudge(nudges, "temp-high-primary")).toBeNull();
    });
  });

  describe("consider-pressing", () => {
    it("suggests pressing when SG <= 1.020 for red", () => {
      const nudges = generateNudges(
        makeContext({ stage: "primary_fermentation", wineType: "red", latestGravity: 1.015 })
      );
      const nudge = findNudge(nudges, "consider-pressing");
      expect(nudge).not.toBeNull();
      expect(nudge!.priority).toBe("action");
      expect(nudge!.message).toContain("pressing");
    });

    it("suggests pressing at exactly 1.020", () => {
      const nudges = generateNudges(
        makeContext({ stage: "primary_fermentation", wineType: "red", latestGravity: 1.02 })
      );
      expect(findNudge(nudges, "consider-pressing")).not.toBeNull();
    });

    it("does not suggest pressing when SG > 1.020", () => {
      const nudges = generateNudges(
        makeContext({ stage: "primary_fermentation", wineType: "red", latestGravity: 1.05 })
      );
      expect(findNudge(nudges, "consider-pressing")).toBeNull();
    });

    it("includes skin contact guidance in detail for red", () => {
      const nudges = generateNudges(
        makeContext({ stage: "primary_fermentation", wineType: "red", latestGravity: 1.015 })
      );
      const nudge = findNudge(nudges, "consider-pressing");
      expect(nudge).not.toBeNull();
      expect(nudge!.detail).toBeDefined();
      expect(nudge!.detail).toContain("skin contact");
    });
  });

  describe("consider-pressing-rose", () => {
    it("suggests pressing for rosé during primary fermentation", () => {
      const nudges = generateNudges(
        makeContext({ stage: "primary_fermentation", wineType: "rosé" })
      );
      const nudge = findNudge(nudges, "consider-pressing-rose");
      expect(nudge).not.toBeNull();
      expect(nudge!.priority).toBe("info");
      expect(nudge!.message).toContain("6–24 hours");
    });

    it("does not show rosé pressing nudge for red wine", () => {
      const nudges = generateNudges(
        makeContext({ stage: "primary_fermentation", wineType: "red" })
      );
      expect(findNudge(nudges, "consider-pressing-rose")).toBeNull();
    });

    it("does not show rosé pressing nudge outside primary fermentation", () => {
      const nudges = generateNudges(
        makeContext({ stage: "secondary_fermentation", wineType: "rosé" })
      );
      expect(findNudge(nudges, "consider-pressing-rose")).toBeNull();
    });
  });

  describe("mlf-suggestion", () => {
    it("suggests MLF for red in secondary with null mlfStatus", () => {
      const nudges = generateNudges(
        makeContext({ stage: "secondary_fermentation", wineType: "red", mlfStatus: null })
      );
      const nudge = findNudge(nudges, "mlf-suggestion");
      expect(nudge).not.toBeNull();
      expect(nudge!.priority).toBe("info");
      expect(nudge!.message).toContain("MLF");
    });

    it("suggests MLF for orange wine with pending mlfStatus", () => {
      const nudges = generateNudges(
        makeContext({ stage: "secondary_fermentation", wineType: "orange", mlfStatus: "pending" })
      );
      expect(findNudge(nudges, "mlf-suggestion")).not.toBeNull();
    });

    it("does not suggest MLF when in_progress", () => {
      const nudges = generateNudges(
        makeContext({ stage: "secondary_fermentation", wineType: "red", mlfStatus: "in_progress" })
      );
      expect(findNudge(nudges, "mlf-suggestion")).toBeNull();
    });

    it("does not suggest MLF when complete", () => {
      const nudges = generateNudges(
        makeContext({ stage: "secondary_fermentation", wineType: "red", mlfStatus: "complete" })
      );
      expect(findNudge(nudges, "mlf-suggestion")).toBeNull();
    });

    it("does not suggest MLF when not_planned", () => {
      const nudges = generateNudges(
        makeContext({ stage: "secondary_fermentation", wineType: "red", mlfStatus: "not_planned" })
      );
      expect(findNudge(nudges, "mlf-suggestion")).toBeNull();
    });

    it("does not suggest MLF for white wine", () => {
      const nudges = generateNudges(
        makeContext({ stage: "secondary_fermentation", wineType: "white", mlfStatus: null })
      );
      expect(findNudge(nudges, "mlf-suggestion")).toBeNull();
    });
  });

  describe("so2-mlf-warning", () => {
    it("warns when MLF is in progress during secondary fermentation", () => {
      const nudges = generateNudges(
        makeContext({ stage: "secondary_fermentation", wineType: "red", mlfStatus: "in_progress" })
      );
      const nudge = findNudge(nudges, "so2-mlf-warning");
      expect(nudge).not.toBeNull();
      expect(nudge!.priority).toBe("warning");
      expect(nudge!.message).toContain("SO2");
      expect(nudge!.message).toContain("MLF");
    });

    it("warns when MLF is in progress during stabilization", () => {
      const nudges = generateNudges(
        makeContext({ stage: "stabilization", wineType: "red", mlfStatus: "in_progress" })
      );
      expect(findNudge(nudges, "so2-mlf-warning")).not.toBeNull();
    });

    it("does not warn when MLF is complete", () => {
      const nudges = generateNudges(
        makeContext({ stage: "secondary_fermentation", wineType: "red", mlfStatus: "complete" })
      );
      expect(findNudge(nudges, "so2-mlf-warning")).toBeNull();
    });

    it("does not warn when MLF is not planned", () => {
      const nudges = generateNudges(
        makeContext({ stage: "secondary_fermentation", wineType: "red", mlfStatus: "not_planned" })
      );
      expect(findNudge(nudges, "so2-mlf-warning")).toBeNull();
    });

    it("does not warn when mlfStatus is null", () => {
      const nudges = generateNudges(
        makeContext({ stage: "secondary_fermentation", wineType: "red", mlfStatus: null })
      );
      expect(findNudge(nudges, "so2-mlf-warning")).toBeNull();
    });
  });

  describe("so2-racking", () => {
    it("shows SO2 nudge at stabilization", () => {
      const nudges = generateNudges(
        makeContext({ stage: "stabilization" })
      );
      const nudge = findNudge(nudges, "so2-racking");
      expect(nudge).not.toBeNull();
      expect(nudge!.priority).toBe("action");
      expect(nudge!.message).toContain("SO2");
    });
  });

  describe("bottling-checklist", () => {
    it("shows bottling checklist at bottling stage", () => {
      const nudges = generateNudges(
        makeContext({ stage: "bottling" })
      );
      const nudge = findNudge(nudges, "bottling-checklist");
      expect(nudge).not.toBeNull();
      expect(nudge!.priority).toBe("action");
      expect(nudge!.message).toContain("SG below 0.998");
      expect(nudge!.message).toContain("SO2");
    });
  });

  describe("stage isolation", () => {
    it("only returns nudges relevant to the current stage", () => {
      const nudges = generateNudges(
        makeContext({ stage: "bottling" })
      );
      for (const nudge of nudges) {
        expect(nudge.stage).toBe("bottling");
      }
    });
  });
});
