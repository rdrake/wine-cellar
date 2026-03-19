import { describe, it, expect, vi, beforeEach } from "vitest";

// Must mock before importing api module
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock localStorage
const store: Record<string, string> = {};
const mockStorage = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
};
vi.stubGlobal("localStorage", mockStorage);

import { getApiConfig, setApiConfig, clearApiConfig, isConfigured, api, ApiError } from "./api";

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(store).forEach((k) => delete store[k]);
});

describe("config", () => {
  it("setApiConfig stores url and key", () => {
    setApiConfig("https://api.example.com", "my-key");
    expect(mockStorage.setItem).toHaveBeenCalledWith("wine-cellar-api-url", "https://api.example.com");
    expect(mockStorage.setItem).toHaveBeenCalledWith("wine-cellar-api-key", "my-key");
  });

  it("getApiConfig reads from storage", () => {
    store["wine-cellar-api-url"] = "https://api.example.com";
    store["wine-cellar-api-key"] = "my-key";
    expect(getApiConfig()).toEqual({ url: "https://api.example.com", key: "my-key" });
  });

  it("clearApiConfig removes both keys", () => {
    clearApiConfig();
    expect(mockStorage.removeItem).toHaveBeenCalledWith("wine-cellar-api-url");
    expect(mockStorage.removeItem).toHaveBeenCalledWith("wine-cellar-api-key");
  });

  it("isConfigured returns true when both set", () => {
    store["wine-cellar-api-url"] = "https://api.example.com";
    store["wine-cellar-api-key"] = "key";
    expect(isConfigured()).toBe(true);
  });

  it("isConfigured returns false when missing", () => {
    expect(isConfigured()).toBe(false);
  });
});

describe("api.batches", () => {
  beforeEach(() => {
    store["wine-cellar-api-url"] = "https://api.example.com";
    store["wine-cellar-api-key"] = "test-key";
  });

  it("list sends GET with auth header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    });
    const result = await api.batches.list();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/batches",
      expect.objectContaining({ method: "GET" }),
    );
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.get("X-API-Key")).toBe("test-key");
    expect(result.items).toEqual([]);
  });

  it("list passes status filter as query param", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    });
    await api.batches.list({ status: "active" });
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.example.com/api/v1/batches?status=active");
  });

  it("create sends POST with body", async () => {
    const batch = { name: "Test", wine_type: "red" as const, source_material: "kit" as const, started_at: "2026-01-01T00:00:00Z" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: "123", ...batch }),
    });
    await api.batches.create(batch);
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(batch);
  });

  it("throws ApiError on error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "not_found", message: "Batch not found" }),
    });
    await expect(api.batches.get("missing")).rejects.toThrow(ApiError);
  });
});
