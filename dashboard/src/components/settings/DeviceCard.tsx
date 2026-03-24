import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
import { GravitySparkline, BatterySparkline } from "@/components/Sparkline";
import { timeAgo } from "@/lib/dates";
import { batteryColor, signalLabel } from "./helpers";
import { deviceReadingsToCSV, downloadCSV } from "@/lib/csv";
import { toast } from "sonner";
import type { Device, Reading } from "@/types";

export interface DeviceCardProps {
  device: Device;
  batchName: string | null;
  onAssign: (device: Device) => void;
  onUnassign: (deviceId: string) => void;
}

export function DeviceCard({ device, batchName, onAssign, onUnassign }: DeviceCardProps) {
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

        {batchName && (
          <p className="text-xs text-muted-foreground mt-1">
            Monitoring: <span className="font-medium text-foreground">{batchName}</span>
          </p>
        )}

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
              {timeAgo(latest.source_timestamp)}
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mt-2">No readings received yet</p>
        )}

        {readings.length >= 2 && (
          <div className="mt-2">
            <GravitySparkline values={readings.map((r) => r.gravity)} width={200} height={24} />
            {readings.some((r) => r.battery != null) && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-muted-foreground w-6">Bat</span>
                <BatterySparkline
                  values={readings.filter((r) => r.battery != null).map((r) => r.battery!)}
                  width={160}
                  height={16}
                />
              </div>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs mt-1"
              onClick={() => {
                const slug = device.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                downloadCSV(deviceReadingsToCSV(readings), `${slug}-readings.csv`);
                toast.success(`Downloaded ${readings.length} readings`);
              }}
            >
              Export CSV
            </Button>
          </div>
        )}
    </div>
  );
}
