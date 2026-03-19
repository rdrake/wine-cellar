import { Outlet, useNavigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { clearApiConfig } from "@/api";
import BottomNav from "./BottomNav";

export default function Layout() {
  const navigate = useNavigate();

  function handleReset() {
    clearApiConfig();
    navigate("/setup");
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="flex justify-end p-2">
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleReset}>
          Reset
        </Button>
      </header>
      <Outlet />
      <BottomNav />
      <Toaster position="top-center" />
    </div>
  );
}
