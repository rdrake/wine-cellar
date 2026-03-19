import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Batch } from "@/types";
import { STAGE_LABELS, WINE_TYPE_LABELS, STATUS_LABELS } from "@/types";

export default function BatchCard({ batch }: { batch: Batch }) {
  return (
    <Link to={`/batches/${batch.id}`}>
      <Card className="active:bg-accent transition-colors">
        <CardContent className="p-4">
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold truncate">{batch.name}</h3>
              <p className="text-sm text-muted-foreground">{WINE_TYPE_LABELS[batch.wine_type]}</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Badge variant="outline" className="text-xs">
                {STATUS_LABELS[batch.status]}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {STAGE_LABELS[batch.stage]}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
