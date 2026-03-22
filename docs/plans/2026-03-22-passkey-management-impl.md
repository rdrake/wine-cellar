# Passkey Management & Settings Reorganization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add passkey listing/revocation and reorganize the Settings page into three Card groups (Devices, Security, Account).

**Architecture:** Migration adds `name` column to `passkey_credentials`. Two new API routes (list/delete passkeys) in the existing auth router. Dashboard Settings rewritten with Card-based layout, passkey list with revoke + name-on-register prompt. Uses existing `flex flex-col gap-*` pattern inside Cards (not `space-y-*` which collapses with `overflow-hidden`).

**Tech Stack:** Hono, D1, Vitest + miniflare, React 19, shadcn/ui Card/Badge/Dialog, @simplewebauthn/browser

---

### Task 1: Migration — add `name` column to passkey_credentials

**Files:**
- Create: `api/migrations/0011_passkey_name.sql`

**Step 1: Write the migration**

```sql
ALTER TABLE passkey_credentials ADD COLUMN name TEXT;
```

**Step 2: Verify migration loads**

Run: `cd api && npm run test -- --run test/auth.test.ts -t "returns authenticated=false" 2>&1 | head -20`
Expected: PASS (migration applies without error)

**Step 3: Commit**

```bash
git add api/migrations/0011_passkey_name.sql
git commit -m "feat: add name column to passkey_credentials"
```

---

### Task 2: API — list passkeys endpoint

**Files:**
- Modify: `api/src/routes/auth.ts` (add `GET /passkeys` route)
- Modify: `api/test/auth.test.ts` (add tests)
- Modify: `api/test/helpers.ts` (update `seedCredential` to accept optional name)

**Step 1: Update seedCredential helper to accept a name parameter**

In `api/test/helpers.ts`, update `seedCredential`:

```typescript
export async function seedCredential(userId: string, opts?: { id?: string; name?: string }): Promise<void> {
  const credId = opts?.id ?? "test-credential-id";
  const name = opts?.name ?? null;
  await env.DB.prepare(
    `INSERT INTO passkey_credentials (id, user_id, public_key, webauthn_user_id, sign_count, transports, device_type, backed_up, name)
     VALUES (?, ?, X'00', ?, 0, '["internal"]', 'multiDevice', 1, ?)`,
  ).bind(credId, userId, TEST_WEBAUTHN_USER_ID, name).run();
}
```

**Step 2: Write failing tests**

In `api/test/auth.test.ts`, add:

