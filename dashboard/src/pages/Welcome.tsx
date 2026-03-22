import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { startRegistration } from "@simplewebauthn/browser";
import { api } from "@/api";
import { useAuth } from "@/components/AuthGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function Welcome() {
  const { user, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user.name ?? "");
  const [saving, setSaving] = useState(false);
  const [passkeyAdded, setPasskeyAdded] = useState(false);

  const handleAddPasskey = async () => {
    try {
      const { challengeId, options } = await api.auth.registerOptions();
      const credential = await startRegistration({ optionsJSON: options });
      await api.auth.register({ challengeId, credential });
      setPasskeyAdded(true);
      toast.success("Passkey added!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add passkey");
    }
  };

  const handleContinue = async () => {
    setSaving(true);
    try {
      await api.users.updateMe({ name: name.trim() || undefined, onboarded: true });
      await refreshAuth();
      navigate("/", { replace: true });
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome to Wine Cellar</CardTitle>
          <CardDescription>Set up your account</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Display name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Add a passkey for quick access with Face ID or Touch ID. You can also do this later from Settings.
            </p>
            <Button variant="outline" onClick={handleAddPasskey} disabled={passkeyAdded}>
              {passkeyAdded ? "Passkey added" : "Set up Face ID / Touch ID"}
            </Button>
          </div>

          <Button size="lg" onClick={handleContinue} disabled={saving}>
            {saving ? "Saving…" : "Continue to dashboard"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
