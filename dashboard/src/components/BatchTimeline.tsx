import { Card, CardContent } from "@/components/ui/card";
import type { Milestone } from "@/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function BatchTimeline({ milestones }: { milestones: Milestone[] }) {
  if (milestones.length === 0) return null;

  return (
    <Card>
      <CardContent className="py-4">
        <h3 className="text-sm font-semibold mb-4">Projected Timeline</h3>
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
                    {m.confidence !== "firm" && "~"}{formatDate(m.estimated_date)}
                    {" \u00b7 "}{m.basis}
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
