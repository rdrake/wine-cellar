import { Card, CardContent } from "@/components/ui/card";
import { abv, attenuation, velocity, tempStats, daysSince, projectedDaysToTarget } from "@/lib/fermentation";
import type { Batch, Reading } from "@/types";

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">
        {value}
        {unit && <span className="text-xs font-normal text-muted-foreground ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

export default function BatchStats({ batch, readings }: { batch: Batch; readings: Reading[] }) {
  if (readings.length < 2) return null;

  const sorted = [...readings].sort(
    (a, b) => new Date(a.source_timestamp).getTime() - new Date(b.source_timestamp).getTime(),
  );
  const og = sorted[0].gravity;
  const sg = sorted[sorted.length - 1].gravity;
  const currentAbv = abv(og, sg);
  const att = attenuation(og, sg);
  const vel = velocity(sorted);
  const temps = tempStats(sorted);
  const days = daysSince(batch.started_at);
  const proj = vel !== null ? projectedDaysToTarget(sg, 0.996, vel) : null;

  return (
    <Card>
      <CardContent className="p-3 space-y-1">
        <Stat label="Est. ABV" value={currentAbv.toFixed(1)} unit="%" />
        <Stat label="Attenuation" value={att.toFixed(0)} unit="%" />
        <Stat label="OG → SG" value={`${og.toFixed(3)} → ${sg.toFixed(3)}`} />
        {vel !== null && (
          <Stat
            label="Velocity (48h)"
            value={`${vel > 0 ? "+" : ""}${(vel * 1000).toFixed(1)}`}
            unit="pts/day"
          />
        )}
        {proj !== null && proj > 0 && (
          <Stat label="Est. days to 0.996" value={String(proj)} unit="d" />
        )}
        <Stat label="Days fermenting" value={String(days)} />
        {temps && (
          <Stat
            label="Temp range"
            value={`${temps.min.toFixed(1)}–${temps.max.toFixed(1)}`}
            unit="°C"
          />
        )}
        <Stat label="Readings" value={`${sorted.length}`} />
      </CardContent>
    </Card>
  );
}
