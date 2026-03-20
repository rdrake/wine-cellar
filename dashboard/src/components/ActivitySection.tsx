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
import DetailFields from "./DetailFields";

interface Props {
  batchId: string;
  batchStatus: string;
  onChanged?: () => void;
}

export default function ActivitySection({ batchId, batchStatus, onChanged }: Props) {
  const { data, loading, error, refetch } = useFetch(
    () => api.activities.list(batchId),
    [batchId],
  );
  const [editing, setEditing] = useState<Activity | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function refresh() {
    refetch();
    onChanged?.();
  }

  async function handleDelete(activityId: string) {
    try {
      await api.activities.delete(batchId, activityId);
      toast.success("Activity deleted");
      refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete activity. Please try again.");
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

      {loading && <p className="text-sm text-muted-foreground">Loading activities...</p>}
      {error && <p className="text-sm text-destructive">Couldn't load activities. {error}</p>}
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
            onDelete={(id) => setConfirmDelete(id)}
          />
        ))}
      </div>

      {editing && (
        <EditActivityDialog
          batchId={batchId}
          activity={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}

      <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this activity?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (confirmDelete) handleDelete(confirmDelete); setConfirmDelete(null); }}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Convert activity.details (Record<string, unknown> | null) to string record for form fields */
function detailsToStrings(details: Record<string, unknown> | null): Record<string, string> {
  if (!details) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(details)) {
    result[k] = v == null ? "" : String(v);
  }
  return result;
}

/** Convert string record back to typed values (numbers where applicable) */
function parseDetails(details: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (v === "") continue;
    const num = Number(v);
    result[k] = isNaN(num) ? v : num;
  }
  return result;
}

function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function EditActivityDialog({ batchId, activity, onClose, onSaved }: {
  batchId: string;
  activity: Activity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(activity.title);
  const [recordedAt, setRecordedAt] = useState(toLocalDatetime(activity.recorded_at));
  const [details, setDetails] = useState<Record<string, string>>(detailsToStrings(activity.details));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const parsed = parseDetails(details);
      await api.activities.update(batchId, activity.id, {
        title,
        recorded_at: new Date(recordedAt).toISOString(),
        details: Object.keys(parsed).length > 0 ? parsed : null,
      });
      toast.success("Activity updated");
      onSaved();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't update activity. Please try again.");
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
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Added yeast nutrient" />
          </div>
          <div className="space-y-2">
            <Label>Recorded At</Label>
            <Input
              type="datetime-local"
              value={recordedAt}
              onChange={(e) => setRecordedAt(e.target.value)}
            />
          </div>
          <DetailFields type={activity.type} details={details} onChange={setDetails} />
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
