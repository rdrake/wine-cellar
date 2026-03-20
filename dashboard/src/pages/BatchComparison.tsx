import { useState, useCallback } from "react";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { useChartColors } from "@/hooks/useChartColors";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import type { Batch, Reading } from "@/types";
import { abv, attenuation, velocity, tempStats, daysSince, projectedDaysToTarget } from "@/lib/fermentation";
const MAX_SELECTED = 5;

interface NormalizedPoint {
  hours: number;
  gravity: number;
}

function normalize(readings: Reading[]): NormalizedPoint[] {
  if (!readings.length) return [];
  const sorted = [...readings].sort(
    (a, b) =>
      new Date(a.source_timestamp).getTime() -
      new Date(b.source_timestamp).getTime(),
  );
  const t0 = new Date(sorted[0].source_timestamp).getTime();
  return sorted.map((r) => ({
    hours: (new Date(r.source_timestamp).getTime() - t0) / 3600000,
    gravity: r.gravity,
  }));
}

function batchStats(batch: Batch, readings: Reading[]) {
  if (readings.length === 0) return null;
  const sorted = [...readings].sort(
    (a, b) =>
      new Date(a.source_timestamp).getTime() -
      new Date(b.source_timestamp).getTime(),
  );
  const og = sorted[0].gravity;
  const sg = sorted[sorted.length - 1].gravity;
  const vel = velocity(sorted);
  const temps = tempStats(sorted);
  const days = daysSince(batch.started_at);
  const proj = vel !== null ? projectedDaysToTarget(sg, 0.996, vel) : null;
  return {
    og,
    sg,
    abv: abv(og, sg),
    attenuation: attenuation(og, sg),
    velocity: vel,
    tempMin: temps?.min ?? null,
    tempMax: temps?.max ?? null,
    daysFermenting: days,
    projectedDays: proj,
    name: batch.name,
    readingCount: readings.length,
  };
}

