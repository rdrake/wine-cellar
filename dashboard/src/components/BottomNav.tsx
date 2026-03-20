import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { House, Wine, Wrench, Settings } from "lucide-react";

const tabs = [
  { to: "/", label: "Home", icon: House },
  { to: "/batches", label: "Batches", icon: Wine },
  { to: "/tools", label: "Calculators", icon: Wrench },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t z-50" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex justify-around max-w-lg lg:max-w-3xl mx-auto">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center py-3 px-4 text-xs min-w-[64px] transition-colors relative",
                isActive ? "text-primary font-medium" : "text-muted-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={cn(
                  "flex items-center justify-center w-10 h-7 rounded-full mb-0.5 transition-colors",
                  isActive && "bg-primary/10"
                )}>
                  <tab.icon className="size-5" strokeWidth={isActive ? 2 : 1.5} />
                </span>
                {tab.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
