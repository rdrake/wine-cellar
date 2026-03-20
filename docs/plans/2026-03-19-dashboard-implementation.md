# Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a mobile-first React SPA for batch management and fermentation monitoring, deployed on Cloudflare Pages as a static site consuming the existing Hono API.

**Architecture:** React SPA in `dashboard/` sibling to `api/`. Vite builds the app. A thin fetch wrapper injects `X-API-Key` from localStorage. Setup screen on first visit stores API URL and key. React Router handles client-side navigation. API is the sole source of truth — no client cache.

**Tech Stack:** React 19, TypeScript, Vite, React Router v7, Recharts, shadcn/ui (Tailwind CSS v4), Vitest + React Testing Library

**Design doc:** `docs/plans/2026-03-19-dashboard-design.md`
**API design doc:** `docs/plans/2026-03-19-mvp-design.md`

---

## Task 0: CORS Middleware (API Prerequisite)

The dashboard runs on Cloudflare Pages (different origin than the API Worker). Cross-origin requests with the `X-API-Key` custom header require CORS preflight support. Hono's built-in `cors()` middleware handles this.

**Files:**
- Modify: `api/src/app.ts`
- Create: `api/test/cors.test.ts`

**Step 1: Write the failing test**

Create `api/test/cors.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/cors.test.ts`
Expected: FAIL — no CORS headers on responses.

**Step 3: Add CORS middleware to `api/src/app.ts`**

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiKeyAuth } from "./middleware/auth";
import batches from "./routes/batches";
import activities from "./routes/activities";
import devices from "./routes/devices";
import webhook from "./routes/webhook";
import { batchReadings, deviceReadings } from "./routes/readings";

export type Bindings = {
  DB: D1Database;
  API_KEY: string;
  WEBHOOK_TOKEN: string;
};

