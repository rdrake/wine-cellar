import { useState } from "react";
import { api } from "@/api";
import { useAuth } from "@/components/AuthGate";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { NotificationsSection } from "./NotificationsSection";

export function AccountSection() {
  const { user } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await api.auth.logout();
      window.location.reload();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't log out");
      setLoggingOut(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {user.avatarUrl && (
          <img src={user.avatarUrl} alt="" className="h-10 w-10 rounded-full" />
        )}
        <div>
          <p className="font-medium">{user.name ?? user.email}</p>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
      </div>

      <div className="pt-2 border-t">
        <NotificationsSection />
      </div>

      <div className="pt-2 border-t">
        <Button size="sm" variant="ghost" className="text-destructive" disabled={loggingOut} onClick={handleLogout}>
          {loggingOut ? "Logging out..." : "Log Out"}
        </Button>
      </div>
    </div>
  );
}