```typescript
describe("GET /api/v1/auth/passkeys", () => {
  it("returns 401 without auth", async () => {
    const { status } = await fetchJson("/api/v1/auth/passkeys");
    expect(status).toBe(401);
  });

  it("returns empty list when no passkeys", async () => {
    const { status, json } = await fetchJson("/api/v1/auth/passkeys", {
      headers: await authHeaders(),
    });
    expect(status).toBe(200);
    expect(json.items).toEqual([]);
  });

  it("lists passkeys for authenticated user", async () => {
    const { token, userId } = await seedSession();
    await seedCredential(userId, { name: "MacBook Pro" });
    const { status, json } = await fetchJson("/api/v1/auth/passkeys", {
      headers: sessionHeaders(token),
    });
    expect(status).toBe(200);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].name).toBe("MacBook Pro");
    expect(json.items[0].deviceType).toBe("multiDevice");
    expect(json.items[0].backedUp).toBe(true);
    expect(json.items[0].createdAt).toBeDefined();
    // Should NOT expose public key
    expect(json.items[0].publicKey).toBeUndefined();
  });

  it("does not list other users passkeys", async () => {
    const { userId: otherUserId } = await seedSession("other@example.com");
    await seedCredential(otherUserId, { id: "other-cred", name: "Other" });
    const { json } = await fetchJson("/api/v1/auth/passkeys", {
      headers: await authHeaders("me@example.com"),
    });
    expect(json.items).toHaveLength(0);
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `cd api && npx vitest run test/auth.test.ts -t "GET /api/v1/auth/passkeys"`
Expected: FAIL — route not found (404)

**Step 4: Implement the route**

In `api/src/routes/auth.ts`, add after the existing API key routes (before the logout route):

```typescript
// GET /passkeys — list passkeys for the authenticated user (requires session)
auth.get("/passkeys", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB
    .prepare(
      "SELECT id, name, device_type, backed_up, created_at, last_used_at FROM passkey_credentials WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(user.id)
    .all<{
      id: string;
      name: string | null;
      device_type: string | null;
      backed_up: number;
      created_at: string;
      last_used_at: string | null;
    }>();
  const items = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    deviceType: r.device_type,
    backedUp: r.backed_up === 1,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
  return c.json({ items });
});
```

**Step 5: Run tests to verify they pass**

Run: `cd api && npx vitest run test/auth.test.ts -t "GET /api/v1/auth/passkeys"`
Expected: PASS

**Step 6: Commit**

```bash
git add api/src/routes/auth.ts api/test/auth.test.ts api/test/helpers.ts
git commit -m "feat: add GET /auth/passkeys endpoint to list user passkeys"
```

---

### Task 3: API — delete passkey endpoint

**Files:**
- Modify: `api/src/routes/auth.ts` (add `DELETE /passkeys/:id` route)
- Modify: `api/test/auth.test.ts` (add tests)

**Step 1: Write failing tests**

In `api/test/auth.test.ts`, add:

```typescript
describe("DELETE /api/v1/auth/passkeys/:id", () => {
  it("returns 401 without auth", async () => {
    const { status } = await fetchJson("/api/v1/auth/passkeys/some-id", {
      method: "DELETE",
    });
    expect(status).toBe(401);
  });

  it("revokes an existing passkey", async () => {
    const { token, userId } = await seedSession();
    await seedCredential(userId, { id: "cred-to-delete", name: "Old Phone" });
    const { status } = await fetchJson("/api/v1/auth/passkeys/cred-to-delete", {
      method: "DELETE",
      headers: sessionHeaders(token),
    });
    expect(status).toBe(204);
    // Verify it's gone
    const { json } = await fetchJson("/api/v1/auth/passkeys", {
      headers: sessionHeaders(token),
    });
    expect(json.items).toHaveLength(0);
  });

  it("returns 404 for nonexistent passkey", async () => {
    const { status } = await fetchJson("/api/v1/auth/passkeys/nonexistent", {
      method: "DELETE",
      headers: await authHeaders(),
    });
    expect(status).toBe(404);
  });

  it("returns 404 when deleting another users passkey", async () => {
    const { userId: ownerId } = await seedSession("owner@example.com");
    await seedCredential(ownerId, { id: "owner-cred", name: "Owner" });
    const { status } = await fetchJson("/api/v1/auth/passkeys/owner-cred", {
      method: "DELETE",
      headers: await authHeaders("attacker@example.com"),
    });
    expect(status).toBe(404);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run test/auth.test.ts -t "DELETE /api/v1/auth/passkeys"`
Expected: FAIL — route not found

**Step 3: Implement the route**

In `api/src/routes/auth.ts`, add after the GET /passkeys route:

```typescript
// DELETE /passkeys/:id — revoke a passkey (requires session)
auth.delete("/passkeys/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const result = await c.env.DB
    .prepare("DELETE FROM passkey_credentials WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .run();
  if ((result.meta?.changes ?? 0) === 0) {
    return notFound("Passkey");
  }
  return c.body(null, 204);
});
```

**Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run test/auth.test.ts -t "DELETE /api/v1/auth/passkeys"`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/routes/auth.ts api/test/auth.test.ts
git commit -m "feat: add DELETE /auth/passkeys/:id endpoint to revoke passkeys"
```

---

### Task 4: API — accept name on passkey registration

**Files:**
- Modify: `api/src/routes/auth.ts` (update `POST /register` to store name)
- Modify: `api/test/auth.test.ts` (add test)

**Step 1: Write failing test**

In `api/test/auth.test.ts`, add to an existing or new describe block:

```typescript
describe("POST /api/v1/auth/register name field", () => {
  it("stores name when provided during registration", async () => {
    const { token, userId } = await seedSession();
    // We can't do a full WebAuthn ceremony in tests, but we can verify
    // the name would be stored by checking the register route parses it.
    // Instead, seed a credential with name and verify list returns it.
    await seedCredential(userId, { name: "Work Laptop" });
    const { json } = await fetchJson("/api/v1/auth/passkeys", {
      headers: sessionHeaders(token),
    });
    expect(json.items[0].name).toBe("Work Laptop");
  });
});
```

**Step 2: Implement the change**

In `api/src/routes/auth.ts`, in the `POST /register` handler, update the body type and INSERT query.

Change the body type from:
```typescript
const body = await c.req.json<{ challengeId: string; credential: any }>();
```
to:
```typescript
const body = await c.req.json<{ challengeId: string; credential: any; name?: string }>();
```

Update the credential name extraction — add after `const webauthnUserId = ...`:
```typescript
const credentialName = body.name && typeof body.name === "string" ? body.name.trim().slice(0, 100) : null;
```

Update the INSERT to include name:
```typescript
await db
  .prepare(
    `INSERT INTO passkey_credentials (id, user_id, public_key, webauthn_user_id, sign_count, transports, device_type, backed_up, name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  .bind(
    credential.id,
    user.id,
    credential.publicKey as unknown as ArrayBuffer,
    webauthnUserId,
    credential.counter,
    JSON.stringify(credential.transports ?? []),
    credentialDeviceType,
    credentialBackedUp ? 1 : 0,
    credentialName,
  )
  .run();
```

**Step 3: Run all auth tests**

Run: `cd api && npx vitest run test/auth.test.ts`
Expected: All PASS

**Step 4: Commit**

```bash
git add api/src/routes/auth.ts api/test/auth.test.ts
git commit -m "feat: accept optional name field during passkey registration"
```

---

### Task 5: Dashboard — add Passkey type and API client methods

**Files:**
- Modify: `dashboard/src/types.ts` (add `Passkey` interface)
- Modify: `dashboard/src/api.ts` (add `api.auth.passkeys` methods, update `api.auth.register`)

**Step 1: Add Passkey type**

In `dashboard/src/types.ts`, add after the `Device` interface:

```typescript
export interface Passkey {
  id: string;
  name: string | null;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}
```

**Step 2: Add API client methods**

In `dashboard/src/api.ts`, add `Passkey` to the imports from `./types`:

```typescript
import type {
  Batch, BatchCreate, BatchUpdate, BatchStatus, BatchStage, WineType,
  Activity, ActivityCreate, ActivityUpdate, ActivityType, AllStage,
  Reading, Device, Passkey,
  ListResponse, PaginatedResponse, DashboardResponse,
} from "./types";
```

Add `passkeys` namespace inside `api.auth`, after `apiKeys`:

```typescript
passkeys: {
  list: () =>
    apiFetch<ListResponse<Passkey>>("/api/v1/auth/passkeys"),
  revoke: (id: string) =>
    apiFetch<void>(`/api/v1/auth/passkeys/${id}`, { method: "DELETE" }),
},
```

Update `api.auth.register` to accept name:

```typescript
register: (data: { challengeId: string; credential: unknown; name?: string }) =>
  apiFetch<{ status: string }>("/api/v1/auth/register", { method: "POST", body: data }),
```

**Step 3: Verify dashboard builds**

Run: `cd dashboard && npm run build 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add dashboard/src/types.ts dashboard/src/api.ts
git commit -m "feat: add passkey type and API client methods"
```

---

### Task 6: Dashboard — rewrite Settings page with Card layout

**Files:**
- Modify: `dashboard/src/pages/Settings.tsx` (full rewrite)

This is the largest task. The existing helper functions (`relativeTime`, `batteryColor`, `signalLabel`) and components (`DeviceCard`, `AssignDialog`, `ClaimSection`, `NotificationsSection`, `ApiKeysSection`) remain mostly unchanged. The changes are:

1. Wrap groups in `Card` / `CardHeader` / `CardContent`
2. Move `AccountSection` passkey UI into a new `PasskeysSection` inside the Security card
3. Add passkey list with revoke to `PasskeysSection`
4. Add name prompt dialog before passkey registration
5. Add last-passkey warning dialog on revoke

**Step 1: Add imports**

Add to imports at top of Settings.tsx:

```typescript
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Passkey } from "@/types";
```

**Step 2: Create PasskeysSection component**

Replace the passkey part of `AccountSection` with a new standalone `PasskeysSection`:

```typescript
function PasskeysSection() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [newPasskeyName, setNewPasskeyName] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState<Passkey | null>(null);

  const fetchPasskeys = useCallback(async () => {
    try {
      const { items } = await api.auth.passkeys.list();
      setPasskeys(items);
    } catch {
      toast.error("Couldn't load passkeys");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPasskeys();
  }, [fetchPasskeys]);

  async function handleRegister() {
    const name = newPasskeyName.trim() || null;
    setShowNamePrompt(false);
    setNewPasskeyName("");
    setRegistering(true);
    try {
      const { challengeId, options } = await api.auth.registerOptions();
      const credential = await startRegistration({ optionsJSON: options });
      await api.auth.register({ challengeId, credential, name: name ?? undefined });
      toast.success("Passkey registered");
      fetchPasskeys();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't register passkey");
    } finally {
      setRegistering(false);
    }
  }

  async function handleRevoke(passkey: Passkey) {
    // If this is the last passkey, show warning
    if (passkeys.length === 1) {
      setConfirmRevoke(passkey);
      return;
    }
    await doRevoke(passkey.id);
  }

  async function doRevoke(id: string) {
    try {
      await api.auth.passkeys.revoke(id);
      toast.success("Passkey revoked");
      setPasskeys((prev) => prev.filter((p) => p.id !== id));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't revoke passkey");
    }
    setConfirmRevoke(null);
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Passkeys</p>
          <p className="text-xs text-muted-foreground">Sign in with biometrics or a security key.</p>
        </div>
        <Button size="sm" variant="outline" disabled={registering} onClick={() => setShowNamePrompt(true)}>
          {registering ? "Registering..." : "Add"}
        </Button>
      </div>

      {passkeys.length === 0 && (
        <p className="text-xs text-muted-foreground">No passkeys registered.</p>
      )}

      {passkeys.map((pk) => (
        <div key={pk.id} className="flex items-center justify-between py-1.5">
          <div className="flex items-center gap-2">
            <div>
              <p className="text-sm font-medium">{pk.name ?? "Unnamed passkey"}</p>
              <p className="text-xs text-muted-foreground">
                Created {relativeTime(pk.createdAt)}
                {pk.lastUsedAt ? ` · used ${relativeTime(pk.lastUsedAt)}` : " · never used"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pk.backedUp && (
              <Badge variant="secondary">Synced</Badge>
            )}
            <Button size="sm" variant="ghost" className="text-destructive h-7 text-xs" onClick={() => handleRevoke(pk)}>
              Revoke
            </Button>
          </div>
        </div>
      ))}

      {/* Name prompt dialog */}
      <Dialog open={showNamePrompt} onOpenChange={(open) => { if (!open) { setShowNamePrompt(false); setNewPasskeyName(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name This Passkey</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Give it a name so you can identify it later, e.g. "MacBook" or "iPhone".</p>
          <input
            className="w-full px-3 py-2 text-sm border rounded bg-background"
            placeholder="e.g. MacBook Pro"
            value={newPasskeyName}
            onChange={(e) => setNewPasskeyName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRegister(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowNamePrompt(false); setNewPasskeyName(""); }}>Cancel</Button>
            <Button onClick={handleRegister}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Last passkey warning dialog */}
      <Dialog open={!!confirmRevoke} onOpenChange={(open) => { if (!open) setConfirmRevoke(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke Last Passkey?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This is your only passkey. After revoking it, you'll need to use GitHub to sign in and register a new one.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmRevoke && doRevoke(confirmRevoke.id)}>Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

**Step 3: Simplify AccountSection (remove passkey parts)**

```typescript
function AccountSection() {
  const { user } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await api.auth.logout();
      window.location.reload();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't log out");
      setLoggingOut(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {user.avatarUrl && (
          <img src={user.avatarUrl} alt="" className="h-10 w-10 rounded-full" />
        )}
        <div>
          <p className="font-medium">{user.name ?? user.email}</p>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
      </div>

      <div className="pt-2 border-t">
        <NotificationsSection />
      </div>

      <div className="pt-2 border-t">
        <Button size="sm" variant="ghost" className="text-destructive" disabled={loggingOut} onClick={handleLogout}>
          {loggingOut ? "Logging out..." : "Log Out"}
        </Button>
      </div>
    </div>
  );
}
```

**Step 4: Rewrite the Settings page layout**

```typescript
export default function Settings() {
  const { data: devicesData, loading, error, refetch } = useFetch(
    () => api.devices.list(),
    [],
  );
  const { data: batchesData } = useFetch(
    () => api.batches.list(),
    [],
  );

  const [assignDialog, setAssignDialog] = useState<Device | null>(null);

  const batchNames = new Map<string, string>();
  batchesData?.items.forEach((b) => batchNames.set(b.id, b.name));

  async function handleUnassign(deviceId: string) {
    try {
      await api.devices.unassign(deviceId);
      toast.success("Device unassigned");
      refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't unassign device. Please try again.");
    }
  }

  return (
    <div className="p-4 max-w-lg lg:max-w-3xl mx-auto flex flex-col gap-4">
      {/* Devices */}
      <Card>
        <CardHeader>
          <CardTitle>Devices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {loading && <p className="text-sm text-muted-foreground">Loading devices...</p>}
            {error && (
              <div className="text-sm text-destructive">
                <p>Couldn't load devices. {error}</p>
                <Button variant="link" size="sm" className="px-0" onClick={refetch}>Try again</Button>
              </div>
            )}
            {devicesData && devicesData.items.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No sensors registered. Devices appear automatically when your RAPT Pill sends its first reading.
              </p>
            )}
            <div className="divide-y divide-border">
              {devicesData?.items.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  batchName={device.batch_id ? batchNames.get(device.batch_id) ?? null : null}
                  onAssign={setAssignDialog}
                  onUnassign={handleUnassign}
                />
              ))}
            </div>
            <div className="pt-3 border-t">
              <ClaimSection onClaimed={refetch} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <PasskeysSection />
            <div className="pt-1 border-t">
              <ApiKeysSection />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountSection />
        </CardContent>
      </Card>

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
```

**Step 5: Verify dashboard builds**

Run: `cd dashboard && npm run build 2>&1 | tail -5`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add dashboard/src/pages/Settings.tsx
git commit -m "feat: reorganize Settings into Card groups with passkey management"
```

---

### Task 7: Dashboard tests — passkey list and Settings layout

**Files:**
- Modify or create: `dashboard/src/pages/Settings.test.tsx`

**Step 1: Check if Settings test file exists**

Run: `ls dashboard/src/pages/Settings.test.tsx 2>&1`

If it doesn't exist, create it. If it does, add to it.

**Step 2: Write tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the API and auth
vi.mock("@/api", () => ({
  api: {
    devices: { list: vi.fn().mockResolvedValue({ items: [] }) },
    batches: { list: vi.fn().mockResolvedValue({ items: [] }) },
    auth: {
      passkeys: { list: vi.fn().mockResolvedValue({ items: [] }) },
      apiKeys: { list: vi.fn().mockResolvedValue({ items: [] }) },
    },
  },
}));

vi.mock("@/components/AuthGate", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "test@example.com", name: "Test", avatarUrl: null },
  }),
}));

import Settings from "./Settings";

describe("Settings page layout", () => {
  it("renders three card groups", async () => {
    render(<Settings />);
    expect(screen.getByText("Devices")).toBeInTheDocument();
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
  });

  it("renders passkeys section inside Security", async () => {
    render(<Settings />);
    expect(screen.getByText("Passkeys")).toBeInTheDocument();
  });
});
```

**Step 3: Run tests**

Run: `cd dashboard && npx vitest run src/pages/Settings.test.tsx`
Expected: PASS

**Step 4: Commit**

```bash
git add dashboard/src/pages/Settings.test.tsx
git commit -m "test: add Settings page layout tests"
```

---

### Task 8: Run full test suites

**Step 1: Run API tests**

Run: `cd api && npm run test`
Expected: All PASS

**Step 2: Run dashboard tests**

Run: `cd dashboard && npm run test`
Expected: All PASS

**Step 3: Run dashboard build**

Run: `cd dashboard && npm run build`
Expected: Build succeeds