export type App = Hono<{ Bindings: Bindings }>;

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["X-API-Key", "X-Webhook-Token", "Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);
app.use("*", apiKeyAuth);

app.get("/health", (c) => c.json({ status: "ok" }));
app.route("/api/v1/batches", batches);
app.route("/api/v1/batches/:batchId/activities", activities);
app.route("/api/v1/devices", devices);
app.route("/api/v1/batches/:batchId/readings", batchReadings);
app.route("/api/v1/devices/:deviceId/readings", deviceReadings);
app.route("/webhook", webhook);

export default app;
```

**Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run`
Expected: All PASS (existing + new CORS tests).

**Step 5: Commit**

```bash
git add api/src/app.ts api/test/cors.test.ts
git commit -m "feat: add CORS middleware to API for dashboard cross-origin requests"
```

---

## Task 1: Dashboard Project Scaffolding

Set up the Vite + React + TypeScript project with Tailwind CSS v4, shadcn/ui, and testing infrastructure.

**Files:**
- Create: `dashboard/` directory and all scaffolding files
- Create: `dashboard/package.json`
- Create: `dashboard/tsconfig.json`, `dashboard/tsconfig.app.json`
- Create: `dashboard/vite.config.ts`
- Create: `dashboard/vitest.config.ts`
- Create: `dashboard/index.html`
- Create: `dashboard/public/_redirects`
- Create: `dashboard/src/main.tsx`
- Create: `dashboard/src/App.tsx`
- Create: `dashboard/src/index.css`
- Create: `dashboard/src/vite-env.d.ts`

**Step 1: Scaffold Vite project**

Run from repo root:

```bash
npm create vite@latest dashboard -- --template react-ts
```

**Step 2: Install dependencies**

```bash
cd dashboard && npm install react-router-dom recharts && npm install -D tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/react @types/react-dom
```

**Step 3: Configure Tailwind v4 in `dashboard/vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

**Step 4: Update `dashboard/tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

Update `dashboard/tsconfig.app.json` to include path alias:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

**Step 5: Create `dashboard/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

**Step 6: Create `dashboard/src/test-setup.ts`**

```typescript
import "@testing-library/jest-dom/vitest";
```

**Step 7: Initialize shadcn/ui**

```bash
cd dashboard && npx shadcn@latest init --defaults
```

This creates `components.json`, `src/lib/utils.ts`, and adds CSS variables to `src/index.css`.

**Step 8: Add shadcn components**

```bash
cd dashboard && npx shadcn@latest add button card input label select textarea tabs badge dialog sonner
```

**Step 9: Update `dashboard/src/index.css`**

After shadcn init, verify the CSS file starts with `@import "tailwindcss"` and includes the shadcn theme variables. Add a base font-size for mobile:

Append to the end of `dashboard/src/index.css`:

```css
body {
  font-family: system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
}
```

**Step 10: Create `dashboard/public/_redirects`**

```
/* /index.html 200
```

**Step 11: Replace `dashboard/src/App.tsx` with a minimal shell**

```tsx
function App() {
  return <div className="p-4"><h1 className="text-xl font-bold">Wine Cellar</h1></div>;
}

export default App;
```

**Step 12: Replace `dashboard/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**Step 13: Verify build and tests**

Run: `cd dashboard && npm run build`
Expected: Build succeeds.

Run: `cd dashboard && npx vitest run`
Expected: No tests yet, exits cleanly.

**Step 14: Add scripts to `dashboard/package.json`**

Ensure these scripts exist (Vite template provides most, add test):

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

**Step 15: Commit**

```bash
git add dashboard/
git commit -m "feat: scaffold dashboard with Vite, React, Tailwind, shadcn/ui"
```

---

## Task 2: API Client + TypeScript Types

Build the fetch wrapper that injects auth headers, handles errors, and provides typed API methods. Also define TypeScript types matching API responses.

**Files:**
- Create: `dashboard/src/types.ts`
- Create: `dashboard/src/api.ts`
- Create: `dashboard/src/api.test.ts`

**Step 1: Create `dashboard/src/types.ts`**

```typescript
export type WineType = "red" | "white" | "rosé" | "orange" | "sparkling" | "dessert";
export type SourceMaterial = "kit" | "juice_bucket" | "fresh_grapes";

export type BatchStage =
  | "must_prep"
  | "primary_fermentation"
  | "secondary_fermentation"
  | "stabilization"
  | "bottling";

export type BatchStatus = "active" | "completed" | "archived" | "abandoned";

export type AllStage =
  | "receiving" | "crushing" | "must_prep"
  | "primary_fermentation" | "pressing"
  | "secondary_fermentation" | "malolactic"
  | "stabilization" | "fining" | "bulk_aging" | "cold_stabilization" | "filtering"
  | "bottling" | "bottle_aging";

export type ActivityType = "addition" | "racking" | "measurement" | "tasting" | "note" | "adjustment";

export interface Batch {
  id: string;
  name: string;
  wine_type: WineType;
  source_material: SourceMaterial;
  stage: BatchStage;
  status: BatchStatus;
  volume_liters: number | null;
  target_volume_liters: number | null;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  batch_id: string;
  stage: AllStage;
  type: ActivityType;
  title: string;
  details: Record<string, unknown> | null;
  recorded_at: string;
  created_at: string;
  updated_at: string;
}

export interface Reading {
  id: string;
  batch_id: string | null;
  device_id: string;
  gravity: number;
  temperature: number;
  battery: number;
  rssi: number;
  source_timestamp: string;
  created_at: string;
}

export interface Device {
  id: string;
  name: string;
  batch_id: string | null;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListResponse<T> {
  items: T[];
}

export interface PaginatedResponse<T> {
  items: T[];
  next_cursor: string | null;
}

export interface BatchCreate {
  name: string;
  wine_type: WineType;
  source_material: SourceMaterial;
  started_at: string;
  volume_liters?: number | null;
  target_volume_liters?: number | null;
  notes?: string | null;
}

export interface BatchUpdate {
  name?: string;
  notes?: string | null;
  volume_liters?: number | null;
  target_volume_liters?: number | null;
}

export interface ActivityCreate {
  stage: AllStage;
  type: ActivityType;
  title: string;
  details?: Record<string, unknown> | null;
  recorded_at: string;
}

export interface ActivityUpdate {
  title?: string;
  details?: Record<string, unknown> | null;
  recorded_at?: string;
}

// Allowed activity stages per batch waypoint
export const WAYPOINT_ALLOWED_STAGES: Record<BatchStage, AllStage[]> = {
  must_prep: ["receiving", "crushing", "must_prep"],
  primary_fermentation: ["primary_fermentation", "pressing"],
  secondary_fermentation: ["secondary_fermentation", "malolactic"],
  stabilization: ["stabilization", "fining", "bulk_aging", "cold_stabilization", "filtering"],
  bottling: ["bottling", "bottle_aging"],
};

// Display labels
export const STAGE_LABELS: Record<AllStage, string> = {
  receiving: "Receiving & Inspection",
  crushing: "Crushing & Destemming",
  must_prep: "Must Preparation",
  primary_fermentation: "Primary Fermentation",
  pressing: "Pressing",
  secondary_fermentation: "Secondary Fermentation",
  malolactic: "Malolactic Fermentation",
  stabilization: "Stabilization & Degassing",
  fining: "Fining & Clarification",
  bulk_aging: "Bulk Aging",
  cold_stabilization: "Cold Stabilization",
  filtering: "Filtering",
  bottling: "Bottling",
  bottle_aging: "Bottle Aging",
};

export const WINE_TYPE_LABELS: Record<WineType, string> = {
  red: "Red",
  white: "White",
  "rosé": "Rosé",
  orange: "Orange",
  sparkling: "Sparkling",
  dessert: "Dessert",
};

export const SOURCE_MATERIAL_LABELS: Record<SourceMaterial, string> = {
  kit: "Kit",
  juice_bucket: "Juice Bucket",
  fresh_grapes: "Fresh Grapes",
};

export const STATUS_LABELS: Record<BatchStatus, string> = {
  active: "Active",
  completed: "Completed",
  archived: "Archived",
  abandoned: "Abandoned",
};

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  addition: "Addition",
  racking: "Racking",
  measurement: "Measurement",
  tasting: "Tasting",
  note: "Note",
  adjustment: "Adjustment",
};
```

**Step 2: Write failing test for API client**

Create `dashboard/src/api.test.ts`:

```typescript
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
    const batch = { name: "Test", wine_type: "red", source_material: "kit", started_at: "2026-01-01T00:00:00Z" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: "123", ...batch }),
    });
    await api.batches.create(batch as any);
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
```

**Step 3: Run test to verify it fails**

Run: `cd dashboard && npx vitest run src/api.test.ts`
Expected: FAIL — module `./api` does not exist.

**Step 4: Create `dashboard/src/api.ts`**

```typescript
import type {
  Batch, BatchCreate, BatchUpdate,
  Activity, ActivityCreate, ActivityUpdate,
  Reading, Device,
  ListResponse, PaginatedResponse,
} from "./types";

const STORAGE_KEY_URL = "wine-cellar-api-url";
const STORAGE_KEY_KEY = "wine-cellar-api-key";

export function getApiConfig(): { url: string | null; key: string | null } {
  return {
    url: localStorage.getItem(STORAGE_KEY_URL),
    key: localStorage.getItem(STORAGE_KEY_KEY),
  };
}

export function setApiConfig(url: string, key: string): void {
  localStorage.setItem(STORAGE_KEY_URL, url.replace(/\/$/, ""));
  localStorage.setItem(STORAGE_KEY_KEY, key);
}

export function clearApiConfig(): void {
  localStorage.removeItem(STORAGE_KEY_URL);
  localStorage.removeItem(STORAGE_KEY_KEY);
}

export function isConfigured(): boolean {
  const { url, key } = getApiConfig();
  return !!url && !!key;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error?: string; message?: string; detail?: unknown },
  ) {
    super(body.message ?? `API error ${status}`);
    this.name = "ApiError";
  }
}

function qs(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries).toString();
}

async function apiFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { url, key } = getApiConfig();
  if (!url || !key) throw new Error("API not configured");

  const { method = "GET", body } = options;
  const headers = new Headers();
  headers.set("X-API-Key", key);
  if (body !== undefined) headers.set("Content-Type", "application/json");

  const res = await fetch(`${url}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    // Only clear the key, not the URL — user can re-enter key on the setup screen
    localStorage.removeItem("wine-cellar-api-key");
    throw new ApiError(401, { error: "unauthorized", message: "Invalid or missing API key" });
  }

  if (res.status === 204) return undefined as T;

  const json = await res.json();
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

export const api = {
  batches: {
    list: (params?: { status?: string; stage?: string; wine_type?: string }) =>
      apiFetch<ListResponse<Batch>>("/api/v1/batches" + qs(params)),
    get: (id: string) =>
      apiFetch<Batch>(`/api/v1/batches/${id}`),
    create: (data: BatchCreate) =>
      apiFetch<Batch>("/api/v1/batches", { method: "POST", body: data }),
    update: (id: string, data: BatchUpdate) =>
      apiFetch<Batch>(`/api/v1/batches/${id}`, { method: "PATCH", body: data }),
    delete: (id: string) =>
      apiFetch<void>(`/api/v1/batches/${id}`, { method: "DELETE" }),
    advance: (id: string) =>
      apiFetch<Batch>(`/api/v1/batches/${id}/advance`, { method: "POST" }),
    complete: (id: string) =>
      apiFetch<Batch>(`/api/v1/batches/${id}/complete`, { method: "POST" }),
    abandon: (id: string) =>
      apiFetch<Batch>(`/api/v1/batches/${id}/abandon`, { method: "POST" }),
    archive: (id: string) =>
      apiFetch<Batch>(`/api/v1/batches/${id}/archive`, { method: "POST" }),
    unarchive: (id: string) =>
      apiFetch<Batch>(`/api/v1/batches/${id}/unarchive`, { method: "POST" }),
  },
  activities: {
    list: (batchId: string, params?: { type?: string; stage?: string }) =>
      apiFetch<ListResponse<Activity>>(`/api/v1/batches/${batchId}/activities` + qs(params)),
    create: (batchId: string, data: ActivityCreate) =>
      apiFetch<Activity>(`/api/v1/batches/${batchId}/activities`, { method: "POST", body: data }),
    update: (batchId: string, activityId: string, data: ActivityUpdate) =>
      apiFetch<Activity>(`/api/v1/batches/${batchId}/activities/${activityId}`, { method: "PATCH", body: data }),
    delete: (batchId: string, activityId: string) =>
      apiFetch<void>(`/api/v1/batches/${batchId}/activities/${activityId}`, { method: "DELETE" }),
  },
  readings: {
    listByBatch: (batchId: string, params?: { limit?: string; cursor?: string }) =>
      apiFetch<PaginatedResponse<Reading>>(`/api/v1/batches/${batchId}/readings` + qs(params)),
    listByDevice: (deviceId: string, params?: { limit?: string; cursor?: string }) =>
      apiFetch<PaginatedResponse<Reading>>(`/api/v1/devices/${deviceId}/readings` + qs(params)),
  },
  devices: {
    list: () =>
      apiFetch<ListResponse<Device>>("/api/v1/devices"),
    create: (data: { id: string; name: string }) =>
      apiFetch<Device>("/api/v1/devices", { method: "POST", body: data }),
    assign: (deviceId: string, batchId: string) =>
      apiFetch<Device>(`/api/v1/devices/${deviceId}/assign`, { method: "POST", body: { batch_id: batchId } }),
    unassign: (deviceId: string) =>
      apiFetch<Device>(`/api/v1/devices/${deviceId}/unassign`, { method: "POST" }),
  },
  health: () => apiFetch<{ status: string }>("/health"),
};
```

**Step 5: Run tests to verify they pass**

Run: `cd dashboard && npx vitest run src/api.test.ts`
Expected: All PASS.

**Step 6: Commit**

```bash
git add dashboard/src/types.ts dashboard/src/api.ts dashboard/src/api.test.ts
git commit -m "feat: add API client module with typed methods and config management"
```

---

## Task 3: Setup Screen + Auth Guard

The Setup screen asks for API URL and key on first visit. An auth guard component redirects to Setup when unconfigured. On 401, the API client clears config so the guard catches it on next render.

**Files:**
- Create: `dashboard/src/pages/Setup.tsx`
- Create: `dashboard/src/components/AuthGuard.tsx`
- Create: `dashboard/src/hooks/useFetch.ts`

**Step 1: Create `dashboard/src/hooks/useFetch.ts`**

The design doc specifies a single `useFetch` hook as the only custom hook.

```typescript
import { useState, useEffect, useCallback } from "react";

export function useFetch<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fn());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setError(msg);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refetch: load };
}
```

**Step 2: Create `dashboard/src/pages/Setup.tsx`**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { setApiConfig, clearApiConfig, api } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Setup() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setTesting(true);

    // Save config temporarily to test connection with an authenticated endpoint
    setApiConfig(url, key);
    try {
      await api.batches.list();
      navigate("/");
    } catch {
      clearApiConfig();
      setError("Could not connect. Check the URL and API key.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Wine Cellar</CardTitle>
          <CardDescription>Connect to your Wine Cellar API</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="url">API URL</Label>
              <Input
                id="url"
                type="url"
                placeholder="https://wine-cellar-api.workers.dev"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="key">API Key</Label>
              <Input
                id="key"
                type="password"
                placeholder="Your API key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={testing}>
              {testing ? "Testing..." : "Connect"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 3: Create `dashboard/src/components/AuthGuard.tsx`**

```tsx
import { Navigate, Outlet } from "react-router-dom";
import { isConfigured } from "@/api";

export default function AuthGuard() {
  if (!isConfigured()) {
    return <Navigate to="/setup" replace />;
  }
  return <Outlet />;
}
```

**Step 4: Commit**

```bash
git add dashboard/src/pages/Setup.tsx dashboard/src/components/AuthGuard.tsx dashboard/src/hooks/useFetch.ts
git commit -m "feat: add Setup screen, AuthGuard, and useFetch hook"
```

---

## Task 4: App Shell — Router + BottomNav + Layout

Set up React Router with all routes, a fixed bottom navigation bar, and the root layout.

**Files:**
- Modify: `dashboard/src/App.tsx`
- Create: `dashboard/src/components/BottomNav.tsx`
- Create: `dashboard/src/components/Layout.tsx`
- Create placeholder pages for all routes

**Step 1: Create `dashboard/src/components/BottomNav.tsx`**

```tsx
import { NavLink } from "react-router-dom";

const tabs = [
  { to: "/", label: "Batches", icon: "🍷" },
  { to: "/devices", label: "Devices", icon: "📡" },
  { to: "/tools", label: "Tools", icon: "🔧" },
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background border-t z-50">
      <div className="flex justify-around max-w-lg mx-auto">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `flex flex-col items-center py-3 px-6 text-xs min-w-[72px] transition-colors ${
                isActive ? "text-primary font-medium" : "text-muted-foreground"
              }`
            }
          >
            <span className="text-xl mb-0.5">{tab.icon}</span>
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
```

**Step 2: Create `dashboard/src/components/Layout.tsx`**

```tsx
import { Outlet, useNavigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { clearApiConfig } from "@/api";
import BottomNav from "./BottomNav";

export default function Layout() {
  const navigate = useNavigate();

  function handleReset() {
    clearApiConfig();
    navigate("/setup");
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="flex justify-end p-2">
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleReset}>
          Reset
        </Button>
      </header>
      <Outlet />
      <BottomNav />
      <Toaster position="top-center" />
    </div>
  );
}
```

**Step 3: Create placeholder pages**

Create each file with a minimal placeholder:

`dashboard/src/pages/BatchList.tsx`:
```tsx
export default function BatchList() {
  return <div className="p-4"><h1 className="text-xl font-bold">Batches</h1></div>;
}
```

`dashboard/src/pages/BatchDetail.tsx`:
```tsx
export default function BatchDetail() {
  return <div className="p-4"><h1 className="text-xl font-bold">Batch Detail</h1></div>;
}
```

`dashboard/src/pages/BatchNew.tsx`:
```tsx
export default function BatchNew() {
  return <div className="p-4"><h1 className="text-xl font-bold">New Batch</h1></div>;
}
```

`dashboard/src/pages/BatchEdit.tsx`:
```tsx
export default function BatchEdit() {
  return <div className="p-4"><h1 className="text-xl font-bold">Edit Batch</h1></div>;
}
```

`dashboard/src/pages/ActivityNew.tsx`:
```tsx
export default function ActivityNew() {
  return <div className="p-4"><h1 className="text-xl font-bold">Log Activity</h1></div>;
}
```

`dashboard/src/pages/Devices.tsx`:
```tsx
export default function Devices() {
  return <div className="p-4"><h1 className="text-xl font-bold">Devices</h1></div>;
}
```

`dashboard/src/pages/Tools.tsx`:
```tsx
export default function Tools() {
  return (
    <div className="p-4">
      <h1 className="text-xl font-bold">Tools</h1>
      <p className="text-muted-foreground mt-2">Coming soon: SG calibration calculators, solution mix recipes, and more.</p>
    </div>
  );
}
```

**Step 4: Update `dashboard/src/App.tsx` with full routing**

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import AuthGuard from "@/components/AuthGuard";
import Layout from "@/components/Layout";
import Setup from "@/pages/Setup";
import BatchList from "@/pages/BatchList";
import BatchDetail from "@/pages/BatchDetail";
import BatchNew from "@/pages/BatchNew";
import BatchEdit from "@/pages/BatchEdit";
import ActivityNew from "@/pages/ActivityNew";
import Devices from "@/pages/Devices";
import Tools from "@/pages/Tools";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route element={<AuthGuard />}>
          <Route element={<Layout />}>
            <Route path="/" element={<BatchList />} />
            <Route path="/batches/new" element={<BatchNew />} />
            <Route path="/batches/:id" element={<BatchDetail />} />
            <Route path="/batches/:id/edit" element={<BatchEdit />} />
            <Route path="/batches/:id/activities/new" element={<ActivityNew />} />
            <Route path="/devices" element={<Devices />} />
            <Route path="/tools" element={<Tools />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

**Step 5: Verify build**

Run: `cd dashboard && npm run build`
Expected: Build succeeds.

**Step 6: Commit**

```bash
git add dashboard/src/
git commit -m "feat: add app shell with React Router, BottomNav, and route placeholders"
```

---

## Task 5: Batch List Page

Implement the default screen with status tabs (Active, Completed, Abandoned, Archived), batch cards, and a floating action button to create a new batch.

**Files:**
- Modify: `dashboard/src/pages/BatchList.tsx`
- Create: `dashboard/src/components/BatchCard.tsx`

**Step 1: Create `dashboard/src/components/BatchCard.tsx`**

```tsx
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Batch } from "@/types";
import { STAGE_LABELS, WINE_TYPE_LABELS, STATUS_LABELS } from "@/types";

export default function BatchCard({ batch }: { batch: Batch }) {
  return (
    <Link to={`/batches/${batch.id}`}>
      <Card className="active:bg-accent transition-colors">
        <CardContent className="p-4">
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold truncate">{batch.name}</h3>
              <p className="text-sm text-muted-foreground">{WINE_TYPE_LABELS[batch.wine_type]}</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Badge variant="outline" className="text-xs">
                {STATUS_LABELS[batch.status]}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {STAGE_LABELS[batch.stage]}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

**Step 2: Implement `dashboard/src/pages/BatchList.tsx`**

```tsx
import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import BatchCard from "@/components/BatchCard";
import type { BatchStatus } from "@/types";

const STATUS_TABS: { value: BatchStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "abandoned", label: "Abandoned" },
  { value: "archived", label: "Archived" },
];

export default function BatchList() {
  const [status, setStatus] = useState<BatchStatus>("active");
  const { data, loading, error, refetch } = useFetch(
    useCallback(() => api.batches.list({ status }), [status]),
    [status],
  );

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-4">Batches</h1>

      <Tabs value={status} onValueChange={(v) => setStatus(v as BatchStatus)}>
        <TabsList className="w-full">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex-1">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-4 space-y-3">
        {loading && <p className="text-muted-foreground text-sm">Loading...</p>}
        {error && (
          <div className="text-sm text-destructive">
            {error}
            <Button variant="link" size="sm" onClick={refetch}>Retry</Button>
          </div>
        )}
        {data && data.items.length === 0 && (
          <p className="text-muted-foreground text-sm py-8 text-center">
            {status === "active"
              ? "No batches yet. Tap + to start your first batch."
              : `No ${status} batches.`}
          </p>
        )}
        {data?.items.map((batch) => (
          <BatchCard key={batch.id} batch={batch} />
        ))}
      </div>

      <Link to="/batches/new">
        <Button
          size="lg"
          className="fixed bottom-24 right-4 rounded-full w-14 h-14 text-2xl shadow-lg z-40"
        >
          +
        </Button>
      </Link>
    </div>
  );
}
```

**Step 3: Verify build**

Run: `cd dashboard && npm run build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add dashboard/src/pages/BatchList.tsx dashboard/src/components/BatchCard.tsx
git commit -m "feat: add Batch List page with status tabs and FAB"
```

---

## Task 6: Batch Form + New/Edit Pages

Build a shared batch form component used by both the New Batch and Edit Batch pages.

**Files:**
- Create: `dashboard/src/components/BatchForm.tsx`
- Modify: `dashboard/src/pages/BatchNew.tsx`
- Modify: `dashboard/src/pages/BatchEdit.tsx`

**Step 1: Create `dashboard/src/components/BatchForm.tsx`**

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WineType, SourceMaterial } from "@/types";
import { WINE_TYPE_LABELS, SOURCE_MATERIAL_LABELS } from "@/types";

const WINE_TYPES = Object.entries(WINE_TYPE_LABELS) as [WineType, string][];
const SOURCE_MATERIALS = Object.entries(SOURCE_MATERIAL_LABELS) as [SourceMaterial, string][];

export interface BatchFormData {
  name: string;
  wine_type: WineType;
  source_material: SourceMaterial;
  started_at: string;
  volume_liters: string;
  target_volume_liters: string;
  notes: string;
}

interface Props {
  initial?: Partial<BatchFormData>;
  /** Hide fields that aren't editable on existing batches */
  editMode?: boolean;
  onSubmit: (data: BatchFormData) => Promise<void>;
  submitLabel: string;
}

