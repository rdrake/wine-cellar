import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { GravitySparkline } from "@/components/Sparkline";
import type { Batch } from "@/types";
import { STAGE_LABELS, WINE_TYPE_LABELS, STATUS_LABELS } from "@/types";

function BatchSparkline({ batchId }: { batchId: string }) {
  const { data } = useFetch(
    () => api.readings.listByBatch(batchId, { limit: 100 }),
    [batchId],
  );

  const readings = data?.items.slice().reverse() ?? [];
  if (readings.length === 0) return null;

  if (readings.length === 1) {
    return (
      <p className="text-xs text-muted-foreground mt-2">
        SG {readings[0].gravity.toFixed(3)}
      </p>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <GravitySparkline values={readings.map((r) => r.gravity)} width={160} height={28} />
      <span className="text-xs tabular-nums text-muted-foreground">
        {readings[readings.length - 1].gravity.toFixed(3)}
      </span>
    </div>
  );
}

export default function BatchCard({ batch }: { batch: Batch }) {
  return (
    <Link to={`/batches/${batch.id}`}>
      <Card className="active:bg-accent transition-colors">
        <CardContent className="p-4">
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold truncate">{batch.name}</h3>
              <p className="text-sm text-muted-foreground">{WINE_TYPE_LABELS[batch.wine_type]}</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Badge variant="outline" className="text-xs">
                {STATUS_LABELS[batch.status]}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {STAGE_LABELS[batch.stage]}
              </Badge>
            </div>
          </div>
          <BatchSparkline batchId={batch.id} />
        </CardContent>
      </Card>
    </Link>
  );
}
