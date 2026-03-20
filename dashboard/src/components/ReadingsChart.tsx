import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { Reading } from "@/types";
import { useChartColors } from "@/hooks/useChartColors";

interface Props {
  readings: Reading[];
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

export default function ReadingsChart({ readings, loading, error }: Props) {
  const all = readings;
  const colors = useChartColors();

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

  const tickStyle = { fontSize: 10, fill: colors.mutedForeground };
  const tooltipContentStyle = {
    backgroundColor: colors.card,
    borderColor: colors.border,
    color: colors.cardForeground,
  };

  return (
    <section>
      <h2 className="font-semibold mb-2">Readings</h2>

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && all.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No readings yet. Log an SG measurement or assign a RAPT Pill.
        </p>
      )}

      {all.length > 0 && (
        <>
          <div className="h-64 w-full">
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
                  labelFormatter={(v) => fmtDateTime(Number(v))}
                  formatter={(value, name) => {
                    const v = Number(value);
                    if (name === "temperature") return [`${v.toFixed(1)}\u00B0C`, "Temp"];
                    return [v.toFixed(4), name === "gravity" ? "Gravity (device)" : "Gravity (manual)"];
                  }}
                />
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
          {manual.length > 0 && device.length > 0 && (
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-chart-1" /> Device</span>
              <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-chart-1 border-dashed border-t border-chart-1" /><span className="inline-block w-1.5 h-1.5 rounded-full bg-chart-1 -ml-0.5" /> Manual</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
