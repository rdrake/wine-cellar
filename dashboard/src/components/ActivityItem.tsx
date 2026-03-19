import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Activity } from "@/types";
import { STAGE_LABELS, ACTIVITY_TYPE_LABELS } from "@/types";

interface Props {
  activity: Activity;
  onEdit: (activity: Activity) => void;
  onDelete: (id: string) => void;
}

export default function ActivityItem({ activity, onEdit, onDelete }: Props) {
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
              {new Date(activity.recorded_at).toLocaleString()}
            </p>
            {activity.details && Object.keys(activity.details).length > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                {Object.entries(activity.details).map(([k, v]) => (
                  <span key={k} className="mr-2">{k}: {String(v)}</span>
                ))}
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
