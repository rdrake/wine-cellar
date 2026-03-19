import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WineType, SourceMaterial } from "@/types";
import { WINE_TYPE_LABELS, SOURCE_MATERIAL_LABELS } from "@/types";

const WINE_TYPES = Object.entries(WINE_TYPE_LABELS) as [WineType, string][];
const SOURCE_MATERIALS = Object.entries(SOURCE_MATERIAL_LABELS) as [SourceMaterial, string][];

export interface BatchFormData {
  name: string;
  wine_type: WineType;
  source_material: SourceMaterial;
  started_at: string;
  volume_liters: string;
  target_volume_liters: string;
  notes: string;
}

interface Props {
  initial?: Partial<BatchFormData>;
  /** Hide fields that aren't editable on existing batches */
  editMode?: boolean;
  onSubmit: (data: BatchFormData) => Promise<void>;
  onCancel?: () => void;
  submitLabel: string;
}

export default function BatchForm({ initial, editMode, onSubmit, onCancel, submitLabel }: Props) {
  const [form, setForm] = useState<BatchFormData>({
    name: initial?.name ?? "",
    wine_type: initial?.wine_type ?? "red",
    source_material: initial?.source_material ?? "kit",
    started_at: initial?.started_at ?? new Date().toISOString().slice(0, 16),
    volume_liters: initial?.volume_liters ?? "",
    target_volume_liters: initial?.target_volume_liters ?? "",
    notes: initial?.notes ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof BatchFormData>(key: K, value: BatchFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
      </div>

      {!editMode && (
        <>
          <div className="space-y-2">
            <Label htmlFor="wine_type">Wine Type</Label>
            <Select value={form.wine_type} onValueChange={(v) => set("wine_type", v as WineType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {WINE_TYPES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="source_material">Source Material</Label>
            <Select value={form.source_material} onValueChange={(v) => set("source_material", v as SourceMaterial)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOURCE_MATERIALS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="started_at">Start Date</Label>
            <Input
              id="started_at"
              type="datetime-local"
              value={form.started_at}
              onChange={(e) => set("started_at", e.target.value)}
              required
            />
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="volume">Volume (L)</Label>
          <Input
            id="volume"
            type="number"
            step="0.1"
            value={form.volume_liters}
            onChange={(e) => set("volume_liters", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="target_volume">Target Vol (L)</Label>
          <Input
            id="target_volume"
            type="number"
            step="0.1"
            value={form.target_volume_liters}
            onChange={(e) => set("target_volume_liters", e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        {onCancel && (
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" className="flex-1" disabled={submitting}>
          {submitting ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
