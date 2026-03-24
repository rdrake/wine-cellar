import { useState, useCallback, useEffect } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { timeAgo } from "@/lib/dates";
import type { Passkey } from "@/types";

export function PasskeysSection() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [newPasskeyName, setNewPasskeyName] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState<Passkey | null>(null);

  const fetchPasskeys = useCallback(async () => {
    try {
      const { items } = await api.auth.passkeys.list();
      setPasskeys(items);
    } catch {
      toast.error("Couldn't load passkeys");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPasskeys();
  }, [fetchPasskeys]);

  async function handleRegister() {
    const name = newPasskeyName.trim() || null;
    setShowNamePrompt(false);
    setNewPasskeyName("");
    setRegistering(true);
    try {
      const { challengeId, options } = await api.auth.registerOptions();
      const credential = await startRegistration({ optionsJSON: options });
      await api.auth.register({ challengeId, credential, name: name ?? undefined });
      toast.success("Passkey registered");
      fetchPasskeys();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't register passkey");
    } finally {
      setRegistering(false);
    }
  }

  async function handleRevoke(passkey: Passkey) {
    if (passkeys.length === 1) {
      setConfirmRevoke(passkey);
      return;
    }
    await doRevoke(passkey.id);
  }

  async function doRevoke(id: string) {
    try {
      await api.auth.passkeys.revoke(id);
      toast.success("Passkey revoked");
      setPasskeys((prev) => prev.filter((p) => p.id !== id));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't revoke passkey");
    }
    setConfirmRevoke(null);
  }

  if (loading) return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-52 mt-1" />
        </div>
        <Skeleton className="h-8 w-14" />
      </div>
      <div className="flex items-center justify-between py-1.5">
        <div>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-40 mt-1" />
        </div>
        <Skeleton className="h-7 w-16" />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Passkeys</p>
          <p className="text-xs text-muted-foreground">Sign in with biometrics or a security key.</p>
        </div>
        <Button size="sm" variant="outline" disabled={registering} onClick={() => setShowNamePrompt(true)}>
          {registering ? "Registering..." : "Add"}
        </Button>
      </div>

      {passkeys.length === 0 && (
        <p className="text-xs text-muted-foreground">No passkeys registered.</p>
      )}

      {passkeys.map((pk) => (
        <div key={pk.id} className="flex items-center justify-between py-1.5">
          <div>
            <p className="text-sm font-medium">{pk.name ?? "Unnamed passkey"}</p>
            <p className="text-xs text-muted-foreground">
              Created {timeAgo(pk.createdAt)}
              {pk.lastUsedAt ? ` · used ${timeAgo(pk.lastUsedAt)}` : " · never used"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {pk.backedUp && (
              <Badge variant="secondary">Synced</Badge>
            )}
            <Button size="sm" variant="ghost" className="text-destructive h-7 text-xs" onClick={() => handleRevoke(pk)}>
              Revoke
            </Button>
          </div>
        </div>
      ))}

      <Dialog open={showNamePrompt} onOpenChange={(open) => { if (!open) { setShowNamePrompt(false); setNewPasskeyName(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name This Passkey</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Give it a name so you can identify it later, e.g. "MacBook" or "iPhone".</p>
          <input
            className="w-full px-3 py-2 text-sm border rounded bg-background"
            placeholder="e.g. MacBook Pro"
            aria-label="Passkey name"
            maxLength={100}
            value={newPasskeyName}
            onChange={(e) => setNewPasskeyName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRegister(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowNamePrompt(false); setNewPasskeyName(""); }}>Cancel</Button>
            <Button onClick={handleRegister}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmRevoke} onOpenChange={(open) => { if (!open) setConfirmRevoke(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke Last Passkey?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This is your only passkey. After revoking it, you'll need to use GitHub to sign in and register a new one.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmRevoke && doRevoke(confirmRevoke.id)}>Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
