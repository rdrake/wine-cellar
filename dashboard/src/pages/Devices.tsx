import { useState, useCallback } from "react";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import type { Device, Batch } from "@/types";

function DeviceSparkline({ deviceId }: { deviceId: string }) {
  const { data } = useFetch(
    () => api.readings.listByDevice(deviceId, { limit: 50 }),
    [deviceId],
  );
  const readings = data?.items.slice().reverse() ?? [];
  if (readings.length < 2) return null;
  const last = readings[readings.length - 1];
  return (
    <div className="flex items-center gap-2 mt-2">
      <GravitySparkline values={readings.map((r) => r.gravity)} width={140} height={24} />
      <span className="text-xs tabular-nums text-muted-foreground">{last.gravity.toFixed(3)}</span>
    </div>
  );
}

export default function Devices() {
  const { data: devicesData, loading, error, refetch } = useFetch(
    () => api.devices.list(),
    [],
  );
  const { data: batchesData } = useFetch(
    () => api.batches.list(),
    [],
  );

  const [assignDialog, setAssignDialog] = useState<Device | null>(null);

  // Build a lookup map for batch names
  const batchNames = new Map<string, string>();
  batchesData?.items.forEach((b) => batchNames.set(b.id, b.name));

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-4">Devices</h1>

      {loading && <p className="text-muted-foreground text-sm">Loading devices...</p>}
      {error && (
        <div className="text-destructive text-sm">
          <p>Couldn't load devices. {error}</p>
          <Button variant="link" size="sm" className="px-0" onClick={refetch}>Try again</Button>
        </div>
      )}

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
                  <DeviceSparkline deviceId={device.id} />
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
                          toast.error(e instanceof Error ? e.message : "Couldn't unassign device. Please try again.");
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
