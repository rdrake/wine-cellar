import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
import BatchForm from "@/components/BatchForm";
import type { BatchFormData } from "@/components/BatchForm";

export default function BatchEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: batch, loading, error, refetch } = useFetch(
    () => api.batches.get(id!),
    [id],
  );

  async function handleSubmit(data: BatchFormData) {
    await api.batches.update(id!, {
      name: data.name,
      volume_liters: data.volume_liters ? parseFloat(data.volume_liters) : null,
      target_volume_liters: data.target_volume_liters ? parseFloat(data.target_volume_liters) : null,
      notes: data.notes || null,
    });
    navigate(`/batches/${id}`);
  }

  if (loading) return <div className="p-4"><p className="text-muted-foreground">Loading...</p></div>;
  if (error || !batch) return (
    <div className="p-4">
      <p className="text-destructive">{error ?? "Batch not found"}</p>
      <Button variant="link" size="sm" onClick={refetch}>Retry</Button>
    </div>
  );

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-4">Edit Batch</h1>
      <BatchForm
        initial={{
          name: batch.name,
          volume_liters: batch.volume_liters?.toString() ?? "",
          target_volume_liters: batch.target_volume_liters?.toString() ?? "",
          notes: batch.notes ?? "",
        }}
        editMode
        onSubmit={handleSubmit}
        onCancel={() => navigate(`/batches/${id}`)}
        submitLabel="Save Changes"
      />
    </div>
  );
}
