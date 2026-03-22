import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson, authHeaders } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("authenticated user identity", () => {
  it("returns 401 without auth", async () => {
    const { status } = await fetchJson("/api/v1/batches");
    expect(status).toBe(401);
  });

  it("authenticates with session cookie", async () => {
    const { status, json } = await fetchJson("/api/v1/batches", {
      headers: await authHeaders(),
    });
    expect(status).toBe(200);
    expect(json.items).toBeDefined();
  });
});
