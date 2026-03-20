import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Sun, Moon, Monitor } from "lucide-react";

const cycle = ["system", "light", "dark"] as const;
const icons = { system: Monitor, light: Sun, dark: Moon };

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = theme ?? "system";
  const next = cycle[(cycle.indexOf(current as typeof cycle[number]) + 1) % cycle.length];
  const Icon = icons[current as keyof typeof icons] ?? Monitor;

  return (
    <Button variant="ghost" size="icon-xs" onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`}>
      <Icon className="size-3.5" />
    </Button>
  );
}
