import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Nudge } from "@/types";

const PRIORITY_STYLES = {
  action: "border-l-4 border-l-blue-500 bg-blue-50 dark:bg-blue-950/30",
  warning: "border-l-4 border-l-yellow-500 bg-yellow-50 dark:bg-yellow-950/30",
  info: "border-l-4 border-l-muted-foreground/30",
};

const DISMISSED_KEY = "dismissed-nudges";

function getDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"));
  } catch { return new Set(); }
}

function dismiss(id: string) {
  const dismissed = getDismissed();
  dismissed.add(id);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
}

export default function NudgeBar({ nudges }: { nudges: Nudge[] }) {
  const [dismissed, setDismissed] = useState(getDismissed);
  const visible = nudges.filter((n) => !dismissed.has(n.id));
  if (visible.length === 0) return null;

  function handleDismiss(id: string) {
    dismiss(id);
    setDismissed(new Set(dismissed).add(id));
  }

  return (
    <div className="flex flex-col gap-2">
      {visible.map((nudge) => (
        <Card key={nudge.id} className={PRIORITY_STYLES[nudge.priority]}>
          <CardContent className="flex items-start justify-between gap-2 py-3 px-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{nudge.message}</p>
              {nudge.detail && <p className="text-xs text-muted-foreground mt-1">{nudge.detail}</p>}
            </div>
            <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => handleDismiss(nudge.id)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
