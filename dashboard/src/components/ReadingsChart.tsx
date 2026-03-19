import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface Props {
  batchId: string;
}

export default function ReadingsChart({ batchId }: Props) {
  const { data, loading, error } = useFetch(
    () => api.readings.listByBatch(batchId, { limit: 500 }),
    [batchId],
  );

  const readings = data?.items.slice().reverse() ?? [];

  return (
    <section>
      <h2 className="font-semibold mb-2">Readings</h2>

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && readings.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No telemetry data yet. Assign a RAPT Pill to start tracking.
        </p>
      )}

      {readings.length > 0 && (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={readings} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="source_timestamp"
                tick={{ fontSize: 10 }}
                tickFormatter={(v: string) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              />
              <YAxis
                yAxisId="gravity"
                domain={["auto", "auto"]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v: number) => v.toFixed(3)}
                label={{ value: "SG", angle: -90, position: "insideLeft", style: { fontSize: 10 } }}
              />
              <YAxis
                yAxisId="temperature"
                orientation="right"
                domain={["auto", "auto"]}
                tick={{ fontSize: 10 }}
                label={{ value: "\u00B0C", angle: 90, position: "insideRight", style: { fontSize: 10 } }}
              />
              <Tooltip
                labelFormatter={(v) => new Date(String(v)).toLocaleString()}
                formatter={(value, name) => {
                  const v = Number(value);
                  return name === "gravity" ? [v.toFixed(4), "Gravity"] : [`${v.toFixed(1)}\u00B0C`, "Temp"];
                }}
              />
              <Line
                yAxisId="gravity"
                type="monotone"
                dataKey="gravity"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
              <Line
                yAxisId="temperature"
                type="monotone"
                dataKey="temperature"
                stroke="hsl(var(--destructive))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
