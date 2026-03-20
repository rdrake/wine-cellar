import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import type { Reading, Activity } from "@/types";
import { useChartColors } from "@/hooks/useChartColors";
import { Button } from "@/components/ui/button";

type TimeRange = "7d" | "14d" | "all";

interface Props {
  readings: Reading[];
  activities?: Activity[];
  batchStartedAt?: string;
  loading?: boolean;
  error?: string | null;
}

function toEpoch(ts: string) {
  return new Date(ts).getTime();
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDateTime(ms: number) {
  return new Date(ms).toLocaleString();
}

const ACTIVITY_COLORS: Record<string, string> = {
  addition: "var(--color-chart-3)",
  racking: "var(--color-chart-4)",
  adjustment: "var(--color-chart-5)",
  measurement: "var(--color-chart-2)",
  tasting: "var(--color-chart-3)",
  note: "var(--color-chart-2)",
};

export default function ReadingsChart({ readings, activities, batchStartedAt, loading, error }: Props) {
  const [range, setRange] = useState<TimeRange>("all");
  const colors = useChartColors();

  const batchStart = batchStartedAt ? toEpoch(batchStartedAt) : null;

  const filtered = useMemo(() => {
    if (range === "all") return readings;
    const days = range === "7d" ? 7 : 14;
    const cutoff = Date.now() - days * 86400000;
    return readings.filter((r) => toEpoch(r.source_timestamp) > cutoff);
  }, [readings, range]);

  const all = filtered;

  const { device, manual, hasTemp, domain } = useMemo(() => {
    const dev: (Reading & { t: number })[] = [];
    const man: (Reading & { t: number })[] = [];
    let temp = false;
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const r of all) {
      const t = toEpoch(r.source_timestamp);
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
      const row = { ...r, t };
      if (r.source === "manual") man.push(row);
      else {
        if (r.temperature != null) temp = true;
        dev.push(row);
      }
    }
    if (tMin === Infinity) tMin = tMax = 0;
    const pad = Math.max((tMax - tMin) * 0.02, 3600000);
    return { device: dev, manual: man, hasTemp: temp, domain: [tMin - pad, tMax + pad] as [number, number] };
  }, [all]);

  // Activity markers within the visible time domain
  const markers = useMemo(() => {
    if (!activities?.length) return [];
    return activities
      .map((a) => ({ ...a, t: toEpoch(a.recorded_at) }))
      .filter((a) => a.t >= domain[0] && a.t <= domain[1]);
  }, [activities, domain]);

  const tickStyle = { fontSize: 10, fill: colors.mutedForeground };
  const tooltipContentStyle = {
    backgroundColor: colors.card,
    borderColor: colors.border,
    color: colors.cardForeground,
  };

  const dayLabel = (ms: number) => {
    if (!batchStart) return "";
    const days = Math.floor((ms - batchStart) / 86400000);
    return days >= 0 ? ` · Day ${days}` : "";
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Readings</h2>
        {readings.length > 0 && (
          <div className="flex gap-1">
            {(["7d", "14d", "all"] as const).map((r) => (
              <Button
                key={r}
                size="sm"
                variant={range === r ? "default" : "ghost"}
                className="h-6 px-2 text-xs"
                onClick={() => setRange(r)}
              >
                {r === "all" ? "All" : r.toUpperCase()}
              </Button>
            ))}
          </div>
        )}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && readings.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No readings yet. Log an SG measurement or assign a RAPT Pill.
        </p>
      )}

      {readings.length > 0 && all.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No readings in the last {range === "7d" ? "7" : "14"} days. Try a wider range.
        </p>
      )}

      {all.length > 0 && (
        <>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={domain}
                  allowDuplicatedCategory={false}
                  tick={tickStyle}
                  tickFormatter={(v: number) => fmtDate(v)}
                />
                <YAxis
                  yAxisId="gravity"
                  domain={[0.990, 1.125]}
                  tick={tickStyle}
                  tickFormatter={(v: number) => v.toFixed(3)}
                  label={{ value: "SG", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: colors.mutedForeground } }}
                />
                {hasTemp && (
                  <YAxis
                    yAxisId="temperature"
                    orientation="right"
                    domain={["auto", "auto"]}
                    tick={tickStyle}
                    label={{ value: "\u00B0C", angle: 90, position: "insideRight", style: { fontSize: 10, fill: colors.mutedForeground } }}
                  />
                )}
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={{ color: colors.cardForeground }}
                  itemStyle={{ color: colors.cardForeground }}
                  labelFormatter={(v) => `${fmtDateTime(Number(v))}${dayLabel(Number(v))}`}
                  formatter={(value, name) => {
                    const v = Number(value);
                    if (name === "temperature") return [`${v.toFixed(1)}\u00B0C`, "Temp"];
                    return [v.toFixed(4), name === "gravity" ? "Gravity (device)" : "Gravity (manual)"];
                  }}
                />
                {/* Activity markers */}
                {markers.map((a) => (
                  <ReferenceLine
                    key={a.id}
                    x={a.t}
                    yAxisId="gravity"
                    stroke={ACTIVITY_COLORS[a.type] ?? colors.mutedForeground}
                    strokeDasharray="4 3"
                    strokeWidth={1}
                    label={{
                      value: a.title.length > 20 ? a.title.slice(0, 18) + "…" : a.title,
                      position: "insideTopRight",
                      style: { fontSize: 9, fill: colors.mutedForeground },
                    }}
                  />
                ))}
                {/* Device readings as a line */}
                {device.length > 0 && (
                  <Line
                    data={device}
                    yAxisId="gravity"
                    type="monotone"
                    dataKey="gravity"
                    stroke={colors.chart1}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {/* Manual readings as line with dots */}
                {manual.length > 0 && (
                  <Line
                    data={manual}
                    yAxisId="gravity"
                    type="monotone"
                    dataKey="gravity"
                    stroke={colors.chart1}
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={{ fill: colors.chart1, stroke: colors.card, strokeWidth: 1, r: 3 }}
                    isAnimationActive={false}
                    name="manual_gravity"
                  />
                )}
                {/* Temperature line (device only) */}
                {hasTemp && device.length > 0 && (
                  <Line
                    data={device}
                    yAxisId="temperature"
                    type="monotone"
                    dataKey="temperature"
                    stroke={colors.chart2}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
            {device.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-4 h-0.5 bg-chart-1" /> Device
              </span>
            )}
            {manual.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-4 h-0.5 bg-chart-1 border-dashed border-t border-chart-1" />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-chart-1 -ml-0.5" /> Manual
              </span>
            )}
            {hasTemp && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-4 h-0.5 bg-chart-2" /> Temperature
              </span>
            )}
            {markers.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-4 h-0 border-t border-dashed border-muted-foreground" /> Activity
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
