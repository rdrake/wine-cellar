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
      <header className="flex items-center justify-between px-4 py-3">
        <h1 className="font-heading text-lg tracking-tight text-primary">Wine Cellar</h1>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleReset}>
            Reset
          </Button>
        </div>
      </header>
      <Outlet />
      <BottomNav />
      <Toaster position="top-center" />
    </div>
  );
}
