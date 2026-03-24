/**
 * Tufte sparkline — a word-sized, data-dense graphic.
 * No axes, no chrome. The data IS the decoration.
 *
 * Supports fixed or auto-scaling domains.
 * End dot marks the current (most recent) value.
 * Optional band shows min/max range.
 */

interface SparklineProps {
  /** Data points in chronological order */
  values: number[];
  /** Fixed domain [min, max]. If omitted, auto-scales with 5% padding. */
  domain?: [number, number];
  /** SVG width */
  width?: number;
  /** SVG height */
  height?: number;
  /** Stroke color */
  color?: string;
  /** Stroke width */
  strokeWidth?: number;
  /** Show a dot on the last value */
  endDot?: boolean;
  /** Additional CSS class */
  className?: string;
}

export default function Sparkline({
  values,
  domain,
  width = 120,
  height = 28,
  color = "currentColor",
  strokeWidth = 1.5,
  endDot = true,
  className = "",
}: SparklineProps) {
  if (values.length < 2) return null;

  const min = domain ? domain[0] : Math.min(...values) - (Math.max(...values) - Math.min(...values)) * 0.05;
  const max = domain ? domain[1] : Math.max(...values) + (Math.max(...values) - Math.min(...values)) * 0.05;
  const range = max - min || 1;

  const xStep = width / (values.length - 1);
  const coords = values.map((v, i) => ({
    x: i * xStep,
    y: height - 2 - ((v - min) / range) * (height - 4),
  }));

  const d = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];

  return (
    <svg
      width={width}
      height={height}
      className={`inline-block align-middle ${className}`}
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      {endDot && <circle cx={last.x} cy={last.y} r={2} fill={color} />}
    </svg>
  );
}

/** Convenience: gravity sparkline with fixed winemaking domain */
export function GravitySparkline({ values, className, ...props }: Omit<SparklineProps, "domain" | "color"> & { values: number[] }) {
  return <Sparkline values={values} domain={[0.990, 1.125]} className={`text-chart-1 ${className ?? ""}`} {...props} />;
}

/** Convenience: temperature sparkline with auto domain, amber color */
export function TemperatureSparkline({ values, className, ...props }: Omit<SparklineProps, "color"> & { values: number[] }) {
  return <Sparkline values={values} className={`text-chart-2 ${className ?? ""}`} {...props} />;
}

/** Convenience: battery sparkline with fixed 0-100 domain, green color */
export function BatterySparkline({ values, className, ...props }: Omit<SparklineProps, "domain" | "color"> & { values: number[] }) {
  return <Sparkline values={values} domain={[0, 100]} className={`text-green-600 dark:text-green-400 ${className ?? ""}`} {...props} />;
}
