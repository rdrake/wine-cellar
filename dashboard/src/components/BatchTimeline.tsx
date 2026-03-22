import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/dates";
import type { Milestone, CurrentPhase } from "@/types";

function formatDate(iso: string): string {
  // estimated_date is YYYY-MM-DD — append T00:00:00Z for reliable cross-browser parsing
  const normalized = iso.includes("T") ? iso : iso + "T00:00:00Z";
  return new Date(normalized).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function phaseCounter(phase: CurrentPhase): string {
  if (phase.estimatedTotalDays != null) {
    return `Day ${phase.daysElapsed} of ~${phase.estimatedTotalDays}`;
  }
  if (phase.daysElapsed < 30) {
    return `${phase.daysElapsed} days`;
  }
  const months = Math.floor(phase.daysElapsed / 30);
  return months === 1 ? "1 month" : `${months} months`;
}

export default function BatchTimeline({ milestones, currentPhase }: { milestones: Milestone[]; currentPhase?: CurrentPhase | null }) {
  if (milestones.length === 0 && !currentPhase) return null;

  return (
    <Card>
      <CardContent className="py-4">
        <h3 className="text-sm font-semibold mb-4">Timeline</h3>

        {/* Current phase indicator */}
        {currentPhase && (
          <div className="mb-4 rounded-lg bg-primary/10 px-3 py-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{currentPhase.label}</p>
              <Badge variant="secondary">{phaseCounter(currentPhase)}</Badge>
            </div>
            {currentPhase.estimatedTotalDays != null && (
              <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, (currentPhase.daysElapsed / currentPhase.estimatedTotalDays) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Milestones */}
        <div className="relative pl-6">
          {/* Vertical line */}
          <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />

          <div className="flex flex-col gap-4">
            {milestones.map((m, i) => (
              <div key={i} className="relative">
                {/* Dot */}
                <div className={`absolute -left-4 top-1 h-3 w-3 rounded-full border-2 ${
                  m.completed
                    ? "bg-primary border-primary"
                    : "bg-background border-muted-foreground/40"
                }`} />

                <div className={m.completed ? "opacity-60" : ""}>
                  <p className="text-sm font-medium">
                    {m.completed && "\u2713 "}{m.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {m.completed
                      ? formatDate(m.estimated_date)
                      : timeAgo(m.estimated_date + "T00:00:00Z")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
