import { Outlet, useNavigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { clearApiConfig } from "@/api";
import BottomNav from "./BottomNav";
import ThemeToggle from "./ThemeToggle";

export default function Layout() {
  const navigate = useNavigate();

  function handleReset() {
    clearApiConfig();
    navigate("/setup");
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="flex items-center justify-between px-4 py-3 max-w-lg lg:max-w-3xl mx-auto" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <h1 className="font-heading text-lg tracking-tight text-primary">Wine Cellar</h1>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleReset}>
            Disconnect
          </Button>
        </div>
      </header>
      <Outlet />
      <BottomNav />
      <Toaster position="top-center" style={{ top: "env(safe-area-inset-top, 0px)" }} />
    </div>
  );
}
