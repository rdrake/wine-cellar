import { Card, CardContent } from "@/components/ui/card";
import type { DrinkWindow } from "@/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function cellaringStatus(window: DrinkWindow): string {
  const now = new Date();
  const ready = new Date(window.readyDate);
  const peakStart = new Date(window.peakStart);
  const peakEnd = new Date(window.peakEnd);
  const pastPeak = new Date(window.pastPeakDate);

  if (now < ready) {
    const months = Math.ceil((ready.getTime() - now.getTime()) / (30 * 24 * 3600_000));
    return `Aging \u2014 will be ready to drink in ~${months} month${months === 1 ? "" : "s"}`;
  }
  if (now < peakStart) return "Ready to drink \u2014 approaching peak";
  if (now < peakEnd) return "In peak drinking window";
  if (now < pastPeak) return "Past peak \u2014 drink soon";
  return "Past recommended drinking window";
}

export default function CellaringCard({ cellaring }: { cellaring: DrinkWindow }) {
  const status = cellaringStatus(cellaring);

  return (
    <Card>
      <CardContent className="py-4 flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Cellaring</h3>

        <div className="flex flex-col gap-1">
          <p className="text-lg font-medium">
            {formatDate(cellaring.peakStart)} &ndash; {formatDate(cellaring.peakEnd)}
          </p>
          <p className="text-sm text-muted-foreground">{status}</p>
        </div>

        <p className="text-xs text-muted-foreground">{cellaring.storageNote}</p>

        {cellaring.adjustmentNote && (
          <p className="text-xs text-muted-foreground italic">{cellaring.adjustmentNote}</p>
        )}
      </CardContent>
    </Card>
  );
}
