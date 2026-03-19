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
