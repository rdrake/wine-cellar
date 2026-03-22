import { useState, useEffect } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { api } from "@/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function Login() {
  const [error, setError] = useState<string | null>(null);
  const [registrationsOpen, setRegistrationsOpen] = useState(true);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  useEffect(() => {
    // Check URL for error params from OAuth redirect
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get("error");
    if (errorParam === "registrations_closed") {
      setError("Registrations are currently closed.");
    } else if (errorParam === "github_error") {
      setError("GitHub sign-in failed. Please try again.");
    } else if (errorParam === "email_required") {
      setError("A verified email address is required.");
    }
    // Clear error params from URL
    if (errorParam) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    api.auth.settings().then((s) => setRegistrationsOpen(s.registrationsOpen)).catch(() => {});
  }, []);

  const handlePasskeyLogin = async () => {
    setPasskeyLoading(true);
    setError(null);
    try {
      const { challengeId, options } = await api.auth.loginOptions();
      const credential = await startAuthentication({ optionsJSON: options });
      await api.auth.login({ challengeId, credential });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passkey login failed");
    } finally {
      setPasskeyLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Wine Cellar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <a href="/api/v1/auth/github" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
            Sign in with GitHub
          </a>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <Button variant="outline" size="lg" className="w-full" onClick={handlePasskeyLogin} disabled={passkeyLoading}>
            {passkeyLoading ? "Waiting for passkey…" : "Sign in with Passkey"}
          </Button>

          {!registrationsOpen && (
            <p className="text-center text-sm text-muted-foreground">New signups are currently closed</p>
          )}

          {error && (
            <p className="text-center text-sm text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
