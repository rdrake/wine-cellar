import { useState, useCallback } from "react";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { useChartColors } from "@/hooks/useChartColors";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { Batch, Reading } from "@/types";
import { abv, attenuation } from "@/lib/fermentation";
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
  return {
    og,
    sg,
    abv: abv(og, sg),
    attenuation: attenuation(og, sg),
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
    <div className="p-4 max-w-lg lg:max-w-3xl mx-auto space-y-6">
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
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="hours"
                type="number"
                tick={{ fontSize: 10, fill: colors.mutedForeground }}
                tickFormatter={(v: number) => `${Math.round(v)}h`}
                label={{
                  value: "Hours since first reading",
                  position: "insideBottom",
                  offset: -2,
                  style: { fontSize: 10, fill: colors.mutedForeground },
                }}
              />
              <YAxis
                domain={[0.99, 1.125]}
                tick={{ fontSize: 10, fill: colors.mutedForeground }}
                tickFormatter={(v: number) => v.toFixed(3)}
                label={{
                  value: "SG",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 10, fill: colors.mutedForeground },
                }}
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

      {/* Legend */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {selectedIds.map((id, i) => {
            const batch = batchById.get(id);
            return (
              <span key={id} className="flex items-center gap-1">
                <span
                  className="inline-block w-3 h-0.5"
                  style={{ backgroundColor: COLORS[i] }}
                />
                {batch?.name ?? id}
              </span>
            );
          })}
        </div>
      )}

      {/* Per-batch stats */}
      {selectedIds.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-sm">Stats</h2>
          {selectedIds.map((id, i) => {
            const batch = batchById.get(id);
            const readings = readingsMap.get(id);
            if (!batch || !readings) return null;
            const stats = batchStats(batch, readings);
            if (!stats) return null;
            return (
              <Card key={id}>
                <CardContent className="p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{ backgroundColor: COLORS[i] }}
                    />
                    <span className="font-semibold">{stats.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">OG → SG</span>
                    <span className="tabular-nums">
                      {stats.og.toFixed(3)} → {stats.sg.toFixed(3)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ABV</span>
                    <span className="tabular-nums">
                      {stats.abv.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Attenuation</span>
                    <span className="tabular-nums">
                      {stats.attenuation.toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Readings</span>
                    <span className="tabular-nums">{stats.readingCount}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {selectedIds.length === 0 && !loading && batches.length > 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Select up to {MAX_SELECTED} batches above to overlay their
          fermentation curves.
        </p>
      )}
    </div>
  );
}
