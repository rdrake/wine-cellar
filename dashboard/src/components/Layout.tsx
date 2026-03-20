import { Outlet } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import BottomNav from "./BottomNav";
import ThemeToggle from "./ThemeToggle";

export default function Layout() {
  return (
    <div className="min-h-screen bg-background" style={{ paddingBottom: "calc(5rem + env(safe-area-inset-bottom))" }}>
      <header className="flex items-center justify-between px-4 py-3 max-w-lg lg:max-w-3xl mx-auto" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <h1 className="font-heading text-lg tracking-tight text-primary">Wine Cellar</h1>
        <ThemeToggle />
      </header>
      <Outlet />
      <BottomNav />
      <Toaster position="top-center" style={{ top: "env(safe-area-inset-top, 0px)" }} />
    </div>
  );
}
