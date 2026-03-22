import { useState, useEffect, useCallback } from "react";
import { api, setOnUnauthorized } from "@/api";
import Setup from "@/pages/Setup";
import Login from "@/pages/Login";

interface AuthState {
  registered: boolean;
  authenticated: boolean;
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [loading, setLoading] = useState(true);

  const checkStatus = useCallback(async () => {
    try {
      const status = await api.auth.status();
      setAuthState(status);
    } catch {
      setAuthState({ registered: false, authenticated: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    setOnUnauthorized(() => {
      setAuthState((prev) => prev ? { ...prev, authenticated: false } : null);
    });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!authState?.registered) {
    return (
      <Setup onComplete={() => setAuthState({ registered: true, authenticated: true })} />
    );
  }

  if (!authState.authenticated) {
    return (
      <Login onComplete={() => setAuthState({ registered: true, authenticated: true })} />
    );
  }

  return <>{children}</>;
}
