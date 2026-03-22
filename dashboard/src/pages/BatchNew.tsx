import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api";
import BatchForm from "@/components/BatchForm";
import type { BatchFormData } from "@/components/BatchForm";
import type { WineType, SourceMaterial } from "@/types";

interface Template {
  label: string;
  emoji: string;
  wine_type: WineType;
  source_material: SourceMaterial;
  volume: string;
  target_volume: string;
}

const TEMPLATES: Template[] = [
  { label: "Red from grapes", emoji: "🍇", wine_type: "red", source_material: "fresh_grapes", volume: "50", target_volume: "45" },
  { label: "White from grapes", emoji: "🥂", wine_type: "white", source_material: "fresh_grapes", volume: "50", target_volume: "45" },
  { label: "Rosé from grapes", emoji: "🌸", wine_type: "rosé", source_material: "fresh_grapes", volume: "50", target_volume: "45" },
  { label: "Red wine kit", emoji: "📦", wine_type: "red", source_material: "kit", volume: "23", target_volume: "23" },
  { label: "White wine kit", emoji: "📦", wine_type: "white", source_material: "kit", volume: "23", target_volume: "23" },
  { label: "Juice bucket", emoji: "🪣", wine_type: "white", source_material: "juice_bucket", volume: "23", target_volume: "23" },
];

export default function BatchNew() {
  const navigate = useNavigate();
  const [initial, setInitial] = useState<Partial<BatchFormData> | undefined>();
  const [formKey, setFormKey] = useState(0);

  function applyTemplate(t: Template) {
    setInitial({
      wine_type: t.wine_type,
      source_material: t.source_material,
      volume_liters: t.volume,
      target_volume_liters: t.target_volume,
    });
    setFormKey((k) => k + 1);
  }

  async function handleSubmit(data: BatchFormData) {
    const batch = await api.batches.create({
      name: data.name,
      wine_type: data.wine_type,
      source_material: data.source_material,
      started_at: new Date(data.started_at).toISOString(),
      volume_liters: data.volume_liters ? parseFloat(data.volume_liters) : null,
      target_volume_liters: data.target_volume_liters ? parseFloat(data.target_volume_liters) : null,
      notes: data.notes || null,
      yeast_strain: data.yeast_strain || null,
      oak_type: data.oak_type || null,
      oak_format: data.oak_format || null,
      oak_duration_days: data.oak_duration_days ? parseInt(data.oak_duration_days) : null,
      mlf_status: data.mlf_status || null,
    });
    navigate(`/batches/${batch.id}`);
  }

  return (
    <div className="p-4 max-w-lg mx-auto space-y-5">
      <h1 className="text-xl font-bold">New Batch</h1>

      <div>
        <p className="text-xs text-muted-foreground mb-2">Quick start from a template</p>
        <div className="grid grid-cols-3 gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              className="border rounded-lg p-2.5 text-left text-xs hover:bg-accent transition-colors"
              onClick={() => applyTemplate(t)}
            >
              <span className="text-base">{t.emoji}</span>
              <span className="block mt-0.5 font-medium leading-tight">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <BatchForm
        key={formKey}
        initial={initial}
        onSubmit={handleSubmit}
        onCancel={() => navigate("/")}
        submitLabel="Create Batch"
      />
    </div>
  );
}
