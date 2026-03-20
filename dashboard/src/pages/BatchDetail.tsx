import { useParams, Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { GravitySparkline, TemperatureSparkline } from "@/components/Sparkline";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Batch } from "@/types";
import { STAGE_LABELS, WINE_TYPE_LABELS, SOURCE_MATERIAL_LABELS, STATUS_LABELS } from "@/types";
import ActivitySection from "@/components/ActivitySection";
import ReadingsChart from "@/components/ReadingsChart";
import DeviceSection from "@/components/DeviceSection";
import BatchStats from "@/components/BatchStats";
import ExportButton from "@/components/ExportButton";
import type { Reading } from "@/types";
import { attenuation } from "@/lib/fermentation";

function SparklineSummary({ readings }: { readings: Reading[] }) {
  if (readings.length < 2) return null;

  const gravities = readings.map((r: Reading) => r.gravity);
  const temps = readings.map((r: Reading) => r.temperature).filter((t): t is number => t != null);
  const first = readings[0];
  const last = readings[readings.length - 1];
  const og = first.gravity;
  const sg = last.gravity;
  const att = og !== sg ? attenuation(og, sg) : 0;

  return (
    <div className="py-2 space-y-1">
      <div className="flex items-center gap-3">
        <GravitySparkline values={gravities} width={180} height={28} />
        <span className="text-sm tabular-nums">
          <span className="font-semibold">{sg.toFixed(3)}</span>
          <span className="text-muted-foreground text-xs"> SG</span>
        </span>
        {att > 0 && (
          <span className="text-sm tabular-nums">
            <span className="font-semibold">{att.toFixed(0)}</span>
            <span className="text-muted-foreground text-xs">%</span>
          </span>
        )}
      </div>
      {temps.length >= 2 && (
        <div className="flex items-center gap-3">
          <TemperatureSparkline values={temps} width={180} height={28} />
          <span className="text-sm tabular-nums">
            <span className="font-semibold">{temps[temps.length - 1].toFixed(1)}</span>
            <span className="text-muted-foreground text-xs">{"\u00B0C"}</span>
          </span>
        </div>
      )}
      <p className="text-xs text-muted-foreground tabular-nums">
        {og.toFixed(3)} → {sg.toFixed(3)}
        {" · "}{readings.length} readings
      </p>
    </div>
  );
}

function LifecycleActions({ batch, onAction, onDeleted }: { batch: Batch; onAction: () => void; onDeleted: () => void }) {
  const [confirmAction, setConfirmAction] = useState<{ label: string; action: () => Promise<void> } | null>(null);
  const [acting, setActing] = useState(false);

  async function doAction(label: string, action: () => Promise<Batch>) {
    setActing(true);
    try {
      await action();
      toast.success(label);
      onAction();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActing(false);
      setConfirmAction(null);
    }
  }

  function confirm(label: string, action: () => Promise<Batch>) {
    setConfirmAction({ label, action: () => doAction(label, action) });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {batch.status === "active" && (
          <>
            <Button size="sm" onClick={() => doAction("Stage advanced", () => api.batches.advance(batch.id))}>
              Advance Stage
            </Button>
            <Button size="sm" variant="outline" onClick={() => doAction("Batch completed", () => api.batches.complete(batch.id))}>
              Complete
            </Button>
            <Button size="sm" variant="destructive" onClick={() => confirm("Abandon batch?", () => api.batches.abandon(batch.id))}>
              Abandon
            </Button>
          </>
        )}
        {(batch.status === "completed" || batch.status === "abandoned") && (
          <Button size="sm" variant="outline" onClick={() => doAction("Batch reopened", () => api.batches.update(batch.id, { status: "active" }))}>
            Reopen
          </Button>
        )}
        {batch.status === "completed" && (
          <Button size="sm" variant="outline" onClick={() => doAction("Batch archived", () => api.batches.archive(batch.id))}>
            Archive
          </Button>
        )}
        {batch.status === "archived" && (
          <Button size="sm" variant="outline" onClick={() => doAction("Batch unarchived", () => api.batches.unarchive(batch.id))}>
            Unarchive
          </Button>
        )}
        {batch.status !== "active" && (
          <Button size="sm" variant="destructive" onClick={() => setConfirmAction({
            label: "Delete batch?",
            action: async () => {
              setActing(true);
              try {
                await api.batches.delete(batch.id);
                toast.success("Batch deleted");
                onDeleted();
              } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : "Delete failed");
              } finally {
                setActing(false);
                setConfirmAction(null);
              }
            },
          })}>
            Delete
          </Button>
        )}
      </div>

      <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmAction?.label}</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button variant="destructive" disabled={acting} onClick={confirmAction?.action}>
              {acting ? "..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function BatchDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: batch, loading, error, refetch } = useFetch(
    () => api.batches.get(id!),
    [id],
  );

  const { data: readingsData } = useFetch(
    () => api.readings.listByBatch(id!, { limit: 500 }),
    [id],
  );

  return (
    <div className="p-4 max-w-lg mx-auto space-y-6">
      {/* Header — shows loading/error state */}
      {loading && <p className="text-muted-foreground">Loading...</p>}
      {error && (
        <div className="text-destructive">
          {error}
          <Button variant="link" size="sm" onClick={refetch}>Retry</Button>
        </div>
      )}

      {batch && (
        <>
          <div>
            <div className="flex justify-between items-start">
              <div>
                <h1 className="font-heading text-xl font-bold">{batch.name}</h1>
                <p className="text-sm text-muted-foreground">
                  {WINE_TYPE_LABELS[batch.wine_type]} &middot; {SOURCE_MATERIAL_LABELS[batch.source_material]}
                </p>
              </div>
              <div className="flex gap-2 items-center">
                <Badge>{STATUS_LABELS[batch.status]}</Badge>
                <ExportButton batch={batch} />
                <Link to={`/batches/${id}/edit`}>
                  <Button size="sm" variant="ghost">Edit</Button>
                </Link>
              </div>
            </div>

            <SparklineSummary readings={readingsData?.items.slice().reverse() ?? []} />
            <BatchStats batch={batch} readings={readingsData?.items ?? []} />

            <Card className="mt-3">
              <CardContent className="p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stage</span>
                  <span>{STAGE_LABELS[batch.stage]}</span>
                </div>
                {batch.volume_liters && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Volume</span>
                    <span>{batch.volume_liters} L</span>
                  </div>
                )}
                {batch.target_volume_liters && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Target</span>
                    <span>{batch.target_volume_liters} L</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Started</span>
                  <span>{new Date(batch.started_at).toLocaleDateString()}</span>
                </div>
                {batch.notes && <p className="pt-2 text-muted-foreground">{batch.notes}</p>}
              </CardContent>
            </Card>
          </div>

          {/* Lifecycle Actions */}
          <LifecycleActions batch={batch} onAction={refetch} onDeleted={() => navigate("/")} />
        </>
      )}

      {/* These sections mount immediately and fetch in parallel with the batch */}
      <ActivitySection batchId={id!} batchStatus={batch?.status ?? "active"} />
      <ReadingsChart batchId={id!} />
      <DeviceSection batchId={id!} batchStatus={batch?.status ?? "active"} onAssignmentChange={refetch} />
    </div>
  );
}
