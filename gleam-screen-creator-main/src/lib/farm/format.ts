import type { StatusLevel } from "./types";

/**
 * Display helpers. The UI never hand-formats a figure — every number reaching
 * the screen passes through here so units, precision and casing stay identical
 * across pages.
 */

const NUMBER = new Intl.NumberFormat("en-US");

export function formatNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** 2452 -> "2,452g" */
export function formatGrams(value: number, withUnit = true): string {
  return `${NUMBER.format(Math.round(value))}${withUnit ? "g" : ""}`;
}

/** 2452 -> "2.45kg" */
export function formatKilograms(grams: number): string {
  return `${(grams / 1000).toFixed(2)}kg`;
}

/** 1100 -> "1,100 PPM" */
export function formatPpm(value: number, upper = true): string {
  const unit = upper ? "PPM" : "ppm";
  return `${formatNumber(value, value % 1 === 0 ? 0 : 1)} ${unit}`;
}

/**
 * Generic sensor reading: the unit string travels with the value, so a reading
 * is rendered identically wherever it appears. Percentages and temperatures are
 * printed tight against the unit, everything else spaced.
 */
export function formatMeasurement(value: number, unit: string): string {
  const digits = Number.isInteger(value) ? 0 : 1;
  const tight = unit === "%" || unit === "°C";
  return `${formatNumber(value, digits)}${tight ? "" : " "}${unit}`;
}

export function formatPercent(value: number, fractionDigits = 1): string {
  return `${value.toFixed(fractionDigits)}%`;
}

/** 1.2 -> "+1.2%", -0.4 -> "-0.4%" */
export function formatSignedPercent(value: number, fractionDigits = 1): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(fractionDigits)}%`;
}

export function formatSigned(value: number, fractionDigits = 2): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(fractionDigits)}`;
}

/** 0.984 -> "0.984" (confidence scores keep three decimals) */
export function formatConfidence(value: number): string {
  return value.toFixed(3);
}

/** 0.82 -> "0.82" */
export function formatScore(value: number): string {
  return value.toFixed(2);
}

/** Compact thousands for projections: 51360 -> "51k" */
export function formatCompact(value: number): string {
  if (value < 1000) return NUMBER.format(Math.round(value));
  return `${Math.round(value / 1000)}k`;
}

export function formatMb(value: number): string {
  return `${value.toFixed(1)} MB`;
}

/** ISO -> "21:10:00" (UTC, no suffix) */
export function formatTime(iso: string, withSeconds = true): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  if (!withSeconds) return `${hh}:${mm}`;
  return `${hh}:${mm}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
}

/** ISO -> "21:10 UTC" */
export function formatTimeUtc(iso: string, withSeconds = false): string {
  return `${formatTime(iso, withSeconds)} UTC`;
}

/** ISO -> "2024-05-24" */
export function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** ISO -> "2024-05-24 21:10 UTC" */
export function formatDateTimeUtc(iso: string): string {
  return `${formatDate(iso)} ${formatTimeUtc(iso)}`;
}

/** ISO -> "MAY 27, 2024" */
export function formatDateCaps(iso: string): string {
  const d = new Date(iso);
  const month = d
    .toLocaleString("en-US", { month: "short", timeZone: "UTC" })
    .toUpperCase();
  return `${month} ${String(d.getUTCDate()).padStart(2, "0")}, ${d.getUTCFullYear()}`;
}

/** Inclusive date range caption: "2024-05-18 - 2024-05-24" */
export function formatDateRange(startIso: string, endIso: string): string {
  return `${formatDate(startIso)} - ${formatDate(endIso)}`;
}

/** 145 -> "2h 25m" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Elapsed time between two instants: "2h ago" */
export function formatRelative(iso: string, nowIso: string): string {
  const minutes = Math.max(
    0,
    Math.round((new Date(nowIso).getTime() - new Date(iso).getTime()) / 60000),
  );
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Window caption used by the incident report: "02:15-04:40 UTC" */
export function formatWindow(startIso: string, endIso: string): string {
  return `${formatTime(startIso, false)}-${formatTime(endIso, false)} UTC`;
}

/** Percentage change of `value` against `baseline`: "+416%" */
export function formatDeltaVsBaseline(value: number, baseline: number): string {
  const delta = Math.round((value / baseline - 1) * 100);
  return `${delta > 0 ? "+" : ""}${delta}%`;
}

/** Width string for a bar filled to `value / max`. */
export function barWidth(value: number, max: number): string {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `${pct.toFixed(1)}%`;
}

/** Position of `iso` inside a window, as a CSS percentage. */
export function timelinePosition(iso: string, startIso: string, endIso: string): string {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const at = new Date(iso).getTime();
  const pct = ((at - start) / (end - start)) * 100;
  return `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
}

/**
 * Axis captions for a timeline window, one every `stepHours`. The final tick is
 * replaced by "NOW" because the playhead sits at the current instant.
 */
export function timelineTicks(startIso: string, endIso: string, stepHours = 4): string[] {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const step = stepHours * 3600_000;
  const ticks: string[] = [];
  for (let t = start; t < end; t += step) {
    ticks.push(formatTime(new Date(t).toISOString(), false));
  }
  return [...ticks, "NOW"];
}

/** Console label for a status: "nominal" -> "NOMINAL" */
export function statusLabel(status: StatusLevel): string {
  return status.toUpperCase();
}

/** Tailwind classes per status so colour coding never drifts between pages. */
export const STATUS_TONE: Record<
  StatusLevel,
  { text: string; dot: string; border: string; chip: string; icon: string }
> = {
  optimal: {
    text: "text-accent-cyan",
    dot: "bg-accent-cyan",
    border: "border-l-accent-cyan",
    chip: "bg-accent-cyan/10 text-accent-cyan",
    icon: "trending_up",
  },
  nominal: {
    text: "text-accent-teal",
    dot: "bg-accent-teal",
    border: "border-l-accent-teal",
    chip: "bg-accent-teal/10 text-accent-teal",
    icon: "check_circle",
  },
  deviation: {
    text: "text-accent-amber",
    dot: "bg-accent-amber",
    border: "border-l-accent-amber",
    chip: "bg-accent-amber/10 text-accent-amber",
    icon: "trending_down",
  },
  warning: {
    text: "text-accent-amber",
    dot: "bg-accent-amber",
    border: "border-l-accent-amber",
    chip: "bg-accent-amber/10 text-accent-amber",
    icon: "warning",
  },
  critical: {
    text: "text-error",
    dot: "bg-error",
    border: "border-l-error",
    chip: "bg-error/10 text-error",
    icon: "error",
  },
};

/** Report table verdicts derived from a status. */
export const READING_VERDICT: Record<StatusLevel, string> = {
  optimal: "OPTIMAL",
  nominal: "NOMINAL",
  deviation: "DEVIATION",
  warning: "ELEVATED",
  critical: "EXCEEDED",
};
