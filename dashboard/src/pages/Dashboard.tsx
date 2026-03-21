import { useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { GravitySparkline, TemperatureSparkline } from "@/components/Sparkline";
import { STAGE_LABELS, WINE_TYPE_LABELS, ACTIVITY_TYPE_LABELS } from "@/types";
import type { Alert, BatchSummary, Activity } from "@/types";
import { attenuation } from "@/lib/fermentation";
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

// ── Helpers ──────────────────────────────────────────────────────────

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function alertMessage(alert: Alert): string {
  if (alert.context) {
    try {
      const ctx = JSON.parse(alert.context);
      if (ctx.message) return ctx.message;
    } catch { /* ignore */ }
  }
  const labels: Record<string, string> = {
    stall: "Fermentation may have stalled",
    no_readings: "No recent readings",
    temp_high: "High temperature",
    temp_low: "Low temperature",
    stage_suggestion: "Stage change suggested",
  };
  return labels[alert.alert_type] ?? "Needs attention";
}

const ALERT_STYLES: Record<string, string> = {
  stall: "text-destructive",
  no_readings: "text-yellow-600 dark:text-yellow-400",
  temp_high: "text-destructive",
  temp_low: "text-blue-600 dark:text-blue-400",
  stage_suggestion: "text-blue-600 dark:text-blue-400",
};

// ── Summary Stats ────────────────────────────────────────────────────

function SummaryStats({ batches }: { batches: BatchSummary[] }) {
  if (batches.length === 0) return null;

  const totalLiters = batches.reduce((sum, b) => sum + (b.volume_liters ?? 0), 0);
  const minDay = Math.min(...batches.map((b) => b.days_fermenting));
  const maxDay = Math.max(...batches.map((b) => b.days_fermenting));
  const dayRange = minDay === maxDay ? `day ${minDay}` : `day ${minDay}–${maxDay}`;

  return (
    <p className="text-sm tabular-nums py-2 mb-1">
      <span className="font-semibold">{batches.length}</span> {batches.length === 1 ? "batch" : "batches"}
      {totalLiters > 0 && <> · <span className="font-semibold">{totalLiters}</span> L</>}
      {" · "}{dayRange}
    </p>
  );
}

// ── Alerts Section ───────────────────────────────────────────────────

function AlertsSection({ alerts, onDismiss }: { alerts: Alert[]; onDismiss: (id: string) => void }) {
  if (alerts.length === 0) return null;

  return (
    <section className="mb-3">
      <h2 className="text-sm font-semibold mb-1">
        Needs attention
      </h2>
      <div className="space-y-0.5">
        {alerts.map((a) => (
          <div
            key={a.id}
            className="flex items-baseline gap-1.5 py-1.5 -mx-4 px-4"
          >
            <Link
              to={`/batches/${a.batch_id}`}
              className="flex items-baseline gap-1.5 min-w-0 flex-1 active:bg-accent/50 transition-colors"
            >
              <span className={cn("text-sm font-medium shrink-0", ALERT_STYLES[a.alert_type])}>
                {a.batch_name}
              </span>
              <span className="text-sm text-muted-foreground truncate">{alertMessage(a)}</span>
            </Link>
            <button
              type="button"
              onClick={() => onDismiss(a.id)}
              className="text-xs text-muted-foreground hover:text-foreground shrink-0 ml-1"
              aria-label={`Dismiss alert for ${a.batch_name}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Batch Row ────────────────────────────────────────────────────────

function BatchRow({ batch }: { batch: BatchSummary & { _stalled?: boolean } }) {
  const og = batch.first_reading?.gravity;
  const sg = batch.latest_reading?.gravity;
  const att = og && sg ? attenuation(og, sg) : null;
  const gravities = batch.sparkline.map((p) => p.g);
  const temps = batch.sparkline
    .map((p) => (p as any).temp as number | null)
    .filter((t): t is number => t != null);

  return (
    <Link to={`/batches/${batch.id}`} className="block active:bg-accent/50 -mx-4 px-4 py-3 transition-colors">
      {/* Row 1: Name + context */}
      <div className="flex justify-between items-baseline">
        <div className="flex items-baseline min-w-0">
          <span className={cn("inline-block w-2.5 h-2.5 rounded-full mr-1.5 shrink-0 translate-y-[-1px]", WINE_TYPE_COLORS[batch.wine_type])} />
          <span className="font-semibold truncate">{batch.name}</span>
        </div>
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
              <span className="text-xs text-muted-foreground tabular-nums">
                {(batch.velocity * 1000).toFixed(1)} pts/d
              </span>
            )}
            {batch._stalled && (
              <span className="text-xs font-semibold text-destructive">stalled</span>
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
          {" · "}
          <span>{relativeTime(batch.latest_reading.source_timestamp)}</span>
        </div>
      )}
    </Link>
  );
}

// ── Activity Detail Preview ──────────────────────────────────────────

function activityPreview(activity: Activity & { batch_name: string }): string | null {
  if (!activity.details) return null;
  const d = activity.details as Record<string, any>;
  switch (activity.type) {
    case "addition": {
      const parts = [d.chemical];
      if (d.amount != null) parts.push(`${d.amount}${d.unit ? " " + d.unit : ""}`);
      return parts.filter(Boolean).join(" · ") || null;
    }
    case "measurement": {
      if (d.metric == null || d.value == null) return null;
      return `${d.metric}: ${d.value}${d.unit ? " " + d.unit : ""}`;
    }
    case "racking":
      return d.from_vessel && d.to_vessel ? `${d.from_vessel} → ${d.to_vessel}` : null;
    case "adjustment":
      return d.parameter ? `${d.parameter}${d.from_value != null && d.to_value != null ? `: ${d.from_value} → ${d.to_value}` : ""}` : null;
    case "note":
      return d.body ? (d.body.length > 60 ? d.body.slice(0, 57) + "…" : d.body) : null;
    default:
      return null;
  }
}

// ── Main Dashboard ───────────────────────────────────────────────────

export default function Dashboard() {
  const { data, loading, error, refetch } = useFetch(() => api.dashboard(), []);

  async function handleDismiss(alertId: string) {
    await api.alerts.dismiss(alertId);
    refetch();
  }

  // Sort batches: stalled first, then by days fermenting descending
  const sortedBatches = useMemo(() => {
    if (!data) return [];
    const alerts = data.alerts;
    const stalledIds = new Set(alerts.filter((a) => a.alert_type === "stall").map((a) => a.batch_id));
    const noReadingIds = new Set(alerts.filter((a) => a.alert_type === "no_readings").map((a) => a.batch_id));

    return [...data.active_batches]
      .map((b) => ({ ...b, _stalled: stalledIds.has(b.id) }))
      .sort((a, b) => {
        // Stalled first
        if (a._stalled !== b._stalled) return a._stalled ? -1 : 1;
        // No readings next
        const aNoRead = noReadingIds.has(a.id);
        const bNoRead = noReadingIds.has(b.id);
        if (aNoRead !== bNoRead) return aNoRead ? -1 : 1;
        // Then by days fermenting descending
        return b.days_fermenting - a.days_fermenting;
      });
  }, [data]);

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
          {/* Summary stats */}
          <SummaryStats batches={data.active_batches} />

          {/* Alerts */}
          <AlertsSection alerts={data.alerts} onDismiss={handleDismiss} />

          {/* Active Batches */}
          <section>
            <h2 className="text-sm font-semibold mb-1">
              Active batches
            </h2>
            {sortedBatches.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No active batches yet. Press + to start your first batch.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {sortedBatches.map((batch) => (
                  <BatchRow key={batch.id} batch={batch} />
                ))}
              </div>
            )}
          </section>

          {/* Recent Activity */}
          <section className="mt-5">
            <h2 className="text-sm font-semibold mb-1">
              Recent activity
            </h2>
            {data.recent_activities.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No activities yet. Log your first action to start tracking.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {data.recent_activities.map((activity) => {
                  const preview = activityPreview(activity);
                  return (
                    <Link
                      key={activity.id}
                      to={`/batches/${activity.batch_id}`}
                      className="block active:bg-accent/50 -mx-4 px-4 py-2 transition-colors"
                    >
                      <div className="flex justify-between items-baseline text-sm">
                        <span className="flex items-baseline gap-1.5 truncate">
                          <span className="font-medium">{activity.title}</span>
                          <span className="text-muted-foreground">· {activity.batch_name}</span>
                        </span>
                        <span className="text-xs text-muted-foreground ml-2 shrink-0 tabular-nums">
                          {relativeTime(activity.recorded_at)}
                        </span>
                      </div>
                      {preview && (
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {ACTIVITY_TYPE_LABELS[activity.type]} · {preview}
                        </div>
                      )}
                    </Link>
                  );
                })}
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
