import type {
  Batch, BatchCreate, BatchUpdate, BatchStatus, BatchStage, WineType,
  Activity, ActivityCreate, ActivityUpdate, ActivityType, AllStage,
  Reading, Device, Alert,
  ListResponse, PaginatedResponse, DashboardResponse,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error?: string; message?: string; detail?: unknown },
  ) {
    super(body.message ?? `API error ${status}`);
    this.name = "ApiError";
  }
}

function qs(params?: Record<string, string | number | undefined>): string {
  if (!params) return "";
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, String(v)] as [string, string]);
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries).toString();
}

async function apiFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { method = "GET", body } = options;
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // 401 means Access session expired — reload triggers Access login
  if (res.status === 401) {
    window.location.reload();
    throw new ApiError(401, { error: "unauthorized", message: "Session expired" });
  }

  if (res.status === 204) return undefined as T;

  const json = await res.json();
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

export const api = {
  batches: {
    list: (params?: { status?: BatchStatus; stage?: BatchStage; wine_type?: WineType }) =>
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
    setStage: (id: string, stage: string) =>
      apiFetch<Batch>(`/api/v1/batches/${id}/stage`, { method: "POST", body: { stage } }),
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
    list: (batchId: string, params?: { type?: ActivityType; stage?: AllStage }) =>
      apiFetch<ListResponse<Activity>>(`/api/v1/batches/${batchId}/activities` + qs(params)),
    create: (batchId: string, data: ActivityCreate) =>
      apiFetch<Activity>(`/api/v1/batches/${batchId}/activities`, { method: "POST", body: data }),
    update: (batchId: string, activityId: string, data: ActivityUpdate) =>
      apiFetch<Activity>(`/api/v1/batches/${batchId}/activities/${activityId}`, { method: "PATCH", body: data }),
    delete: (batchId: string, activityId: string) =>
      apiFetch<void>(`/api/v1/batches/${batchId}/activities/${activityId}`, { method: "DELETE" }),
  },
  readings: {
    listByBatch: (batchId: string, params?: { limit?: number; cursor?: string }) =>
      apiFetch<PaginatedResponse<Reading>>(`/api/v1/batches/${batchId}/readings` + qs(params)),
    listByDevice: (deviceId: string, params?: { limit?: number; cursor?: string }) =>
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
    claim: (deviceId: string) =>
      apiFetch<Device>("/api/v1/devices/claim", { method: "POST", body: { device_id: deviceId } }),
  },
  alerts: {
    dismiss: (alertId: string) =>
      apiFetch<{ status: string }>(`/api/v1/alerts/${alertId}/dismiss`, { method: "POST" }),
  },
  push: {
    vapidKey: () => apiFetch<{ key: string }>("/api/v1/push/vapid-key"),
    subscribe: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
      apiFetch<{ status: string }>("/api/v1/push/subscribe", { method: "POST", body: subscription }),
    unsubscribe: (endpoint: string) =>
      apiFetch<{ status: string }>("/api/v1/push/subscribe", { method: "DELETE", body: { endpoint } }),
  },
  dashboard: () => apiFetch<DashboardResponse>("/api/v1/dashboard"),
  health: () => apiFetch<{ status: string }>("/health"),
  me: () => apiFetch<{ id: string; email: string; name: string | null }>("/api/v1/me"),
};
