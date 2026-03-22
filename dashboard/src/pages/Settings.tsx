import { useState, useCallback, useEffect } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { api } from "@/api";
import { useAuth } from "@/components/AuthGate";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GravitySparkline } from "@/components/Sparkline";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { Device, Batch, Reading, Passkey } from "@/types";

// ── Helpers ──────────────────────────────────────────────────────────

function relativeTime(isoDate: string): string {
  // SQLite datetime('now') omits the Z suffix — append it if missing so
  // the browser parses the timestamp as UTC rather than local time.
  const normalized = isoDate.endsWith("Z") || isoDate.includes("+") ? isoDate : isoDate + "Z";
  const diff = Date.now() - new Date(normalized).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function batteryColor(pct: number): string {
  if (pct > 50) return "text-green-600 dark:text-green-400";
  if (pct > 20) return "text-yellow-600 dark:text-yellow-400";
  return "text-destructive";
}

function signalLabel(rssi: number): { text: string; color: string } {
  if (rssi > -50) return { text: "Excellent", color: "text-green-600 dark:text-green-400" };
  if (rssi > -70) return { text: "Good", color: "text-green-600 dark:text-green-400" };
  if (rssi > -85) return { text: "Fair", color: "text-yellow-600 dark:text-yellow-400" };
  return { text: "Weak", color: "text-destructive" };
}

// ── Device Card with sensor status ───────────────────────────────────

function DeviceCard({ device, batchName, onAssign, onUnassign }: {
  device: Device;
  batchName: string | null;
  onAssign: (device: Device) => void;
  onUnassign: (deviceId: string) => void;
}) {
  const { data } = useFetch(
    () => api.readings.listByDevice(device.id, { limit: 50 }),
    [device.id],
  );

  const readings = data?.items.slice().reverse() ?? [];
  const latest: Reading | null = readings.length > 0 ? readings[readings.length - 1] : null;

  return (
    <div className="py-3">
        <div className="flex justify-between items-start">
          <div className="min-w-0">
            <p className="font-medium text-sm">{device.name}</p>
            <p className="text-xs text-muted-foreground font-mono truncate">{device.id}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {device.batch_id ? (
              <>
                <span className="text-xs font-medium text-foreground">Assigned</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onUnassign(device.id)}>
                  Unassign
                </Button>
              </>
            ) : (
              <>
                <span className="text-xs text-muted-foreground">Idle</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onAssign(device)}>
                  Assign
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Batch assignment */}
        {batchName && (
          <p className="text-xs text-muted-foreground mt-1">
            Monitoring: <span className="font-medium text-foreground">{batchName}</span>
          </p>
        )}

        {/* Sensor status strip */}
        {latest ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="tabular-nums">
              <span className="font-semibold">{latest.gravity.toFixed(3)}</span>
              <span className="text-muted-foreground"> SG</span>
            </span>
            {latest.temperature != null && (
              <span className="tabular-nums">
                <span className="font-semibold">{latest.temperature.toFixed(1)}</span>
                <span className="text-muted-foreground">{"\u00B0C"}</span>
              </span>
            )}
            {latest.battery != null && (
              <span className={batteryColor(latest.battery)}>
                {latest.battery.toFixed(0)}% bat
              </span>
            )}
            {latest.rssi != null && (
              <span className={signalLabel(latest.rssi).color}>
                {signalLabel(latest.rssi).text}
              </span>
            )}
            <span className="text-muted-foreground">
              {relativeTime(latest.source_timestamp)}
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mt-2">No readings received yet</p>
        )}

        {/* Mini sparkline */}
        {readings.length >= 2 && (
          <div className="mt-2">
            <GravitySparkline values={readings.map((r) => r.gravity)} width={200} height={24} />
          </div>
        )}
    </div>
  );
}

// ── Assign Dialog ────────────────────────────────────────────────────

