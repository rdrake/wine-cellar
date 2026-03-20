import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Scatter,
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

  const all = data?.items.slice().reverse() ?? [];
  const device = all.filter((r) => r.source !== "manual");
  const manual = all.filter((r) => r.source === "manual");
  const hasTemp = device.some((r) => r.temperature != null);

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
                  dataKey="source_timestamp"
                  type="category"
                  allowDuplicatedCategory={false}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: string) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                />
                <YAxis
                  yAxisId="gravity"
                  domain={[0.990, 1.125]}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: number) => v.toFixed(3)}
                  label={{ value: "SG", angle: -90, position: "insideLeft", style: { fontSize: 10 } }}
                />
                {hasTemp && (
                  <YAxis
                    yAxisId="temperature"
                    orientation="right"
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 10 }}
                    label={{ value: "\u00B0C", angle: 90, position: "insideRight", style: { fontSize: 10 } }}
                  />
                )}
                <Tooltip
                  labelFormatter={(v) => new Date(String(v)).toLocaleString()}
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
                    stroke="#722F37"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {/* Manual readings as dots */}
                {manual.length > 0 && (
                  <Scatter
                    data={manual}
                    yAxisId="gravity"
                    dataKey="gravity"
                    fill="#722F37"
                    stroke="#fff"
                    strokeWidth={1}
                    r={4}
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
                    stroke="#C5923A"
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
              <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-[#722F37]" /> Device</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[#722F37] border border-white" /> Manual</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
