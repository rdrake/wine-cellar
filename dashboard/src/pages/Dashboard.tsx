import { Link } from "react-router-dom";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { GravitySparkline, TemperatureSparkline } from "@/components/Sparkline";
import { STAGE_LABELS, WINE_TYPE_LABELS } from "@/types";
import type { BatchSummary } from "@/types";
import { attenuation, detectStall } from "@/lib/fermentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WINE_TYPE_COLORS: Record<string, string> = {
  red: "bg-red-800",
  white: "bg-amber-300",
  "rosé": "bg-pink-400",
  orange: "bg-orange-400",
  sparkling: "bg-yellow-200",
  dessert: "bg-amber-700",
};

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
        <span className={cn("inline-block w-2.5 h-2.5 rounded-full mr-1.5 shrink-0 translate-y-[-1px]", WINE_TYPE_COLORS[batch.wine_type])} />
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
                Stalled
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
        <p className="text-xs text-muted-foreground mt-1">Day {batch.days_fermenting} · no readings yet</p>
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
    <div className="p-4 max-w-lg lg:max-w-3xl mx-auto">
      {loading && <p className="text-sm text-muted-foreground">Loading your batches...</p>}
      {error && (
        <div className="text-sm text-destructive">
          <p>Couldn't load your dashboard. {error}</p>
          <Button variant="link" size="sm" className="px-0" onClick={() => window.location.reload()}>Try again</Button>
        </div>
      )}

      {data && (
        <>
          <section>
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Active Batches
            </h2>
            {data.active_batches.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No active batches yet. Press + to start your first batch.
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
                No activities yet. Log your first action to start tracking.
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

      <Link to="/batches/new">
        <Button
          size="lg"
          className="fixed bottom-32 right-4 rounded-full w-14 h-14 text-2xl shadow-lg z-40"
        >
          +
        </Button>
      </Link>
    </div>
  );
}
