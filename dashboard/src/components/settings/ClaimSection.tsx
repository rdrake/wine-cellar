import { useState } from "react";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export interface ClaimSectionProps {
  onClaimed: () => void;
}

export function ClaimSection({ onClaimed }: ClaimSectionProps) {
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
          aria-label="Device ID"
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
