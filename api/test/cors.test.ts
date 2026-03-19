import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { applyMigrations } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("CORS", () => {
  it("preflight returns CORS headers", async () => {
    const res = await SELF.fetch("http://localhost/api/v1/batches", {
      method: "OPTIONS",
      headers: {
        Origin: "https://dashboard.example.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-API-Key,Content-Type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Headers")).toMatch(/X-API-Key/i);
  });

  it("regular response includes CORS headers", async () => {
    const res = await SELF.fetch("http://localhost/health");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("webhook preflight returns CORS headers", async () => {
    const res = await SELF.fetch("http://localhost/webhook/rapt", {
      method: "OPTIONS",
      headers: {
        Origin: "https://dashboard.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "X-Webhook-Token,Content-Type",
      },
    });
    expect(res.status).toBe(204);
  });
});
