import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { GravitySparkline, TemperatureSparkline } from "@/components/Sparkline";
import { cn } from "@/lib/utils";
import type { Batch } from "@/types";
import { STAGE_LABELS, WINE_TYPE_LABELS, STATUS_LABELS } from "@/types";

const WINE_TYPE_COLORS: Record<string, string> = {
  red: "bg-red-800",
  white: "bg-amber-300",
  "rosé": "bg-pink-400",
  orange: "bg-orange-400",
  sparkling: "bg-yellow-200",
  dessert: "bg-amber-700",
};

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

  const temps = readings.map((r) => r.temperature).filter((t): t is number => t != null);
  const lastReading = readings[readings.length - 1];

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-2">
        <GravitySparkline values={readings.map((r) => r.gravity)} width={160} height={28} />
        <span className="text-xs tabular-nums text-muted-foreground">
          {lastReading.gravity.toFixed(3)}
        </span>
      </div>
      {temps.length >= 2 && (
        <div className="flex items-center gap-2">
          <TemperatureSparkline values={temps} width={160} height={24} />
          <span className="text-xs tabular-nums text-muted-foreground">
            {temps[temps.length - 1].toFixed(1)}{"\u00B0C"}
          </span>
        </div>
      )}
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
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", WINE_TYPE_COLORS[batch.wine_type])} />
                <h3 className="font-semibold truncate">{batch.name}</h3>
              </div>
              <p className="text-sm text-muted-foreground">{WINE_TYPE_LABELS[batch.wine_type]}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {batch.volume_liters && `${batch.volume_liters} L`}
                {batch.volume_liters && batch.started_at && " · "}
                {batch.started_at && `Day ${Math.floor((Date.now() - new Date(batch.started_at).getTime()) / 86400000)}`}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div style={{ marginBottom: 12 }}>
                <Badge variant="outline" className="text-xs">
                  {STATUS_LABELS[batch.status]}
                </Badge>
              </div>
              <div>
                <Badge variant="secondary" className="text-xs">
                  {STAGE_LABELS[batch.stage]}
                </Badge>
              </div>
            </div>
          </div>
          <BatchSparkline batchId={batch.id} />
        </CardContent>
      </Card>
    </Link>
  );
}
