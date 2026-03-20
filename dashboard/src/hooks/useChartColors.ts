import { useMemo } from "react";
import { useTheme } from "next-themes";

/**
 * Returns resolved chart & UI colors that react to theme changes.
 * Recharts needs concrete color strings (SVG attributes don't support var()),
 * so we read the computed CSS variable values whenever the theme flips.
 */
export function useChartColors() {
  const { resolvedTheme } = useTheme();

  return useMemo(() => {
    // Reading computed styles — the dependency on resolvedTheme ensures
    // this re-runs after the .dark class is toggled on <html>.
    const style = getComputedStyle(document.documentElement);
    const get = (v: string) => style.getPropertyValue(v).trim();

    return {
      chart1: get("--chart-1"),
      chart2: get("--chart-2"),
      chart3: get("--chart-3"),
      chart4: get("--chart-4"),
      chart5: get("--chart-5"),
      foreground: get("--foreground"),
      mutedForeground: get("--muted-foreground"),
      card: get("--card"),
      cardForeground: get("--card-foreground"),
      border: get("--border"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme]);
}
