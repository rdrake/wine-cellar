import type {
  Batch, BatchCreate, BatchUpdate, BatchStatus, BatchStage, WineType,
  Activity, ActivityCreate, ActivityUpdate, ActivityType, AllStage,
  Reading, Device, Passkey,
  ListResponse, PaginatedResponse, DashboardResponse,
} from "./types";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: () => void) {
  onUnauthorized = cb;
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

  if (res.status === 401) {
    onUnauthorized?.();
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
    test: () =>
      apiFetch<{ status: string }>("/api/v1/push/test", { method: "POST" }),
  },
  auth: {
    status: () =>
      apiFetch<{ authenticated: boolean; isNewUser?: boolean; user?: { id: string; email: string; name: string | null; avatarUrl: string | null } }>("/api/v1/auth/status"),
    settings: () =>
      apiFetch<{ registrationsOpen: boolean }>("/api/v1/auth/settings"),
    loginOptions: () =>
      apiFetch<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>("/api/v1/auth/login/options", { method: "POST" }),
    login: (data: { challengeId: string; credential: unknown }) =>
      apiFetch<{ status: string }>("/api/v1/auth/login", { method: "POST", body: data }),
    registerOptions: () =>
      apiFetch<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>("/api/v1/auth/register/options", { method: "POST" }),
    register: (data: { challengeId: string; credential: unknown; name?: string }) =>
      apiFetch<{ status: string }>("/api/v1/auth/register", { method: "POST", body: data }),
    logout: () =>
      apiFetch<{ status: string }>("/api/v1/auth/logout", { method: "POST" }),
    passkeys: {
      list: () =>
        apiFetch<ListResponse<Passkey>>("/api/v1/auth/passkeys"),
      revoke: (id: string) =>
        apiFetch<void>(`/api/v1/auth/passkeys/${id}`, { method: "DELETE" }),
    },
    apiKeys: {
      list: () =>
        apiFetch<{ items: Array<{ id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }> }>("/api/v1/auth/api-keys"),
      create: (name: string) =>
        apiFetch<{ id: string; name: string; prefix: string; key: string; createdAt: string }>("/api/v1/auth/api-keys", { method: "POST", body: { name } }),
      revoke: (id: string) =>
        apiFetch<void>(`/api/v1/auth/api-keys/${id}`, { method: "DELETE" }),
    },
  },
  users: {
    me: () =>
      apiFetch<{ id: string; email: string; name: string | null; avatarUrl: string | null; onboarded: boolean }>("/api/v1/users/me"),
    updateMe: (body: { name?: string; onboarded?: true }) =>
      apiFetch<{ id: string; email: string; name: string | null; avatarUrl: string | null; onboarded: boolean }>("/api/v1/users/me", { method: "PATCH", body }),
  },
  dashboard: () => apiFetch<DashboardResponse>("/api/v1/dashboard"),
  health: () => apiFetch<{ status: string }>("/health"),
};
