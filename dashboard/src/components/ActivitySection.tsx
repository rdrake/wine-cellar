import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Activity } from "@/types";
import ActivityItem from "./ActivityItem";

interface Props {
  batchId: string;
  batchStatus: string;
}

export default function ActivitySection({ batchId, batchStatus }: Props) {
  const { data, loading, error, refetch } = useFetch(
    () => api.activities.list(batchId),
    [batchId],
  );
  const [editing, setEditing] = useState<Activity | null>(null);

  async function handleDelete(activityId: string) {
    try {
      await api.activities.delete(batchId, activityId);
      toast.success("Activity deleted");
      refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <section>
      <div className="flex justify-between items-center mb-2">
        <h2 className="font-semibold">Activities</h2>
        {batchStatus === "active" && (
          <Link to={`/batches/${batchId}/activities/new`}>
            <Button size="sm" variant="outline">+ Log</Button>
          </Link>
        )}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && data.items.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No activities logged. Tap + Log to record your first activity.
        </p>
      )}
      <div className="space-y-2">
        {data?.items.map((activity) => (
          <ActivityItem
            key={activity.id}
            activity={activity}
            onEdit={setEditing}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {editing && (
        <EditActivityDialog
          batchId={batchId}
          activity={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refetch(); }}
        />
      )}
    </section>
  );
}

function EditActivityDialog({ batchId, activity, onClose, onSaved }: {
  batchId: string;
  activity: Activity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(activity.title);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await api.activities.update(batchId, activity.id, { title });
      toast.success("Activity updated");
      onSaved();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Activity</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !title} onClick={handleSave}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
