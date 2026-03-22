import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function Setup({ onComplete }: { onComplete: () => void }) {
  const [email, setEmail] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSetup() {
    if (!email.trim() || !setupToken.trim()) return;
    setLoading(true);
    try {
      const { challengeId, options } = await api.auth.bootstrapOptions({
        setupToken: setupToken.trim(),
        email: email.trim(),
      });
      const credential = await startRegistration({ optionsJSON: options });
      await api.auth.bootstrap({
        challengeId,
        credential,
        setupToken: setupToken.trim(),
        email: email.trim(),
      });
      toast.success("Passkey created successfully");
      onComplete();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="font-heading text-2xl tracking-tight text-primary">Wine Cellar</h1>
          <p className="text-sm text-muted-foreground mt-1">Set up your account</p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="setupToken">Setup Token</Label>
            <Input
              id="setupToken"
              type="password"
              placeholder="From your server config"
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            disabled={!email.trim() || !setupToken.trim() || loading}
            onClick={handleSetup}
          >
            {loading ? "Creating Passkey..." : "Create Passkey"}
          </Button>
        </div>
      </div>
    </div>
  );
}