export default function BatchForm({ initial, editMode, onSubmit, submitLabel }: Props) {
  const [form, setForm] = useState<BatchFormData>({
    name: initial?.name ?? "",
    wine_type: initial?.wine_type ?? "red",
    source_material: initial?.source_material ?? "kit",
    started_at: initial?.started_at ?? new Date().toISOString().slice(0, 16),
    volume_liters: initial?.volume_liters ?? "",
    target_volume_liters: initial?.target_volume_liters ?? "",
    notes: initial?.notes ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof BatchFormData>(key: K, value: BatchFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
      </div>

      {!editMode && (
        <>
          <div className="space-y-2">
            <Label htmlFor="wine_type">Wine Type</Label>
            <Select value={form.wine_type} onValueChange={(v) => set("wine_type", v as WineType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {WINE_TYPES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="source_material">Source Material</Label>
            <Select value={form.source_material} onValueChange={(v) => set("source_material", v as SourceMaterial)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOURCE_MATERIALS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="started_at">Start Date</Label>
            <Input
              id="started_at"
              type="datetime-local"
              value={form.started_at}
              onChange={(e) => set("started_at", e.target.value)}
              required
            />
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="volume">Volume (L)</Label>
          <Input
            id="volume"
            type="number"
            step="0.1"
            value={form.volume_liters}
            onChange={(e) => set("volume_liters", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="target_volume">Target Vol (L)</Label>
          <Input
            id="target_volume"
            type="number"
            step="0.1"
            value={form.target_volume_liters}
            onChange={(e) => set("target_volume_liters", e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
```

**Step 2: Implement `dashboard/src/pages/BatchNew.tsx`**

```tsx
import { useNavigate } from "react-router-dom";
import { api } from "@/api";
import BatchForm from "@/components/BatchForm";
import type { BatchFormData } from "@/components/BatchForm";

export default function BatchNew() {
  const navigate = useNavigate();

  async function handleSubmit(data: BatchFormData) {
    const batch = await api.batches.create({
      name: data.name,
      wine_type: data.wine_type,
      source_material: data.source_material,
      started_at: new Date(data.started_at).toISOString(),
      volume_liters: data.volume_liters ? parseFloat(data.volume_liters) : null,
      target_volume_liters: data.target_volume_liters ? parseFloat(data.target_volume_liters) : null,
      notes: data.notes || null,
    });
    navigate(`/batches/${batch.id}`);
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-4">New Batch</h1>
      <BatchForm onSubmit={handleSubmit} submitLabel="Create Batch" />
    </div>
  );
}
```

**Step 3: Implement `dashboard/src/pages/BatchEdit.tsx`**

```tsx
import { useParams, useNavigate } from "react-router-dom";
import { useCallback } from "react";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
import BatchForm from "@/components/BatchForm";
import type { BatchFormData } from "@/components/BatchForm";

export default function BatchEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: batch, loading, error, refetch } = useFetch(
    useCallback(() => api.batches.get(id!), [id]),
    [id],
  );

  async function handleSubmit(data: BatchFormData) {
    await api.batches.update(id!, {
      name: data.name,
      volume_liters: data.volume_liters ? parseFloat(data.volume_liters) : null,
      target_volume_liters: data.target_volume_liters ? parseFloat(data.target_volume_liters) : null,
      notes: data.notes || null,
    });
    navigate(`/batches/${id}`);
  }

  if (loading) return <div className="p-4"><p className="text-muted-foreground">Loading...</p></div>;
  if (error || !batch) return (
    <div className="p-4">
      <p className="text-destructive">{error ?? "Batch not found"}</p>
      <Button variant="link" size="sm" onClick={refetch}>Retry</Button>
    </div>
  );

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-4">Edit Batch</h1>
      <BatchForm
        initial={{
          name: batch.name,
          volume_liters: batch.volume_liters?.toString() ?? "",
          target_volume_liters: batch.target_volume_liters?.toString() ?? "",
          notes: batch.notes ?? "",
        }}
        editMode
        onSubmit={handleSubmit}
        submitLabel="Save Changes"
      />
    </div>
  );
}
```

**Step 4: Verify build**

Run: `cd dashboard && npm run build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add dashboard/src/components/BatchForm.tsx dashboard/src/pages/BatchNew.tsx dashboard/src/pages/BatchEdit.tsx
git commit -m "feat: add BatchForm component with New Batch and Edit Batch pages"
```

---

## Task 7: Batch Detail — Header + Lifecycle Actions

Build the batch detail page header showing metadata, edit button, and lifecycle action buttons (Advance, Complete, Abandon, Archive/Unarchive). Destructive actions require confirmation via a dialog.

**Files:**
- Modify: `dashboard/src/pages/BatchDetail.tsx`

**Step 1: Implement `dashboard/src/pages/BatchDetail.tsx`**

```tsx
import { useParams, Link } from "react-router-dom";
import { useState, useCallback } from "react";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Batch } from "@/types";
import { STAGE_LABELS, WINE_TYPE_LABELS, SOURCE_MATERIAL_LABELS, STATUS_LABELS } from "@/types";
import ActivitySection from "@/components/ActivitySection";
import ReadingsChart from "@/components/ReadingsChart";
import DeviceSection from "@/components/DeviceSection";

function LifecycleActions({ batch, onAction }: { batch: Batch; onAction: () => void }) {
  const [confirmAction, setConfirmAction] = useState<{ label: string; action: () => Promise<void> } | null>(null);
  const [acting, setActing] = useState(false);

  async function doAction(label: string, action: () => Promise<Batch>) {
    setActing(true);
    try {
      await action();
      toast.success(label);
      onAction();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActing(false);
      setConfirmAction(null);
    }
  }

  function confirm(label: string, action: () => Promise<Batch>) {
    setConfirmAction({ label, action: () => doAction(label, action) });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {batch.status === "active" && (
          <>
            <Button size="sm" onClick={() => doAction("Stage advanced", () => api.batches.advance(batch.id))}>
              Advance Stage
            </Button>
            <Button size="sm" variant="outline" onClick={() => doAction("Batch completed", () => api.batches.complete(batch.id))}>
              Complete
            </Button>
            <Button size="sm" variant="destructive" onClick={() => confirm("Abandon batch?", () => api.batches.abandon(batch.id))}>
              Abandon
            </Button>
          </>
        )}
        {batch.status === "completed" && (
          <Button size="sm" variant="outline" onClick={() => doAction("Batch archived", () => api.batches.archive(batch.id))}>
            Archive
          </Button>
        )}
        {batch.status === "archived" && (
          <Button size="sm" variant="outline" onClick={() => doAction("Batch unarchived", () => api.batches.unarchive(batch.id))}>
            Unarchive
          </Button>
        )}
      </div>

      <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmAction?.label}</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button variant="destructive" disabled={acting} onClick={confirmAction?.action}>
              {acting ? "..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function BatchDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: batch, loading, error, refetch } = useFetch(
    useCallback(() => api.batches.get(id!), [id]),
    [id],
  );

  return (
    <div className="p-4 max-w-lg mx-auto space-y-6">
      {/* Header — shows loading/error state */}
      {loading && <p className="text-muted-foreground">Loading...</p>}
      {error && (
        <div className="text-destructive">
          {error}
          <Button variant="link" size="sm" onClick={refetch}>Retry</Button>
        </div>
      )}

      {batch && (
        <>
          <div>
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-xl font-bold">{batch.name}</h1>
                <p className="text-sm text-muted-foreground">
                  {WINE_TYPE_LABELS[batch.wine_type]} &middot; {SOURCE_MATERIAL_LABELS[batch.source_material]}
                </p>
              </div>
              <div className="flex gap-2 items-center">
                <Badge>{STATUS_LABELS[batch.status]}</Badge>
                <Link to={`/batches/${id}/edit`}>
                  <Button size="sm" variant="ghost">Edit</Button>
                </Link>
              </div>
            </div>

            <Card className="mt-3">
              <CardContent className="p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stage</span>
                  <span>{STAGE_LABELS[batch.stage]}</span>
                </div>
                {batch.volume_liters && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Volume</span>
                    <span>{batch.volume_liters} L</span>
                  </div>
                )}
                {batch.target_volume_liters && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Target</span>
                    <span>{batch.target_volume_liters} L</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Started</span>
                  <span>{new Date(batch.started_at).toLocaleDateString()}</span>
                </div>
                {batch.notes && <p className="pt-2 text-muted-foreground">{batch.notes}</p>}
              </CardContent>
            </Card>
          </div>

          {/* Lifecycle Actions */}
          <LifecycleActions batch={batch} onAction={refetch} />
        </>
      )}

      {/* These sections mount immediately and fetch in parallel with the batch */}
      <ActivitySection batchId={id!} batchStatus={batch?.status ?? "active"} />
      <ReadingsChart batchId={id!} />
      <DeviceSection batchId={id!} batchStatus={batch?.status ?? "active"} onAssignmentChange={refetch} />
    </div>
  );
}
```

Note: This references `ActivitySection`, `ReadingsChart`, and `DeviceSection` which will be created in subsequent tasks. Create placeholder stubs for now so the build succeeds.

**Step 2: Create placeholder stubs**

`dashboard/src/components/ActivitySection.tsx`:
```tsx
export default function ActivitySection({ batchId: _batchId, batchStatus: _batchStatus }: { batchId: string; batchStatus: string }) {
  return <section><h2 className="font-semibold mb-2">Activities</h2><p className="text-sm text-muted-foreground">Loading...</p></section>;
}
```

`dashboard/src/components/ReadingsChart.tsx`:
```tsx
export default function ReadingsChart({ batchId: _batchId }: { batchId: string }) {
  return <section><h2 className="font-semibold mb-2">Readings</h2><p className="text-sm text-muted-foreground">Loading...</p></section>;
}
```

`dashboard/src/components/DeviceSection.tsx`:
```tsx
export default function DeviceSection({ batchId: _batchId, batchStatus: _batchStatus, onAssignmentChange: _onAssignmentChange }: { batchId: string; batchStatus: string; onAssignmentChange: () => void }) {
  return <section><h2 className="font-semibold mb-2">Device</h2><p className="text-sm text-muted-foreground">Loading...</p></section>;
}
```

**Step 3: Verify build**

Run: `cd dashboard && npm run build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add dashboard/src/pages/BatchDetail.tsx dashboard/src/components/ActivitySection.tsx dashboard/src/components/ReadingsChart.tsx dashboard/src/components/DeviceSection.tsx
git commit -m "feat: add Batch Detail page with lifecycle actions and confirmation dialog"
```

---

## Task 8: Activities Section + Activity Item

Replace the ActivitySection stub with the real implementation: a list of activities (newest first) with edit/delete actions, plus a button to log a new activity.

**Files:**
- Modify: `dashboard/src/components/ActivitySection.tsx`
- Create: `dashboard/src/components/ActivityItem.tsx`

**Step 1: Create `dashboard/src/components/ActivityItem.tsx`**

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Activity } from "@/types";
import { STAGE_LABELS, ACTIVITY_TYPE_LABELS } from "@/types";

interface Props {
  activity: Activity;
  onEdit: (activity: Activity) => void;
  onDelete: (id: string) => void;
}

export default function ActivityItem({ activity, onEdit, onDelete }: Props) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <p className="font-medium text-sm">{activity.title}</p>
            <p className="text-xs text-muted-foreground">
              {ACTIVITY_TYPE_LABELS[activity.type]} &middot; {STAGE_LABELS[activity.stage]}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(activity.recorded_at).toLocaleString()}
            </p>
            {activity.details && Object.keys(activity.details).length > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                {Object.entries(activity.details).map(([k, v]) => (
                  <span key={k} className="mr-2">{k}: {String(v)}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => onEdit(activity)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => onDelete(activity.id)}
            >
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

**Step 2: Implement `dashboard/src/components/ActivitySection.tsx`**

```tsx
import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Activity } from "@/types";
import ActivityItem from "./ActivityItem";

interface Props {
  batchId: string;
  batchStatus: string;
}

export default function ActivitySection({ batchId, batchStatus }: Props) {
  const { data, loading, error, refetch } = useFetch(
    useCallback(() => api.activities.list(batchId), [batchId]),
    [batchId],
  );
  const [editing, setEditing] = useState<Activity | null>(null);

  async function handleDelete(activityId: string) {
    try {
      await api.activities.delete(batchId, activityId);
      toast.success("Activity deleted");
      refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <section>
      <div className="flex justify-between items-center mb-2">
        <h2 className="font-semibold">Activities</h2>
        {batchStatus === "active" && (
          <Link to={`/batches/${batchId}/activities/new`}>
            <Button size="sm" variant="outline">+ Log</Button>
          </Link>
        )}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && data.items.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No activities logged. Tap + Log to record your first activity.
        </p>
      )}
      <div className="space-y-2">
        {data?.items.map((activity) => (
          <ActivityItem
            key={activity.id}
            activity={activity}
            onEdit={setEditing}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {editing && (
        <EditActivityDialog
          batchId={batchId}
          activity={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refetch(); }}
        />
      )}
    </section>
  );
}

function EditActivityDialog({ batchId, activity, onClose, onSaved }: {
  batchId: string;
  activity: Activity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(activity.title);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await api.activities.update(batchId, activity.id, { title });
      toast.success("Activity updated");
      onSaved();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Activity</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !title} onClick={handleSave}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 3: Verify build**

Run: `cd dashboard && npm run build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add dashboard/src/components/ActivitySection.tsx dashboard/src/components/ActivityItem.tsx
git commit -m "feat: add ActivitySection with ActivityItem list and delete action"
```

---

## Task 9: Log Activity Page

Build the activity logging form with dynamic detail fields based on activity type. Stage options are filtered by the batch's current waypoint.

**Files:**
- Modify: `dashboard/src/pages/ActivityNew.tsx`

**Step 1: Implement `dashboard/src/pages/ActivityNew.tsx`**

```tsx
import { useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AllStage, ActivityType, BatchStage } from "@/types";
import { WAYPOINT_ALLOWED_STAGES, STAGE_LABELS, ACTIVITY_TYPE_LABELS } from "@/types";

const ACTIVITY_TYPES: ActivityType[] = ["addition", "measurement", "racking", "tasting", "adjustment", "note"];

function DetailFields({ type, details, onChange }: {
  type: ActivityType;
  details: Record<string, string>;
  onChange: (details: Record<string, string>) => void;
}) {
  function set(key: string, value: string) {
    onChange({ ...details, [key]: value });
  }

  switch (type) {
    case "addition":
      return (
        <>
          <div className="space-y-2">
            <Label>Chemical</Label>
            <Input value={details.chemical ?? ""} onChange={(e) => set("chemical", e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" step="0.01" value={details.amount ?? ""} onChange={(e) => set("amount", e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Input value={details.unit ?? ""} placeholder="tsp, g, mL" onChange={(e) => set("unit", e.target.value)} required />
            </div>
          </div>
        </>
      );
    case "measurement":
      return (
        <>
          <div className="space-y-2">
            <Label>Metric</Label>
            <Input value={details.metric ?? ""} placeholder="pH, TA, SO2" onChange={(e) => set("metric", e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Value</Label>
              <Input type="number" step="0.01" value={details.value ?? ""} onChange={(e) => set("value", e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Input value={details.unit ?? ""} onChange={(e) => set("unit", e.target.value)} required />
            </div>
          </div>
        </>
      );
    case "racking":
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>From Vessel</Label>
            <Input value={details.from_vessel ?? ""} onChange={(e) => set("from_vessel", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>To Vessel</Label>
            <Input value={details.to_vessel ?? ""} onChange={(e) => set("to_vessel", e.target.value)} required />
          </div>
        </div>
      );
    case "tasting":
      return (
        <>
          <div className="space-y-2">
            <Label>Aroma</Label>
            <Input value={details.aroma ?? ""} onChange={(e) => set("aroma", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Flavor</Label>
            <Input value={details.flavor ?? ""} onChange={(e) => set("flavor", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Appearance</Label>
            <Input value={details.appearance ?? ""} onChange={(e) => set("appearance", e.target.value)} required />
          </div>
        </>
      );
    case "adjustment":
      return (
        <>
          <div className="space-y-2">
            <Label>Parameter</Label>
            <Input value={details.parameter ?? ""} onChange={(e) => set("parameter", e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>From Value</Label>
              <Input type="number" step="0.01" value={details.from_value ?? ""} onChange={(e) => set("from_value", e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>To Value</Label>
              <Input type="number" step="0.01" value={details.to_value ?? ""} onChange={(e) => set("to_value", e.target.value)} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Unit</Label>
            <Input value={details.unit ?? ""} onChange={(e) => set("unit", e.target.value)} required />
          </div>
        </>
      );
    case "note":
      return null;
  }
}

export default function ActivityNew() {
  const { id: batchId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: batch, loading: batchLoading, error: batchError, refetch: refetchBatch } = useFetch(
    useCallback(() => api.batches.get(batchId!), [batchId]),
    [batchId],
  );

  const [stage, setStage] = useState<AllStage | "">("");
  const [type, setType] = useState<ActivityType>("note");
  const [title, setTitle] = useState("");
  const [recordedAt, setRecordedAt] = useState(new Date().toISOString().slice(0, 16));
  const [details, setDetails] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (batchLoading) return <div className="p-4"><p className="text-muted-foreground">Loading...</p></div>;
  if (batchError || !batch) return (
    <div className="p-4">
      <p className="text-destructive">{batchError ?? "Batch not found"}</p>
      <Button variant="link" size="sm" onClick={refetchBatch}>Retry</Button>
    </div>
  );

  const allowedStages = WAYPOINT_ALLOWED_STAGES[batch.stage as BatchStage] ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stage) return;
    setSubmitting(true);
    setError(null);

    // Convert numeric string values to numbers in details
    const parsedDetails: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(details)) {
      if (v === "") continue;
      const num = Number(v);
      parsedDetails[k] = isNaN(num) ? v : num;
    }

    try {
      await api.activities.create(batchId!, {
        stage: stage as AllStage,
        type,
        title,
        details: Object.keys(parsedDetails).length > 0 ? parsedDetails : null,
        recorded_at: new Date(recordedAt).toISOString(),
      });
      navigate(`/batches/${batchId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-4">Log Activity</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label>Stage</Label>
          <Select value={stage} onValueChange={(v) => setStage(v as AllStage)}>
            <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
            <SelectContent>
              {allowedStages.map((s) => (
                <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => { setType(v as ActivityType); setDetails({}); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACTIVITY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{ACTIVITY_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>

        <div className="space-y-2">
          <Label>Recorded At</Label>
          <Input
            type="datetime-local"
            value={recordedAt}
            onChange={(e) => setRecordedAt(e.target.value)}
            required
          />
        </div>

        <DetailFields type={type} details={details} onChange={setDetails} />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" className="w-full" disabled={submitting || !stage}>
          {submitting ? "Saving..." : "Log Activity"}
        </Button>
      </form>
    </div>
  );
}
```

**Step 2: Verify build**

Run: `cd dashboard && npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add dashboard/src/pages/ActivityNew.tsx
git commit -m "feat: add Log Activity page with dynamic detail fields per type"
```

---

## Task 10: Readings Chart

Replace the ReadingsChart stub with a dual-axis Recharts line chart plotting gravity (left axis) and temperature (right axis) over time. Fetches up to 500 readings.

**Files:**
- Modify: `dashboard/src/components/ReadingsChart.tsx`

**Step 1: Implement `dashboard/src/components/ReadingsChart.tsx`**

```tsx
import { useCallback } from "react";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface Props {
  batchId: string;
}

export default function ReadingsChart({ batchId }: Props) {
  const { data, loading, error } = useFetch(
    useCallback(() => api.readings.listByBatch(batchId, { limit: "500" }), [batchId]),
    [batchId],
  );

  const readings = data?.items.slice().reverse() ?? [];

  return (
    <section>
      <h2 className="font-semibold mb-2">Readings</h2>

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && readings.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No telemetry data yet. Assign a RAPT Pill to start tracking.
        </p>
      )}

      {readings.length > 0 && (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={readings} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="source_timestamp"
                tick={{ fontSize: 10 }}
                tickFormatter={(v: string) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              />
              <YAxis
                yAxisId="gravity"
                domain={["auto", "auto"]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v: number) => v.toFixed(3)}
                label={{ value: "SG", angle: -90, position: "insideLeft", style: { fontSize: 10 } }}
              />
              <YAxis
                yAxisId="temperature"
                orientation="right"
                domain={["auto", "auto"]}
                tick={{ fontSize: 10 }}
                label={{ value: "\u00B0C", angle: 90, position: "insideRight", style: { fontSize: 10 } }}
              />
              <Tooltip
                labelFormatter={(v: string) => new Date(v).toLocaleString()}
                formatter={(value: number, name: string) =>
                  name === "gravity" ? [value.toFixed(4), "Gravity"] : [`${value.toFixed(1)}\u00B0C`, "Temp"]
                }
              />
              <Line
                yAxisId="gravity"
                type="monotone"
                dataKey="gravity"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
              <Line
                yAxisId="temperature"
                type="monotone"
                dataKey="temperature"
                stroke="hsl(var(--destructive))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
```

**Step 2: Verify build**

Run: `cd dashboard && npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add dashboard/src/components/ReadingsChart.tsx
git commit -m "feat: add dual-axis Recharts readings chart for gravity and temperature"
```

---

## Task 11: Devices Page + Device Section

Build the Devices list page (showing all devices with assignment status, assign/unassign actions) and the DeviceSection component for the batch detail page.

**Files:**
- Modify: `dashboard/src/pages/Devices.tsx`
- Modify: `dashboard/src/components/DeviceSection.tsx`

**Step 1: Implement `dashboard/src/pages/Devices.tsx`**

```tsx
import { useState, useCallback } from "react";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { Device, Batch } from "@/types";

export default function Devices() {
  const { data: devicesData, loading, error, refetch } = useFetch(
    useCallback(() => api.devices.list(), []),
    [],
  );
  const { data: batchesData } = useFetch(
    useCallback(() => api.batches.list(), []),
    [],
  );

  const [assignDialog, setAssignDialog] = useState<Device | null>(null);

  // Build a lookup map for batch names
  const batchNames = new Map<string, string>();
  batchesData?.items.forEach((b) => batchNames.set(b.id, b.name));

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-4">Devices</h1>

      {loading && <p className="text-muted-foreground text-sm">Loading...</p>}
      {error && <p className="text-destructive text-sm">{error}</p>}

      {devicesData && devicesData.items.length === 0 && (
        <p className="text-muted-foreground text-sm py-8 text-center">
          No devices registered. Devices appear automatically when your RAPT Pill sends its first reading.
        </p>
      )}

      <div className="space-y-3">
        {devicesData?.items.map((device) => (
          <Card key={device.id}>
            <CardContent className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">{device.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{device.id}</p>
                  {device.batch_id && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Batch: {batchNames.get(device.batch_id) ?? device.batch_id}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {device.batch_id ? (
                    <>
                      <Badge variant="secondary">Assigned</Badge>
                      <Button size="sm" variant="outline" onClick={async () => {
                        try {
                          await api.devices.unassign(device.id);
                          toast.success("Device unassigned");
                          refetch();
                        } catch (e: unknown) {
                          toast.error(e instanceof Error ? e.message : "Unassign failed");
                        }
                      }}>
                        Unassign
                      </Button>
                    </>
                  ) : (
                    <>
                      <Badge variant="outline">Unassigned</Badge>
                      <Button size="sm" variant="outline" onClick={() => setAssignDialog(device)}>
                        Assign
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {assignDialog && (
        <AssignDialog
          device={assignDialog}
          onClose={() => setAssignDialog(null)}
          onAssigned={() => { setAssignDialog(null); refetch(); }}
        />
      )}
    </div>
  );
}

function AssignDialog({ device, onClose, onAssigned }: { device: Device; onClose: () => void; onAssigned: () => void }) {
  const { data: batchesData } = useFetch(
    useCallback(() => api.batches.list({ status: "active" }), []),
    [],
  );
  const [selectedBatch, setSelectedBatch] = useState("");
  const [assigning, setAssigning] = useState(false);

  async function handleAssign() {
    if (!selectedBatch) return;
    setAssigning(true);
    try {
      await api.devices.assign(device.id, selectedBatch);
      toast.success("Device assigned");
      onAssigned();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setAssigning(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign {device.name}</DialogTitle>
        </DialogHeader>
        <Select value={selectedBatch} onValueChange={setSelectedBatch}>
          <SelectTrigger><SelectValue placeholder="Select an active batch" /></SelectTrigger>
          <SelectContent>
            {batchesData?.items.map((b: Batch) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!selectedBatch || assigning} onClick={handleAssign}>
            {assigning ? "Assigning..." : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Implement `dashboard/src/components/DeviceSection.tsx`**

```tsx
import { useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Props {
  batchId: string;
  batchStatus: string;
  onAssignmentChange: () => void;
}

export default function DeviceSection({ batchId, batchStatus, onAssignmentChange }: Props) {
  const { data, loading, refetch } = useFetch(
    useCallback(() => api.devices.list(), [batchStatus]),
    [batchStatus],
  );

  const assignedDevices = data?.items.filter((d) => d.batch_id === batchId) ?? [];

  async function handleUnassign(deviceId: string) {
    try {
      await api.devices.unassign(deviceId);
      toast.success("Device unassigned");
      refetch();
      onAssignmentChange();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to unassign");
    }
  }

  return (
    <section>
      <h2 className="font-semibold mb-2">Devices</h2>

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!loading && assignedDevices.length > 0 && (
        <div className="space-y-2">
          {assignedDevices.map((device) => (
            <div key={device.id} className="flex items-center justify-between p-3 rounded-lg border">
              <div>
                <p className="font-medium text-sm">{device.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{device.id}</p>
              </div>
              {batchStatus === "active" && (
                <Button size="sm" variant="outline" onClick={() => handleUnassign(device.id)}>Unassign</Button>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && assignedDevices.length === 0 && (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground mb-2">No device assigned</p>
          {batchStatus === "active" && (
            <Link to="/devices">
              <Button size="sm" variant="outline">Assign Device</Button>
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
```

**Step 3: Verify build**

Run: `cd dashboard && npm run build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add dashboard/src/pages/Devices.tsx dashboard/src/components/DeviceSection.tsx
git commit -m "feat: add Devices page with assign/unassign and DeviceSection for batch detail"
```

---

## Post-Implementation Checklist

After all tasks are complete, verify:

1. **Full build:** `cd dashboard && npm run build` succeeds
2. **API tests still pass:** `cd api && npx vitest run` (CORS changes should not break existing tests)
3. **Dashboard tests pass:** `cd dashboard && npx vitest run`
4. **Manual smoke test:** Run `cd dashboard && npm run dev` and `cd api && npm run dev` side by side. Walk through:
   - Setup screen stores URL and key
   - Batch list loads with status tabs
   - Create a new batch
   - View batch detail with lifecycle actions
   - Log an activity with detail fields
   - View readings chart (if device data exists)
   - Devices page shows registered devices
   - 401 redirects to setup screen
