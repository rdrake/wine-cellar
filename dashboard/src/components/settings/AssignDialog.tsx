import { useState, useCallback } from "react";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
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

export interface AssignDialogProps {
  device: Device;
  onClose: () => void;
  onAssigned: () => void;
}

export function AssignDialog({ device, onClose, onAssigned }: AssignDialogProps) {
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
