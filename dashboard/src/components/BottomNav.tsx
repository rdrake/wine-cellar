import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/", label: "Batches", icon: "🍷" },
  { to: "/devices", label: "Devices", icon: "📡" },
  { to: "/tools", label: "Tools", icon: "🔧" },
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background border-t z-50">
      <div className="flex justify-around max-w-lg mx-auto">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center py-3 px-6 text-xs min-w-[72px] transition-colors",
                isActive ? "text-primary font-medium" : "text-muted-foreground",
              )
            }
          >
            <span className="text-xl mb-0.5">{tab.icon}</span>
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
