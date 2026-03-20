import { useState } from "react";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { readingsToCSV, activitiesToCSV, downloadCSV } from "@/lib/csv";
import { toast } from "sonner";
import type { Batch } from "@/types";

export default function ExportButton({ batch }: { batch: Batch }) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const [readings, activities] = await Promise.all([
        api.readings.listByBatch(batch.id, { limit: 500 }),
        api.activities.list(batch.id),
      ]);

      const slug = batch.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

      if (readings.items.length > 0) {
        downloadCSV(readingsToCSV(readings.items), `${slug}-readings.csv`);
      }
      if (activities.items.length > 0) {
        downloadCSV(activitiesToCSV(activities.items), `${slug}-activities.csv`);
      }

      toast.success(`Exported ${readings.items.length} readings, ${activities.items.length} activities`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={exporting} onClick={handleExport}>
      {exporting ? "Exporting..." : "Export CSV"}
    </Button>
  );
}
