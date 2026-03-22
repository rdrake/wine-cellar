import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations } from "./helpers";
import {
  ALL_STAGES,
  BATCH_STAGES,
  WAYPOINT_ALLOWED_STAGES,
  WAYPOINT_ORDER,
  OAK_TYPES,
  OAK_FORMATS,
  MLF_STATUSES,
} from "../src/schema";

beforeEach(async () => {
  await applyMigrations();
});

describe("schema", () => {
  it("migration creates all tables", async () => {
    const result = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all();
    const tables = new Set(result.results.map((r: any) => r.name));
    expect(tables).toContain("batches");
    expect(tables).toContain("activities");
    expect(tables).toContain("readings");
    expect(tables).toContain("devices");
  });

  it("waypoint stages are subset of all stages", () => {
    for (const [, stages] of Object.entries(WAYPOINT_ALLOWED_STAGES)) {
      for (const stage of stages) {
        expect(ALL_STAGES).toContain(stage);
      }
    }
  });

  it("all stages covered by waypoints", () => {
    const covered = new Set(Object.values(WAYPOINT_ALLOWED_STAGES).flat());
    expect(covered).toEqual(new Set(ALL_STAGES));
  });

  it("waypoint order matches batch stages", () => {
    expect([...WAYPOINT_ORDER]).toEqual([...BATCH_STAGES]);
  });

  it("exports OAK_TYPES", () => {
    expect(OAK_TYPES).toContain("none");
    expect(OAK_TYPES).toContain("french");
    expect(OAK_TYPES).toContain("american");
    expect(OAK_TYPES).toContain("hungarian");
  });

  it("exports OAK_FORMATS", () => {
    expect(OAK_FORMATS).toContain("barrel");
    expect(OAK_FORMATS).toContain("chips");
    expect(OAK_FORMATS).toContain("cubes");
    expect(OAK_FORMATS).toContain("staves");
    expect(OAK_FORMATS).toContain("spiral");
  });

  it("exports MLF_STATUSES", () => {
    expect(MLF_STATUSES).toContain("not_planned");
    expect(MLF_STATUSES).toContain("pending");
    expect(MLF_STATUSES).toContain("in_progress");
    expect(MLF_STATUSES).toContain("complete");
  });
});
