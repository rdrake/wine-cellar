import { useState } from "react";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import type { Device } from "@/types";
import {
  DeviceCard,
  AssignDialog,
  ClaimSection,
  PasskeysSection,
  ApiKeysSection,
  AccountSection,
} from "@/components/settings";

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
