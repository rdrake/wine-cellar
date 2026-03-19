import { useNavigate } from "react-router-dom";
import { api } from "@/api";
import BatchForm from "@/components/BatchForm";
import type { BatchFormData } from "@/components/BatchForm";

export default function BatchNew() {
  const navigate = useNavigate();

  async function handleSubmit(data: BatchFormData) {
    const batch = await api.batches.create({
      name: data.name,
      wine_type: data.wine_type,
      source_material: data.source_material,
      started_at: new Date(data.started_at).toISOString(),
      volume_liters: data.volume_liters ? parseFloat(data.volume_liters) : null,
      target_volume_liters: data.target_volume_liters ? parseFloat(data.target_volume_liters) : null,
      notes: data.notes || null,
    });
    navigate(`/batches/${batch.id}`);
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-4">New Batch</h1>
      <BatchForm onSubmit={handleSubmit} submitLabel="Create Batch" />
    </div>
  );
}