function AssignDialog({ device, onClose, onAssigned }: {
  device: Device;
  onClose: () => void;
  onAssigned: () => void;
}) {
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
      toast.error(e instanceof Error ? e.message : "Couldn't assign device. Please try again.");
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
        <Select value={selectedBatch} onValueChange={(v) => setSelectedBatch(v ?? "")}>
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

// ── Claim Section ────────────────────────────────────────────────────

function ClaimSection({ onClaimed }: { onClaimed: () => void }) {
  const [deviceId, setDeviceId] = useState("");
  const [claiming, setClaiming] = useState(false);

  async function handleClaim() {
    if (!deviceId.trim()) return;
    setClaiming(true);
    try {
      await api.devices.claim(deviceId.trim());
      toast.success("Device claimed");
      setDeviceId("");
      onClaimed();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't claim device");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Enter a device ID to claim an unregistered RAPT Pill.
        The device must have sent at least one reading.
      </p>
      <div className="flex gap-2">
        <input
          className="flex-1 px-2 py-1 text-sm border rounded bg-background"
          placeholder="e.g. pill-abc-123"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
        />
        <Button size="sm" disabled={!deviceId.trim() || claiming} onClick={handleClaim}>
          {claiming ? "Claiming..." : "Claim"}
        </Button>
      </div>
    </div>
  );
}

// ── Notifications ────────────────────────────────────────────────────

function NotificationsSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // Check current subscription state on mount
  useEffect(() => {
    async function check() {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          setEnabled(false);
          setLoading(false);
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setEnabled(!!sub);
      } catch {
        setEnabled(false);
      }
      setLoading(false);
    }
    check();
  }, []);

  async function toggle() {
    if (enabled === null) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (enabled) {
        // Unsubscribe
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await api.push.unsubscribe(sub.endpoint);
          await sub.unsubscribe();
        }
        setEnabled(false);
        toast.success("Notifications disabled");
      } else {
        // Subscribe
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast.error("Notification permission denied");
          setLoading(false);
          return;
        }
        const { key } = await api.push.vapidKey();
        // Decode base64url to Uint8Array for applicationServerKey
        const raw = key.replace(/-/g, "+").replace(/_/g, "/");
        const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
        const binary = atob(raw + pad);
        const keyBytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes,
        });
        const json = sub.toJSON();
        await api.push.subscribe({
          endpoint: sub.endpoint,
          keys: {
            p256dh: json.keys!.p256dh!,
            auth: json.keys!.auth!,
          },
        });
        setEnabled(true);
        toast.success("Notifications enabled");
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't update notification settings");
    }
    setLoading(false);
  }

  const supported = "serviceWorker" in navigator && "PushManager" in window;

  return (
    <div className="flex flex-col gap-2">
      {!supported ? (
        <p className="text-xs text-muted-foreground">
          Push notifications are not supported in this browser.
        </p>
      ) : (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Push Notifications</p>
            <p className="text-xs text-muted-foreground">
              Get alerts for fermentation stalls, temperature issues, and stage suggestions.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            {enabled && (
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={async () => {
                  try {
                    await api.push.test();
                    toast.success("Test notification sent");
                  } catch {
                    toast.error("Couldn't send test notification");
                  }
                }}
              >
                Test
              </Button>
            )}
            <Button
              size="sm"
              variant={enabled ? "outline" : "default"}
              disabled={loading}
            onClick={toggle}
          >
            {loading ? "..." : enabled ? "Disable" : "Enable"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── API Keys ─────────────────────────────────────────────────────────

function ApiKeysSection() {
  const [keys, setKeys] = useState<Array<{ id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const { items } = await api.auth.apiKeys.list();
      setKeys(items);
    } catch {
      toast.error("Couldn't load API keys");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const result = await api.auth.apiKeys.create(newKeyName.trim());
      setCreatedKey(result.key);
      setNewKeyName("");
      fetchKeys();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't create API key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    try {
      await api.auth.apiKeys.revoke(id);
      toast.success("API key revoked");
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't revoke API key");
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm">API Keys</p>
          <p className="text-xs text-muted-foreground">For MCP servers and automation.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
          Create
        </Button>
      </div>

      {keys.length === 0 && !showCreate && (
        <p className="text-xs text-muted-foreground">No API keys yet.</p>
      )}

      {keys.map((k) => (
        <div key={k.id} className="flex items-center justify-between py-1.5">
          <div>
            <p className="text-sm font-medium">{k.name}</p>
            <p className="text-xs text-muted-foreground font-mono">
              {k.prefix}{"..."} · created {relativeTime(k.createdAt)}
              {k.lastUsedAt ? ` · used ${relativeTime(k.lastUsedAt)}` : " · never used"}
            </p>
          </div>
          <Button size="sm" variant="ghost" className="text-destructive h-7 text-xs" onClick={() => handleRevoke(k.id)}>
            Revoke
          </Button>
        </div>
      ))}

      {/* Create dialog */}
      <Dialog open={showCreate && !createdKey} onOpenChange={(open) => { if (!open) { setShowCreate(false); setNewKeyName(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
          </DialogHeader>
          <input
            className="w-full px-3 py-2 text-sm border rounded bg-background"
            placeholder="Key name, e.g. MCP Server"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setNewKeyName(""); }}>Cancel</Button>
            <Button disabled={!newKeyName.trim() || creating} onClick={handleCreate}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show key dialog */}
      <Dialog open={!!createdKey} onOpenChange={(open) => { if (!open) { setCreatedKey(null); setShowCreate(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Copy this key now — you won't be able to see it again.</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={createdKey ?? ""}
                className="flex-1 px-3 py-2 text-xs font-mono border rounded bg-muted select-all"
                onFocus={(e) => e.target.select()}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (createdKey) {
                    navigator.clipboard.writeText(createdKey);
                    toast.success("Copied to clipboard");
                  }
                }}
              >
                Copy
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setCreatedKey(null); setShowCreate(false); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Passkeys ─────────────────────────────────────────────────────────

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
          <div>
            <p className="text-sm font-medium">{pk.name ?? "Unnamed passkey"}</p>
            <p className="text-xs text-muted-foreground">
              Created {relativeTime(pk.createdAt)}
              {pk.lastUsedAt ? ` · used ${relativeTime(pk.lastUsedAt)}` : " · never used"}
            </p>
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
            maxLength={100}
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

// ── Account ──────────────────────────────────────────────────────────

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

// ── Page ─────────────────────────────────────────────────────────────

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

      <p className="text-xs text-muted-foreground text-center">
        Build: {(globalThis as Record<string, unknown>).__BUILD_TIME__ as string}
      </p>

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
