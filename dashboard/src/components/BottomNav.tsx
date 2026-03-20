import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { House, Wine, Radio, Wrench } from "lucide-react";

const tabs = [
  { to: "/", label: "Home", icon: House },
  { to: "/batches", label: "Batches", icon: Wine },
  { to: "/devices", label: "Devices", icon: Radio },
  { to: "/tools", label: "Tools", icon: Wrench },
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t z-50">
      <div className="flex justify-around max-w-lg mx-auto">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center py-3 px-4 text-xs min-w-[64px] transition-colors",
                isActive ? "text-primary font-medium" : "text-muted-foreground",
              )
            }
          >
            <tab.icon className="size-5 mb-0.5" strokeWidth={1.5} />
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
