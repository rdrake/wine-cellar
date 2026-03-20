import { Link } from "react-router-dom";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { GravitySparkline, TemperatureSparkline } from "@/components/Sparkline";
import { STAGE_LABELS, WINE_TYPE_LABELS } from "@/types";
import type { BatchSummary } from "@/types";
import { attenuation, detectStall } from "@/lib/fermentation";
import { Badge } from "@/components/ui/badge";

function BatchRow({ batch }: { batch: BatchSummary }) {
  const og = batch.first_reading?.gravity;
  const sg = batch.latest_reading?.gravity;
  const att = og && sg ? attenuation(og, sg) : null;
  const gravities = batch.sparkline.map((p) => p.g);
  const temps = batch.sparkline
    .map((p) => (p as any).temp as number | null)
    .filter((t): t is number => t != null);
  const pseudoReadings = batch.sparkline.map((p) => ({
    gravity: p.g,
    source_timestamp: p.t,
  }));
  const stallReason = detectStall(pseudoReadings);

  return (
    <Link to={`/batches/${batch.id}`} className="block active:bg-accent/50 -mx-4 px-4 py-3 transition-colors">
      {/* Row 1: Name + context */}
      <div className="flex justify-between items-baseline">
        <span className="font-semibold truncate">{batch.name}</span>
        <span className="text-xs text-muted-foreground ml-2 shrink-0">
          {WINE_TYPE_LABELS[batch.wine_type]} · {STAGE_LABELS[batch.stage]}
        </span>
      </div>

      {/* Row 2: Sparklines + numbers */}
      {batch.latest_reading ? (
        <div className="mt-1.5 space-y-1">
          {/* Gravity line */}
          <div className="flex items-center gap-2">
            <GravitySparkline values={gravities} width={140} height={24} />
            <span className="text-sm tabular-nums">
              <span className="font-semibold">{sg!.toFixed(3)}</span>
              <span className="text-muted-foreground text-xs"> SG</span>
            </span>
            {att != null && att > 0 && (
              <span className="text-sm tabular-nums">
                <span className="font-semibold">{att.toFixed(0)}</span>
                <span className="text-muted-foreground text-xs">% att</span>
              </span>
            )}
            {batch.velocity !== null && batch.velocity !== 0 && (
              <span className="text-xs text-muted-foreground">
                {(batch.velocity * 1000).toFixed(1)} pts/d
              </span>
            )}
            {stallReason && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                Stall
              </Badge>
            )}
          </div>
          {/* Temperature line */}
          {temps.length >= 2 && (
            <div className="flex items-center gap-2">
              <TemperatureSparkline values={temps} width={140} height={24} />
              <span className="text-sm tabular-nums">
                <span className="font-semibold">{batch.latest_reading.temperature!.toFixed(1)}</span>
                <span className="text-muted-foreground text-xs">{"\u00B0C"}</span>
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mt-1">Day {batch.days_fermenting} · no readings</p>
      )}

      {/* Row 3: Context line */}
      {batch.latest_reading && (
        <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
          Day {batch.days_fermenting}
          {batch.velocity != null && (
            <span>
              {" · "}
              {batch.velocity < -0.0005
                ? `dropping ${Math.abs(batch.velocity * 1000).toFixed(1)} pts/day`
                : batch.velocity > 0.0005
                  ? "rising"
                  : "stable"}
            </span>
          )}
          {og && sg && og !== sg && (
            <span> · {og.toFixed(3)} → {sg.toFixed(3)}</span>
          )}
        </div>
      )}
    </Link>
  );
}

export default function Dashboard() {
  const { data, loading, error } = useFetch(() => api.dashboard(), []);

  return (
    <div className="p-4 max-w-lg mx-auto">
      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {data && (
        <>
          <section>
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Active Batches
            </h2>
            {data.active_batches.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No active batches.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {data.active_batches.map((batch) => (
                  <BatchRow key={batch.id} batch={batch} />
                ))}
              </div>
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Recent Activity
            </h2>
            {data.recent_activities.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No activities logged yet.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {data.recent_activities.map((activity) => (
                  <Link
                    key={activity.id}
                    to={`/batches/${activity.batch_id}`}
                    className="block active:bg-accent/50 -mx-4 px-4 py-2 transition-colors"
                  >
                    <div className="flex justify-between items-baseline text-sm">
                      <span className="truncate">
                        <span className="font-medium">{activity.title}</span>
                        <span className="text-muted-foreground"> · {activity.batch_name}</span>
                      </span>
                      <span className="text-xs text-muted-foreground ml-2 shrink-0 tabular-nums">
                        {new Date(activity.recorded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
