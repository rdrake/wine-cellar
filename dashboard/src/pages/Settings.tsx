import { useState, useCallback, useEffect } from "react";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
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
import type { Device, Batch, Reading } from "@/types";

// ── Helpers ──────────────────────────────────────────────────────────

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
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
    <div className="space-y-2">
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
    <div className="space-y-2">
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
    <div className="p-4 max-w-lg lg:max-w-3xl mx-auto space-y-4">
      {/* Sensors */}
      <section>
        <h2 className="text-sm font-semibold mb-2">
          Sensors
        </h2>
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
      </section>

      {/* Claim Device */}
      <section>
        <h2 className="text-sm font-semibold mb-2">Claim Device</h2>
        <ClaimSection onClaimed={refetch} />
      </section>

      {/* Notifications */}
      <section>
        <h2 className="text-sm font-semibold mb-2">Notifications</h2>
        <NotificationsSection />
      </section>

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
