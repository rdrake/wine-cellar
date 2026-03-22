import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Batch, BatchStage, Reading, Device } from "@/types";
import { STAGE_LABELS, WINE_TYPE_LABELS, SOURCE_MATERIAL_LABELS, STATUS_LABELS } from "@/types";
import ActivitySection from "@/components/ActivitySection";
import ReadingsChart from "@/components/ReadingsChart";
import DeviceSection from "@/components/DeviceSection";
import ExportButton from "@/components/ExportButton";
import NudgeBar from "@/components/NudgeBar";
import BatchTimeline from "@/components/BatchTimeline";
import CellaringCard from "@/components/CellaringCard";
import { abv, attenuation, velocity, tempStats, daysSince, projectedDaysToTarget } from "@/lib/fermentation";

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

// ── Snapshot Card ────────────────────────────────────────────────────

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">
        {value}
        {unit && <span className="text-xs font-normal text-muted-foreground ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

function BatchSnapshot({ batch, readings, device }: {
  batch: Batch;
  readings: Reading[];
  device: Device | null;
}) {
  const sorted = readings.length >= 2
    ? [...readings].sort((a, b) => new Date(a.source_timestamp).getTime() - new Date(b.source_timestamp).getTime())
    : null;

  const latest = sorted ? sorted[sorted.length - 1] : null;
  const og = sorted ? sorted[0].gravity : null;
  const sg = latest?.gravity ?? null;
  const currentAbv = og && sg ? abv(og, sg) : null;
  const att = og && sg ? attenuation(og, sg) : null;
  const vel = sorted ? velocity(sorted) : null;
  const temps = sorted ? tempStats(sorted) : null;
  const days = daysSince(batch.started_at);
  const proj = vel !== null && sg !== null ? projectedDaysToTarget(sg, 0.996, vel) : null;

  return (
    <div className="space-y-1">
        {/* Current readings — the freshest data first */}
        {latest ? (
          <>
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-muted-foreground">Current SG</span>
              <span className="text-sm font-semibold tabular-nums">
                {sg!.toFixed(3)}
                <span className="text-xs font-normal text-muted-foreground ml-1.5">
                  {relativeTime(latest.source_timestamp)} · {latest.source}
                </span>
              </span>
            </div>
            {latest.temperature != null && (
              <Stat label="Temperature" value={latest.temperature.toFixed(1)} unit={"\u00B0C"} />
            )}
            {currentAbv != null && <Stat label="Est. ABV" value={currentAbv.toFixed(1)} unit="%" />}
            {att != null && <Stat label="Attenuation" value={att.toFixed(0)} unit="%" />}
            <Stat label={"OG \u2192 SG"} value={`${og!.toFixed(3)} \u2192 ${sg!.toFixed(3)}`} />
            {vel !== null && (
              <Stat
                label="Gravity change (48h)"
                value={`${vel > 0 ? "+" : ""}${(vel * 1000).toFixed(1)}`}
                unit="pts/day"
              />
            )}
            {proj !== null && proj > 0 && (
              <Stat label="Est. days to dry (0.996)" value={String(proj)} unit="d" />
            )}
            {temps && (
              <Stat label="Temp range" value={`${temps.min.toFixed(1)}\u2013${temps.max.toFixed(1)}`} unit={"\u00B0C"} />
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No readings yet</p>
        )}

        {/* Batch metadata */}
        <div className="pt-1 mt-1" />
        <Stat label="Day" value={String(days)} />
        {batch.volume_liters != null && (
          <Stat
            label="Volume"
            value={batch.target_volume_liters
              ? `${batch.volume_liters} / ${batch.target_volume_liters}`
              : String(batch.volume_liters)}
            unit="L"
          />
        )}
        <Stat label="Started" value={new Date(batch.started_at).toLocaleDateString()} />
        {batch.completed_at && (
          <Stat label="Completed" value={new Date(batch.completed_at).toLocaleDateString()} />
        )}
        {sorted && <Stat label="Readings" value={String(sorted.length)} />}

        {/* Device status */}
        {device && (
          <>
            <div className="pt-1 mt-1" />
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-muted-foreground">Device</span>
              <span className="text-sm font-semibold">{device.name}</span>
            </div>
          </>
        )}
    </div>
  );
}

// ── Lifecycle Actions ────────────────────────────────────────────────

const WAYPOINTS: BatchStage[] = [
  "must_prep",
  "primary_fermentation",
  "secondary_fermentation",
  "stabilization",
  "bottling",
];

function nextStage(current: BatchStage): BatchStage {
  const idx = WAYPOINTS.indexOf(current);
  return idx < WAYPOINTS.length - 1 ? WAYPOINTS[idx + 1] : current;
}

function LifecycleActions({ batch, batchId, onAction, onDeleted }: {
  batch: Batch;
  batchId: string;
  onAction: () => void;
  onDeleted: () => void;
}) {
  const [confirmAction, setConfirmAction] = useState<{ label: string; verb: string; verbing: string; action: () => Promise<void> } | null>(null);
  const [acting, setActing] = useState(false);
  const [selectedStage, setSelectedStage] = useState<BatchStage>(nextStage(batch.stage));

  async function doAction(label: string, action: () => Promise<Batch>) {
    setActing(true);
    try {
      await action();
      toast.success(label);
      onAction();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't complete that action. Please try again.");
    } finally {
      setActing(false);
      setConfirmAction(null);
    }
  }

  function confirm(label: string, verb: string, verbing: string, action: () => Promise<Batch>) {
    setConfirmAction({ label, verb, verbing, action: () => doAction(label, action) });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 items-center">
        {batch.status === "active" && (
          <>
            <Select value={selectedStage} onValueChange={(v) => setSelectedStage(v as BatchStage)}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WAYPOINTS.map((s) => (
                  <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={acting || selectedStage === batch.stage}
              onClick={() => doAction(
                `Stage set to ${STAGE_LABELS[selectedStage]}`,
                () => api.batches.setStage(batch.id, selectedStage),
              )}
            >
              {acting ? "Setting..." : "Set Stage"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => doAction("Batch completed", () => api.batches.complete(batch.id))}>
              Complete
            </Button>
            <Link to={`/batches/${batchId}/activities/new`}>
              <Button size="sm" variant="outline">+ Log Activity</Button>
            </Link>
            <Button size="sm" variant="destructive" onClick={() => confirm("Abandon batch?", "Abandon", "Abandoning...", () => api.batches.abandon(batch.id))}>
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
            label: "Permanently delete this batch?",
            verb: "Delete",
            verbing: "Deleting...",
            action: async () => {
              setActing(true);
              try {
                await api.batches.delete(batch.id);
                toast.success("Batch deleted");
                onDeleted();
              } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : "Couldn't delete batch. Please try again.");
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
              {acting ? (confirmAction?.verbing ?? "...") : (confirmAction?.verb ?? "Confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function BatchDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notesOpen, setNotesOpen] = useState(false);
  const actionHandled = useRef(false);

  const { data: batch, loading, error, refetch } = useFetch(
    () => api.batches.get(id!),
    [id],
  );

  // Handle query param actions from push notifications
  useEffect(() => {
    if (actionHandled.current) return;
    const action = searchParams.get("action");
    if (!action) return;

    actionHandled.current = true;

    if (action === "advance") {
      const stage = searchParams.get("stage");
      if (stage) {
        api.batches.setStage(id!, stage).then(() => {
          toast.success(`Stage set to ${STAGE_LABELS[stage as BatchStage] ?? stage}`);
          refetch();
        }).catch((e: unknown) => {
          toast.error(e instanceof Error ? e.message : "Failed to set stage");
        }).finally(() => {
          setSearchParams({}, { replace: true });
        });
      }
    } else if (action === "dismiss") {
      const alertId = searchParams.get("alertId");
      if (alertId) {
        api.alerts.dismiss(alertId).then(() => {
          toast.success("Alert dismissed");
        }).catch((e: unknown) => {
          toast.error(e instanceof Error ? e.message : "Failed to dismiss alert");
        }).finally(() => {
          setSearchParams({}, { replace: true });
        });
      }
    }
  }, [searchParams, id, refetch, setSearchParams]);

  const { data: readingsData, refetch: refetchReadings } = useFetch(
    () => api.readings.listByBatch(id!, { limit: 500 }),
    [id],
  );

  const { data: activitiesData, refetch: refetchActivities } = useFetch(
    () => api.activities.list(id!),
    [id],
  );

  const { data: devicesData } = useFetch(
    () => api.devices.list(),
    [id],
  );

  const assignedDevice = devicesData?.items.find((d) => d.batch_id === id) ?? null;

  return (
    <div className="p-4 max-w-lg lg:max-w-3xl mx-auto space-y-4">
      {loading && <p className="text-muted-foreground">Loading batch details...</p>}
      {error && (
        <div className="text-destructive">
          Couldn't load batch. {error}
          <Button variant="link" size="sm" onClick={refetch}>Try again</Button>
        </div>
      )}

      {batch && (
        <>
          {/* 1. Header — name, type, stage, status */}
          <div>
            <div className="flex justify-between items-start">
              <div>
                <h1 className="font-heading text-xl font-bold">{batch.name}</h1>
                <p className="text-sm text-muted-foreground">
                  {WINE_TYPE_LABELS[batch.wine_type]} &middot; {SOURCE_MATERIAL_LABELS[batch.source_material]}
                </p>
              </div>
              <div className="flex gap-1.5 items-baseline text-sm">
                <span className="text-muted-foreground">{STAGE_LABELS[batch.stage]}</span>
                <span className="text-muted-foreground">&middot;</span>
                <span className="font-medium">{STATUS_LABELS[batch.status]}</span>
              </div>
            </div>
            {/* Secondary actions — demoted */}
            <div className="flex gap-2 mt-2">
              <Link to={`/batches/${id}/edit`}>
                <Button size="sm" variant="ghost" className="h-7 text-xs">Edit</Button>
              </Link>
              <ExportButton batch={batch} />
            </div>
          </div>

          {/* 2. Snapshot card — merged stats + metadata + device */}
          <BatchSnapshot
            batch={batch}
            readings={readingsData?.items ?? []}
            device={assignedDevice}
          />

          {/* Nudges — actionable suggestions for active batches */}
          {batch.status === "active" && batch.nudges && batch.nudges.length > 0 && (
            <NudgeBar nudges={batch.nudges} />
          )}

          {/* 3. Readings chart — hero visual */}
          <ReadingsChart
            readings={readingsData?.items.slice().reverse() ?? []}
            activities={activitiesData?.items}
            batchStartedAt={batch.started_at}
            loading={!readingsData && !error}
            error={null}
          />

          {/* Cellaring card for bottled batches */}
          {batch.cellaring && <CellaringCard cellaring={batch.cellaring} />}

          {/* Projected timeline for active batches */}
          {batch.status === "active" && batch.timeline && batch.timeline.length > 0 && (
            <BatchTimeline milestones={batch.timeline} />
          )}

          {/* 4. Primary actions — promoted */}
          <LifecycleActions
            batch={batch}
            batchId={id!}
            onAction={refetch}
            onDeleted={() => navigate("/")}
          />
        </>
      )}

      {/* 5. Activity timeline */}
      <ActivitySection batchId={id!} batchStatus={batch?.status ?? "active"} onChanged={() => { refetchActivities(); refetchReadings(); }} />

      {/* 6. Notes — collapsed reference */}
      {batch?.notes && (
        <section>
          <button
            className="flex items-center gap-1 text-sm font-semibold w-full text-left"
            onClick={() => setNotesOpen(!notesOpen)}
          >
            <span className="text-muted-foreground">{notesOpen ? "\u25BC" : "\u25B6"}</span>
            Batch Notes
          </button>
          {notesOpen && (
            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{batch.notes}</p>
          )}
        </section>
      )}

      {/* 7. Device management */}
      <DeviceSection batchId={id!} batchStatus={batch?.status ?? "active"} onAssignmentChange={refetch} />
    </div>
  );
}