export default function BatchComparison() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [readingsMap, setReadingsMap] = useState<Map<string, Reading[]>>(
    new Map(),
  );
  const colors = useChartColors();
  const COLORS = [colors.chart1, colors.chart2, colors.chart3, colors.chart4, colors.chart5];

  const fetchBatches = useCallback(() => api.batches.list(), []);
  const { data: batchData, loading, error } = useFetch(fetchBatches);

  const batches = batchData?.items ?? [];
  const batchById = new Map<string, Batch>(batches.map((b) => [b.id, b]));

  async function toggle(id: string) {
    if (selectedIds.includes(id)) {
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      setReadingsMap((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    } else if (selectedIds.length < MAX_SELECTED) {
      setSelectedIds((prev) => [...prev, id]);
      try {
        const data = await api.readings.listByBatch(id, { limit: 500 });
        setReadingsMap((prev) => new Map(prev).set(id, data.items));
      } catch {
        /* silently fail */
      }
    }
  }

  // Build per-batch normalized data
  const normalizedMap = new Map<string, NormalizedPoint[]>();
  for (const id of selectedIds) {
    const readings = readingsMap.get(id);
    if (readings) {
      normalizedMap.set(id, normalize(readings));
    }
  }

  // Merge into a single dataset for Recharts: each row has { hours, [batchId]: gravity }
  const merged: Record<string, number>[] = [];
  for (const [batchId, points] of normalizedMap) {
    for (const pt of points) {
      merged.push({ hours: pt.hours, [batchId]: pt.gravity });
    }
  }
  merged.sort((a, b) => a.hours - b.hours);

  const hasData = selectedIds.length > 0 && merged.length > 0;

  return (
    <div className="p-4 max-w-lg lg:max-w-3xl mx-auto space-y-4">
      <h1 className="font-heading text-xl font-bold">Compare Batches</h1>

      {loading && (
        <p className="text-muted-foreground text-sm">Loading batches...</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Batch selector */}
      {batches.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {batches.map((batch) => {
            const isSelected = selectedIds.includes(batch.id);
            const colorIndex = selectedIds.indexOf(batch.id);
            return (
              <button key={batch.id} type="button" onClick={() => toggle(batch.id)}>
                <Badge
                  variant={isSelected ? "default" : "outline"}
                  className="cursor-pointer"
                  style={
                    isSelected
                      ? { backgroundColor: COLORS[colorIndex], borderColor: COLORS[colorIndex] }
                      : undefined
                  }
                >
                  {batch.name}
                </Badge>
              </button>
            );
          })}
        </div>
      )}

      {selectedIds.length >= MAX_SELECTED && (
        <p className="text-xs text-muted-foreground">
          Maximum {MAX_SELECTED} batches selected. Deselect one to add another.
        </p>
      )}

      {/* Chart */}
      {hasData && (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={merged}
              margin={{ top: 5, right: 5, bottom: 5, left: 0 }}
            >
              <XAxis
                dataKey="hours"
                type="number"
                tick={{ fontSize: 10, fill: colors.mutedForeground }}
                tickFormatter={(v: number) => `${Math.round(v)}h`}
              />
              <YAxis
                domain={[0.99, 1.125]}
                tick={{ fontSize: 10, fill: colors.mutedForeground }}
                tickFormatter={(v: number) => v.toFixed(3)}
              />
              <Tooltip
                contentStyle={{ backgroundColor: colors.card, borderColor: colors.border, color: colors.cardForeground }}
                labelStyle={{ color: colors.cardForeground }}
                itemStyle={{ color: colors.cardForeground }}
                labelFormatter={(v) => `${Number(v).toFixed(1)} hours`}
                formatter={(value, name) => {
                  const batch = batchById.get(String(name));
                  return [Number(value).toFixed(4), batch?.name ?? String(name)];
                }}
              />
              {selectedIds.map((id, i) => (
                <Line
                  key={id}
                  data={normalizedMap.get(id)}
                  dataKey="gravity"
                  stroke={COLORS[i]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  name={id}
                  connectNulls
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Stats comparison table */}
      {selectedIds.length > 0 && (() => {
        const allStats = selectedIds.map((id, i) => {
          const batch = batchById.get(id);
          const readings = readingsMap.get(id);
          if (!batch || !readings) return null;
          return { ...batchStats(batch, readings), color: COLORS[i] };
        }).filter(Boolean) as (NonNullable<ReturnType<typeof batchStats>> & { color: string })[];
        if (allStats.length === 0) return null;
        return (
          <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left text-xs text-muted-foreground font-medium p-3 w-[8.5rem]" />
                      {allStats.map((s) => (
                        <th key={s.name} className="text-right font-semibold p-3 max-w-[7rem]">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                            <span className="break-words">{s.name}</span>
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    <tr className="border-b">
                      <td className="text-xs text-muted-foreground p-3">OG</td>
                      {allStats.map((s) => <td key={s.name} className="text-right p-3">{s.og.toFixed(3)}</td>)}
                    </tr>
                    <tr className="border-b">
                      <td className="text-xs text-muted-foreground p-3">Current SG</td>
                      {allStats.map((s) => <td key={s.name} className="text-right p-3">{s.sg.toFixed(3)}</td>)}
                    </tr>
                    <tr className="border-b">
                      <td className="text-xs text-muted-foreground p-3">Est. ABV</td>
                      {allStats.map((s) => <td key={s.name} className="text-right p-3">{s.abv.toFixed(1)}%</td>)}
                    </tr>
                    <tr className="border-b">
                      <td className="text-xs text-muted-foreground p-3">Attenuation</td>
                      {allStats.map((s) => <td key={s.name} className="text-right p-3">{s.attenuation.toFixed(0)}%</td>)}
                    </tr>
                    <tr className="border-b">
                      <td className="text-xs text-muted-foreground p-3">Gravity change (48h)</td>
                      {allStats.map((s) => (
                        <td key={s.name} className="text-right p-3">
                          {s.velocity !== null ? `${s.velocity > 0 ? "+" : ""}${(s.velocity * 1000).toFixed(1)} pts/d` : "—"}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b">
                      <td className="text-xs text-muted-foreground p-3">Days fermenting</td>
                      {allStats.map((s) => <td key={s.name} className="text-right p-3">{s.daysFermenting}</td>)}
                    </tr>
                    <tr className="border-b">
                      <td className="text-xs text-muted-foreground p-3">Est. days to dry</td>
                      {allStats.map((s) => (
                        <td key={s.name} className="text-right p-3">
                          {s.projectedDays !== null && s.projectedDays > 0 ? s.projectedDays : "—"}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b">
                      <td className="text-xs text-muted-foreground p-3">Temp range</td>
                      {allStats.map((s) => (
                        <td key={s.name} className="text-right p-3">
                          {s.tempMin !== null && s.tempMax !== null ? `${s.tempMin.toFixed(1)}–${s.tempMax.toFixed(1)} °C` : "—"}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="text-xs text-muted-foreground p-3">Readings</td>
                      {allStats.map((s) => <td key={s.name} className="text-right p-3">{s.readingCount}</td>)}
                    </tr>
                  </tbody>
                </table>
          </div>
        );
      })()}

      {selectedIds.length === 0 && !loading && batches.length > 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Select up to {MAX_SELECTED} batches above to overlay their
          fermentation curves.
        </p>
      )}
    </div>
  );
}
