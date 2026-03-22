import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function Login({ onComplete }: { onComplete: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const { challengeId, options } = await api.auth.loginOptions();
      const credential = await startAuthentication({ optionsJSON: options });
      await api.auth.login({ challengeId, credential });
      onComplete();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Sign in failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="font-heading text-2xl tracking-tight text-primary">Wine Cellar</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to continue</p>
        </div>
        <Button className="w-full" disabled={loading} onClick={handleLogin}>
          {loading ? "Signing in..." : "Sign in with Passkey"}
        </Button>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}
