import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AllStage, ActivityType, BatchStage } from "@/types";
import { WAYPOINT_ALLOWED_STAGES, STAGE_LABELS, ACTIVITY_TYPE_LABELS } from "@/types";

const ACTIVITY_TYPES: ActivityType[] = ["addition", "measurement", "racking", "tasting", "adjustment", "note"];

function DetailFields({ type, details, onChange }: {
  type: ActivityType;
  details: Record<string, string>;
  onChange: (details: Record<string, string>) => void;
}) {
  function set(key: string, value: string) {
    onChange({ ...details, [key]: value });
  }

  switch (type) {
    case "addition":
      return (
        <>
          <div className="space-y-2">
            <Label>Chemical</Label>
            <Input value={details.chemical ?? ""} onChange={(e) => set("chemical", e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" step="0.01" value={details.amount ?? ""} onChange={(e) => set("amount", e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Input value={details.unit ?? ""} placeholder="tsp, g, mL" onChange={(e) => set("unit", e.target.value)} required />
            </div>
          </div>
        </>
      );
    case "measurement":
      return (
        <>
          <div className="space-y-2">
            <Label>Metric</Label>
            <Select value={details.metric ?? ""} onValueChange={(v) => v && set("metric", v)}>
              <SelectTrigger><SelectValue placeholder="Select metric" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SG">Specific Gravity (SG)</SelectItem>
                <SelectItem value="pH">pH</SelectItem>
                <SelectItem value="TA">Titratable Acidity (TA)</SelectItem>
                <SelectItem value="SO2">Free SO2</SelectItem>
                <SelectItem value="Brix">Brix</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {details.metric === "other" && (
            <div className="space-y-2">
              <Label>Metric Name</Label>
              <Input value={details.metric_name ?? ""} onChange={(e) => set("metric_name", e.target.value)} required />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Value</Label>
              <Input type="number" step="0.001" value={details.value ?? ""} onChange={(e) => set("value", e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Input value={details.unit ?? ""} placeholder={details.metric === "SG" || details.metric === "pH" ? "optional" : "g/L, ppm, etc."} onChange={(e) => set("unit", e.target.value)} />
            </div>
          </div>
        </>
      );
    case "racking":
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>From Vessel</Label>
            <Input value={details.from_vessel ?? ""} onChange={(e) => set("from_vessel", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>To Vessel</Label>
            <Input value={details.to_vessel ?? ""} onChange={(e) => set("to_vessel", e.target.value)} required />
          </div>
        </div>
      );
    case "tasting":
      return (
        <>
          <div className="space-y-2">
            <Label>Aroma</Label>
            <Input value={details.aroma ?? ""} onChange={(e) => set("aroma", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Flavor</Label>
            <Input value={details.flavor ?? ""} onChange={(e) => set("flavor", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Appearance</Label>
            <Input value={details.appearance ?? ""} onChange={(e) => set("appearance", e.target.value)} required />
          </div>
        </>
      );
    case "adjustment":
      return (
        <>
          <div className="space-y-2">
            <Label>Parameter</Label>
            <Input value={details.parameter ?? ""} onChange={(e) => set("parameter", e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>From Value</Label>
              <Input type="number" step="0.01" value={details.from_value ?? ""} onChange={(e) => set("from_value", e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>To Value</Label>
              <Input type="number" step="0.01" value={details.to_value ?? ""} onChange={(e) => set("to_value", e.target.value)} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Unit</Label>
            <Input value={details.unit ?? ""} onChange={(e) => set("unit", e.target.value)} required />
          </div>
        </>
      );
    case "note":
      return null;
  }
}

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

  if (batchLoading) return <div className="p-4"><p className="text-muted-foreground">Loading...</p></div>;
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
      setError(err instanceof Error ? err.message : "Something went wrong");
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
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
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
            {submitting ? "Saving..." : "Log Activity"}
          </Button>
        </div>
      </form>
    </div>
  );
}
