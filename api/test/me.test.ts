import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson, authHeaders, TEST_USER_EMAIL } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("GET /api/v1/me", () => {
  it("returns current user", async () => {
    const { status, json } = await fetchJson("/api/v1/me", {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    expect(json.email).toBe(TEST_USER_EMAIL);
    expect(json.id).toBeDefined();
  });

  it("returns 401 without auth", async () => {
    const { status } = await fetchJson("/api/v1/me");
    expect(status).toBe(401);
  });
});
