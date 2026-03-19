import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson, API_HEADERS } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("auth", () => {
  it("health requires no auth", async () => {
    const { status } = await fetchJson("/health");
    expect(status).toBe(200);
  });

  it("api requires auth", async () => {
    const { status, json } = await fetchJson("/api/v1/batches");
    expect(status).toBe(401);
    expect(json.error).toBe("unauthorized");
  });

  it("api accepts valid auth", async () => {
    const { status } = await fetchJson("/api/v1/batches", {
      headers: API_HEADERS,
    });
    // Should not be 401 (will be 404 or 200 once routes exist)
    expect(status).not.toBe(401);
  });

  it("api rejects invalid auth", async () => {
    const { status } = await fetchJson("/api/v1/batches", {
      headers: { "X-API-Key": "wrong-key" },
    });
    expect(status).toBe(401);
  });
});
