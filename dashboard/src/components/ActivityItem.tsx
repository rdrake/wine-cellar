import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Activity, ActivityType } from "@/types";
import { STAGE_LABELS, ACTIVITY_TYPE_LABELS } from "@/types";

const CHEMICAL_SUBSCRIPTS: Record<string, string> = {
  K2S2O5: "K\u2082S\u2082O\u2085",
  SO2: "SO\u2082",
  CO2: "CO\u2082",
  Na2S2O5: "Na\u2082S\u2082O\u2085",
  H2SO4: "H\u2082SO\u2084",
  CaCO3: "CaCO\u2083",
};

function formatChemical(name: string): string {
  return CHEMICAL_SUBSCRIPTS[name] ?? name;
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} \u00b7 ${time}`;
}

function formatDetails(type: ActivityType, details: Record<string, unknown>): React.ReactNode {
  if (!details || Object.keys(details).length === 0) return null;

  switch (type) {
    case "addition": {
      const { chemical, amount, unit } = details as { chemical?: string; amount?: number; unit?: string };
      if (!chemical) return null;
      const parts = [formatChemical(String(chemical))];
      if (amount != null) parts.push(String(amount));
      if (unit) parts[parts.length - 1] += ` ${unit}`;
      return <span>{parts.join(" \u00b7 ")}</span>;
    }
    case "measurement": {
      const { metric, value, unit } = details as { metric?: string; value?: number; unit?: string };
      if (metric == null || value == null) return null;
      return <span>{String(metric)}: {String(value)}{unit ? ` ${unit}` : ""}</span>;
    }
    case "racking": {
      const { from_vessel, to_vessel } = details as { from_vessel?: string; to_vessel?: string };
      if (!from_vessel && !to_vessel) return null;
      return <span>{from_vessel ?? "Unknown vessel"} &rarr; {to_vessel ?? "Unknown vessel"}</span>;
    }
    case "tasting": {
      const { aroma, flavor, appearance, palate, finish, overall_score } = details as {
        aroma?: string; flavor?: string; appearance?: string;
        palate?: string; finish?: string; overall_score?: string | number;
      };
      const lines: { label: string; value: string }[] = [];
      if (appearance) lines.push({ label: "Appearance", value: String(appearance) });
      if (aroma) lines.push({ label: "Aroma", value: String(aroma) });
      if (palate) lines.push({ label: "Palate", value: String(palate) });
      if (finish) lines.push({ label: "Finish", value: String(finish) });
      if (flavor) lines.push({ label: "Flavor", value: String(flavor) });
      if (overall_score != null) lines.push({ label: "Score", value: `${String(overall_score)}/5` });
      if (lines.length === 0) return null;
      return (
        <div className="flex flex-col">
          {lines.map((l) => (
            <span key={l.label}>{l.label}: {l.value}</span>
          ))}
        </div>
      );
    }
    case "adjustment": {
      const { parameter, from_value, to_value, unit } = details as {
        parameter?: string; from_value?: number; to_value?: number; unit?: string;
      };
      if (!parameter) return null;
      const parts = [`${String(parameter)}:`];
      if (from_value != null && to_value != null) {
        parts.push(`${String(from_value)} \u2192 ${String(to_value)}`);
      } else if (to_value != null) {
        parts.push(String(to_value));
      }
      if (unit) parts.push(unit);
      return <span>{parts.join(" ")}</span>;
    }
    case "note": {
      const { body } = details as { body?: string };
      if (!body) return null;
      return <span className="whitespace-pre-wrap">{String(body)}</span>;
    }
    default: {
      // Fallback: render key-value pairs for any unknown type
      return (
        <>
          {Object.entries(details).map(([k, v]) => (
            <span key={k} className="mr-2">{k}: {String(v)}</span>
          ))}
        </>
      );
    }
  }
}

interface Props {
  activity: Activity;
  onEdit: (activity: Activity) => void;
  onDelete: (id: string) => void;
}

export default function ActivityItem({ activity, onEdit, onDelete }: Props) {
  const detailsContent = activity.details
    ? formatDetails(activity.type, activity.details as Record<string, unknown>)
    : null;

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <p className="font-medium text-sm">{activity.title}</p>
            <p className="text-xs text-muted-foreground">
              {ACTIVITY_TYPE_LABELS[activity.type]} &middot; {STAGE_LABELS[activity.stage]}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatTimestamp(activity.recorded_at)}
            </p>
            {detailsContent && (
              <div className="mt-1 text-xs text-muted-foreground">
                {detailsContent}
              </div>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => onEdit(activity)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => onDelete(activity.id)}
            >
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
