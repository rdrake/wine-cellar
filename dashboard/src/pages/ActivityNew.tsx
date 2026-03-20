import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DetailFields from "@/components/DetailFields";
import type { AllStage, ActivityType, BatchStage } from "@/types";
import { WAYPOINT_ALLOWED_STAGES, STAGE_LABELS, ACTIVITY_TYPE_LABELS } from "@/types";

const ACTIVITY_TYPES: ActivityType[] = ["addition", "measurement", "racking", "tasting", "adjustment", "note"];

export default function ActivityNew() {
  const { id: batchId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: batch, loading: batchLoading, error: batchError, refetch: refetchBatch } = useFetch(
    () => api.batches.get(batchId!),
    [batchId],
  );

  const [stage, setStage] = useState<AllStage | "">("");
  const [type, setType] = useState<ActivityType>("measurement");
  const [title, setTitle] = useState("");
  const [recordedAt, setRecordedAt] = useState(new Date().toISOString().slice(0, 16));
  const [details, setDetails] = useState<Record<string, string>>({ metric: "SG", unit: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (batchLoading) return <div className="p-4"><p className="text-muted-foreground">Loading batch...</p></div>;
  if (batchError || !batch) return (
    <div className="p-4">
      <p className="text-destructive">{batchError ?? "Batch not found"}</p>
      <Button variant="link" size="sm" onClick={refetchBatch}>Retry</Button>
    </div>
  );

  const allowedStages = WAYPOINT_ALLOWED_STAGES[batch.stage as BatchStage] ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stage) return;
    setSubmitting(true);
    setError(null);

    // Convert numeric string values to numbers in details
    const parsedDetails: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(details)) {
      if (v === "") continue;
      const num = Number(v);
      parsedDetails[k] = isNaN(num) ? v : num;
    }

    try {
      await api.activities.create(batchId!, {
        stage: stage as AllStage,
        type,
        title,
        details: Object.keys(parsedDetails).length > 0 ? parsedDetails : null,
        recorded_at: new Date(recordedAt).toISOString(),
      });
      navigate(`/batches/${batchId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't save this activity. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-4">Log Activity</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label>Stage</Label>
          <Select value={stage} onValueChange={(v) => setStage(v as AllStage)}>
            <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
            <SelectContent>
              {allowedStages.map((s) => (
                <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => { setType(v as ActivityType); setDetails({}); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACTIVITY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{ACTIVITY_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Added yeast nutrient" required />
        </div>

        <div className="space-y-2">
          <Label>Recorded At</Label>
          <Input
            type="datetime-local"
            value={recordedAt}
            onChange={(e) => setRecordedAt(e.target.value)}
            required
          />
        </div>

        <DetailFields type={type} details={details} onChange={setDetails} />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => navigate(`/batches/${batchId}`)}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={submitting || !stage}>
            {submitting ? "Saving activity..." : "Log Activity"}
          </Button>
        </div>
      </form>
    </div>
  );
}
