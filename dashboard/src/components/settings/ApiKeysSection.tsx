import { useState, useCallback, useEffect } from "react";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { timeAgo } from "@/lib/dates";

export function ApiKeysSection() {
  const [keys, setKeys] = useState<Array<{ id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const { items } = await api.auth.apiKeys.list();
      setKeys(items);
    } catch {
      toast.error("Couldn't load API keys");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const result = await api.auth.apiKeys.create(newKeyName.trim());
      setCreatedKey(result.key);
      setNewKeyName("");
      fetchKeys();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't create API key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    try {
      await api.auth.apiKeys.revoke(id);
      toast.success("API key revoked");
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't revoke API key");
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm">API Keys</p>
          <p className="text-xs text-muted-foreground">For MCP servers and automation.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
          Create
        </Button>
      </div>

      {keys.length === 0 && !showCreate && (
        <p className="text-xs text-muted-foreground">No API keys yet.</p>
      )}

      {keys.map((k) => (
        <div key={k.id} className="flex items-center justify-between py-1.5">
          <div>
            <p className="text-sm font-medium">{k.name}</p>
            <p className="text-xs text-muted-foreground font-mono">
              {k.prefix}{"..."} · created {timeAgo(k.createdAt)}
              {k.lastUsedAt ? ` · used ${timeAgo(k.lastUsedAt)}` : " · never used"}
            </p>
          </div>
          <Button size="sm" variant="ghost" className="text-destructive h-7 text-xs" onClick={() => handleRevoke(k.id)}>
            Revoke
          </Button>
        </div>
      ))}

      {/* Create dialog */}
      <Dialog open={showCreate && !createdKey} onOpenChange={(open) => { if (!open) { setShowCreate(false); setNewKeyName(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
          </DialogHeader>
          <input
            className="w-full px-3 py-2 text-sm border rounded bg-background"
            placeholder="Key name, e.g. MCP Server"
            aria-label="API key name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setNewKeyName(""); }}>Cancel</Button>
            <Button disabled={!newKeyName.trim() || creating} onClick={handleCreate}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show key dialog */}
      <Dialog open={!!createdKey} onOpenChange={(open) => { if (!open) { setCreatedKey(null); setShowCreate(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Copy this key now — you won't be able to see it again.</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={createdKey ?? ""}
                className="flex-1 px-3 py-2 text-xs font-mono border rounded bg-muted select-all"
                aria-label="Generated API key"
                onFocus={(e) => e.target.select()}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (createdKey) {
                    navigator.clipboard.writeText(createdKey);
                    toast.success("Copied to clipboard");
                  }
                }}
              >
                Copy
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setCreatedKey(null); setShowCreate(false); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
