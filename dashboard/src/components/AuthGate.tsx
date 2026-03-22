import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { api, setOnUnauthorized } from "@/api";
import { Login } from "@/pages/Login";

interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface AuthContextValue {
  user: AuthUser;
  isNewUser: boolean;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthGate");
  return ctx;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    authenticated: boolean;
    isNewUser?: boolean;
    user?: AuthUser;
  } | null>(null);

  const refreshAuth = async () => {
    try {
      const s = await api.auth.status();
      setState(s);
    } catch {
      setState({ authenticated: false });
    }
  };

  useEffect(() => {
    setOnUnauthorized(() => setState({ authenticated: false }));
    refreshAuth();
  }, []);

  if (state === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!state.authenticated || !state.user) {
    return <Login />;
  }

  return (
    <AuthContext.Provider value={{ user: state.user, isNewUser: state.isNewUser ?? false, refreshAuth }}>
      {children}
    </AuthContext.Provider>
  );
}
