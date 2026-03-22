import { Link } from "react-router-dom";
import { differenceInCalendarDays } from "date-fns";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { parseUtc } from "@/lib/dates";
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
      <p className="text-xs text-muted-foreground mt-1.5 tabular-nums">
        SG {readings[0].gravity.toFixed(3)}
      </p>
    );
  }

  const temps = readings.map((r) => r.temperature).filter((t): t is number => t != null);
  const lastReading = readings[readings.length - 1];

  return (
    <div className="mt-1.5 space-y-0.5">
      <div className="flex items-center gap-2">
        <GravitySparkline values={readings.map((r) => r.gravity)} width={160} height={24} />
        <span className="text-xs tabular-nums text-muted-foreground">
          {lastReading.gravity.toFixed(3)}
        </span>
      </div>
      {temps.length >= 2 && (
        <div className="flex items-center gap-2">
          <TemperatureSparkline values={temps} width={160} height={20} />
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
    <Link to={`/batches/${batch.id}`} className="block py-3 active:bg-accent/50 transition-colors">
      <div className="flex justify-between items-baseline">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className={cn("w-2 h-2 rounded-full shrink-0 translate-y-[-1px]", WINE_TYPE_COLORS[batch.wine_type])} />
          <span className="font-semibold truncate">{batch.name}</span>
        </div>
        <span className="text-xs text-muted-foreground ml-2 shrink-0">
          {STATUS_LABELS[batch.status]} · {STAGE_LABELS[batch.stage]}
        </span>
      </div>
      <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
        {WINE_TYPE_LABELS[batch.wine_type]}
        {batch.volume_liters && <> · {batch.volume_liters} L</>}
        {batch.started_at && <> · Day {differenceInCalendarDays(new Date(), parseUtc(batch.started_at))}</>}
      </p>
      <BatchSparkline batchId={batch.id} />
    </Link>
  );
}
