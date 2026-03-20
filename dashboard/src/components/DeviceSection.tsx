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
    () => api.devices.list(),
    [batchId],
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
            <Link to="/settings">
              <Button size="sm" variant="outline">Assign Device</Button>
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
