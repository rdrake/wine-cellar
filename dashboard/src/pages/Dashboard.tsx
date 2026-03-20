import { useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { GravitySparkline, TemperatureSparkline } from "@/components/Sparkline";
import { STAGE_LABELS, WINE_TYPE_LABELS, ACTIVITY_TYPE_LABELS } from "@/types";
import type { BatchSummary, Activity } from "@/types";
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

const ACTIVITY_TYPE_COLORS: Record<string, string> = {
  addition: "bg-chart-3",
  racking: "bg-chart-4",
  measurement: "bg-chart-2",
  tasting: "bg-chart-3",
  adjustment: "bg-chart-5",
  note: "bg-chart-2",
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

function hoursAgo(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / 3600000;
}

interface Alert {
  batchId: string;
  batchName: string;
  type: "stall" | "no_readings" | "temp_high" | "temp_low";
  message: string;
}

function deriveAlerts(batches: BatchSummary[]): Alert[] {
  const alerts: Alert[] = [];
  for (const b of batches) {
    // Stall detection
    const pseudoReadings = b.sparkline.map((p) => ({
      gravity: p.g,
      source_timestamp: p.t,
    }));
    const stallReason = detectStall(pseudoReadings);
    if (stallReason) {
      alerts.push({ batchId: b.id, batchName: b.name, type: "stall", message: stallReason });
    }

    // No recent readings (>48h with a device presumably assigned)
    if (b.latest_reading && hoursAgo(b.latest_reading.source_timestamp) > 48) {
      const ago = relativeTime(b.latest_reading.source_timestamp);
      alerts.push({ batchId: b.id, batchName: b.name, type: "no_readings", message: `Last reading ${ago}` });
    }

    // Temperature warnings
    if (b.latest_reading?.temperature != null) {
      const t = b.latest_reading.temperature;
      if (t >= 30) {
        alerts.push({ batchId: b.id, batchName: b.name, type: "temp_high", message: `${t.toFixed(1)}\u00B0C — high temperature` });
      } else if (t <= 8) {
        alerts.push({ batchId: b.id, batchName: b.name, type: "temp_low", message: `${t.toFixed(1)}\u00B0C — low temperature` });
      }
    }
  }
  return alerts;
}

const ALERT_STYLES: Record<Alert["type"], string> = {
  stall: "text-destructive",
  no_readings: "text-yellow-600 dark:text-yellow-400",
  temp_high: "text-destructive",
  temp_low: "text-blue-600 dark:text-blue-400",
};

const ALERT_ICONS: Record<Alert["type"], string> = {
  stall: "\u26A0",     // ⚠
  no_readings: "\u23F1", // ⏱
  temp_high: "\uD83C\uDF21",  // 🌡
  temp_low: "\u2744",  // ❄
};

// ── Summary Stats ────────────────────────────────────────────────────

function SummaryStats({ batches }: { batches: BatchSummary[] }) {
  if (batches.length === 0) return null;

  const totalLiters = batches.reduce((sum, b) => sum + (b.volume_liters ?? 0), 0);
  const stages = new Set(batches.map((b) => b.stage));
  const minDay = Math.min(...batches.map((b) => b.days_fermenting));
  const maxDay = Math.max(...batches.map((b) => b.days_fermenting));
  const dayRange = minDay === maxDay ? `Day ${minDay}` : `Day ${minDay}–${maxDay}`;

  return (
    <div className="flex gap-4 text-center py-3 mb-2">
      <div className="flex-1">
        <div className="text-2xl font-bold tabular-nums">{batches.length}</div>
        <div className="text-xs text-muted-foreground">{batches.length === 1 ? "Batch" : "Batches"}</div>
      </div>
      {totalLiters > 0 && (
        <div className="flex-1">
          <div className="text-2xl font-bold tabular-nums">{totalLiters}</div>
          <div className="text-xs text-muted-foreground">Litres</div>
        </div>
      )}
      <div className="flex-1">
        <div className="text-2xl font-bold tabular-nums">{stages.size}</div>
        <div className="text-xs text-muted-foreground">{stages.size === 1 ? "Stage" : "Stages"}</div>
      </div>
      <div className="flex-1">
        <div className="text-lg font-bold tabular-nums leading-8">{dayRange}</div>
        <div className="text-xs text-muted-foreground">Fermenting</div>
      </div>
    </div>
  );
}

// ── Alerts Section ───────────────────────────────────────────────────

function AlertsSection({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;

  return (
    <section className="mb-4">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
        Needs Attention
      </h2>
      <div className="space-y-1">
        {alerts.map((a, i) => (
          <Link
            key={`${a.batchId}-${a.type}-${i}`}
            to={`/batches/${a.batchId}`}
            className="flex items-center gap-2 py-1.5 -mx-4 px-4 active:bg-accent/50 transition-colors"
          >
            <span className="text-sm">{ALERT_ICONS[a.type]}</span>
            <span className={cn("text-sm font-medium", ALERT_STYLES[a.type])}>
              {a.batchName}
            </span>
            <span className="text-sm text-muted-foreground">{a.message}</span>
          </Link>
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
              <span className="text-xs text-muted-foreground">
                {(batch.velocity * 1000).toFixed(1)} pts/d
              </span>
            )}
            {batch._stalled && (
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
          {" · "}
          <span>{relativeTime(batch.latest_reading.source_timestamp)}</span>
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
  const { data, loading, error } = useFetch(() => api.dashboard(), []);

  // Sort batches: stalled first, then by days fermenting descending
  const { sortedBatches, alerts } = useMemo(() => {
    if (!data) return { sortedBatches: [], alerts: [] };
    const alerts = deriveAlerts(data.active_batches);
    const stalledIds = new Set(alerts.filter((a) => a.type === "stall").map((a) => a.batchId));
    const noReadingIds = new Set(alerts.filter((a) => a.type === "no_readings").map((a) => a.batchId));

    const sorted = [...data.active_batches]
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
    return { sortedBatches: sorted, alerts };
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
          <AlertsSection alerts={alerts} />

          {/* Active Batches */}
          <section>
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Active Batches
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
                {data.recent_activities.map((activity) => {
                  const preview = activityPreview(activity);
                  return (
                    <Link
                      key={activity.id}
                      to={`/batches/${activity.batch_id}`}
                      className="block active:bg-accent/50 -mx-4 px-4 py-2 transition-colors"
                    >
                      <div className="flex justify-between items-baseline text-sm">
                        <span className="flex items-center gap-1.5 truncate">
                          <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", ACTIVITY_TYPE_COLORS[activity.type] ?? "bg-muted-foreground")} />
                          <span className="font-medium">{activity.title}</span>
                          <span className="text-muted-foreground"> · {activity.batch_name}</span>
                        </span>
                        <span className="text-xs text-muted-foreground ml-2 shrink-0 tabular-nums">
                          {relativeTime(activity.recorded_at)}
                        </span>
                      </div>
                      {preview && (
                        <div className="text-xs text-muted-foreground mt-0.5 ml-3.5 truncate">
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
