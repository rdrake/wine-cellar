import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("health", () => {
  it("returns ok", async () => {
    const { status, json } = await fetchJson("/health");
    expect(status).toBe(200);
    expect(json).toEqual({ status: "ok" });
  });
});
