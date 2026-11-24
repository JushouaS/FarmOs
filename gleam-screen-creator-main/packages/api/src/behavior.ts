import { env } from "./config.js";
import type { Lighting } from "./lighting.js";

/**
 * Turns the vision service's raw measurements into the words the dashboard
 * shows, and applies the one rule that cannot be measured: at night the flock
 * is asleep, so inactivity and crowding are not distress.
 *
 * The vision service deliberately stops at counts and geometry — "12 of 33
 * birds did not move" — because a threshold like "60% is too many" is a policy
 * decision that has to be reviewable, testable and changeable in one place.
 * This is that place.
 */

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Share of the flock that must be still before inactivity is called. */
export const INACTIVITY_RATIO = 0.6;

/** Below this many birds the picture is too sparse to judge. One bird sitting
 * still is not a finding; a screen mostly out of frame is not a flock. */
export const MIN_BIRDS = 3;

/** Huddling needs enough birds outside feeder zones to mean something. */
export const MIN_EVALUABLE = 5;

/** Huddling risk bands. Above 0.6 the clump is dense enough to matter. */
export const HUDDLE_MODERATE = 0.25;
export const HUDDLE_SEVERE = 0.6;

/** How many recent samples the rolling window looks at. */
export const WINDOW_SIZE = 10;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The `metrics` object returned by POST /analyze on the vision service. */
export interface VisionMetrics {
  bird_count: number;
  zone_count: number;
  evaluable_count: number;
  inactive_count: number;
  huddled_count: number;
  movement_index: number;
  huddling_risk: number;
  huddling_coverage: number;
  huddling_compactness: number;
  huddle_radius_px: number;
  confidence: number;
  resolution: [number, number];
  mean_luma: number;
  global_shift: number;
  zones: number;
  model_loaded: boolean;
}

/** The `behaviour` object the dashboard reads, and `behavior_snapshots` stores. */
export interface BehaviorVerdict {
  movement_index: number;
  movement_label: string;
  movement_status: string;
  huddling_risk: number;
  huddling_label: string;
  huddling_status: string;
  aggression_events: number;
  // Beyond what the older rows carried: the counts behind the labels.
  bird_count: number;
  zone_count: number;
  evaluable_count: number;
  inactive_count: number;
  huddled_count: number;
  confidence: number | null;
  night: boolean;
  suppressed: boolean;
  reliable: boolean;
  /** Why the judgement was withheld, in machine-readable form. */
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Day and night
// ---------------------------------------------------------------------------

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/** Minutes since local midnight in the farm's timezone. */
function localMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/**
 * Is the flock asleep right now?
 *
 * Same half-open interval rule the dashboard uses client-side — day is
 * [dayStart, nightStart), night is the rest — but evaluated in the farm's
 * timezone rather than whatever the container happens to be set to.
 */
export function isNightAt(
  date: Date,
  lighting: Lighting,
  timeZone: string = env.FARM_TZ,
): boolean {
  const now = localMinutes(date, timeZone);
  const day = minutesOf(lighting.dayStart);
  const night = minutesOf(lighting.nightStart);
  const isDay = day < night ? now >= day && now < night : now >= day || now < night;
  return !isDay;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Decide what the measurements mean.
 *
 * Order matters: night wins over everything, because a still, tightly packed
 * flock at 22:00 is what a healthy flock looks like asleep. A broken
 * measurement beats a wrong one — if the camera moved or the model is not
 * loaded, the verdict is withheld rather than reported as normal.
 */
export function classify(
  metrics: VisionMetrics | null | undefined,
  opts: { night: boolean; warnings?: string[] },
): BehaviorVerdict {
  const warnings = opts.warnings ?? [];
  const birdCount = metrics?.bird_count ?? 0;
  const zoneCount = metrics?.zone_count ?? 0;
  const evaluable = metrics?.evaluable_count ?? 0;
  const inactive = metrics?.inactive_count ?? 0;
  const huddled = metrics?.huddled_count ?? 0;
  const risk = metrics?.huddling_risk ?? 0;

  const base: BehaviorVerdict = {
    movement_index: metrics?.movement_index ?? 0,
    movement_label: "Unknown",
    movement_status: "unknown",
    huddling_risk: risk,
    huddling_label: "none",
    huddling_status: "nominal",
    aggression_events: 0,
    bird_count: birdCount,
    zone_count: zoneCount,
    evaluable_count: evaluable,
    inactive_count: inactive,
    huddled_count: huddled,
    confidence: metrics?.confidence ?? null,
    night: opts.night,
    suppressed: false,
    reliable: false,
    reason: null,
  };

  // No usable measurement. Say so; never let "we could not see" read as "fine".
  // A frame that never arrived belongs here with the missing model and the dark
  // picture: the counts are zero because nothing was measured, and reporting
  // that as "no_birds" would accuse the flock of not being there.
  const blind = warnings.find(
    (w) =>
      w === "model_unavailable" ||
      w === "too_dark" ||
      w === "no_frame" ||
      w === "video_frame_unavailable",
  );
  if (blind) return { ...base, reason: blind };
  if (warnings.includes("camera_moved")) return { ...base, reason: "camera_moved" };
  if (birdCount === 0) return { ...base, reason: "no_birds" };
  if (birdCount < MIN_BIRDS) return { ...base, reason: "too_few_birds" };

  // The night exception. The measurements are still recorded — the caller
  // stores the raw counts — they simply do not raise anything.
  if (opts.night) {
    return {
      ...base,
      movement_label: "Sleeping",
      movement_status: "nominal",
      huddling_label: "none",
      huddling_status: "nominal",
      suppressed: true,
      reliable: true,
    };
  }

  const stillRatio = birdCount > 0 ? inactive / birdCount : 0;
  const inactiveNow = stillRatio >= INACTIVITY_RATIO;

  let huddleLabel = "none";
  let huddleStatus = "nominal";
  let reason: string | null = null;

  if (evaluable < MIN_EVALUABLE) {
    // Every bird is at a feeder, or nearly. Nothing to judge, and saying
    // "none" would imply we looked.
    reason = "too_few_outside_zones";
  } else if (risk >= HUDDLE_SEVERE) {
    huddleLabel = "severe";
    huddleStatus = "critical";
  } else if (risk >= HUDDLE_MODERATE) {
    huddleLabel = "moderate";
    huddleStatus = "warning";
  }

  return {
    ...base,
    movement_label: inactiveNow ? "Inactive" : "Active",
    movement_status: inactiveNow ? "warning" : "nominal",
    huddling_label: huddleLabel,
    huddling_status: huddleStatus,
    reliable: true,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Rolling window
// ---------------------------------------------------------------------------

export interface WindowSample {
  movement_status: string;
  huddling_status: string;
  suppressed: boolean;
}

export interface SustainedFlags {
  inactivity: boolean;
  huddling: boolean;
  /** How many usable samples the answer was based on. */
  samples: number;
}

/**
 * Is a finding persistent enough to act on?
 *
 * One snapshot is a moment; a welfare problem is a trend. Inactivity has to
 * hold for four in five of the window's daytime samples before it counts as
 * sustained, which outlasts a bird walking to the feeder. Huddling needs three
 * consecutive critical samples, because a genuine huddle does not dissolve on
 * the next frame.
 *
 * Night samples are dropped rather than counted as healthy: they are
 * unavailable evidence, not evidence of absence.
 */
export function sustainedFlags(rows: WindowSample[]): SustainedFlags {
  const usable = rows.filter((r) => !r.suppressed).slice(-WINDOW_SIZE);
  if (usable.length === 0) return { inactivity: false, huddling: false, samples: 0 };

  const inactive = usable.filter((r) => r.movement_status === "warning").length;
  const needed = Math.max(1, Math.ceil(usable.length * 0.8));

  let streak = 0;
  let longest = 0;
  for (const row of usable) {
    streak = row.huddling_status === "critical" ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }

  return {
    inactivity: inactive >= needed && usable.length >= 5,
    huddling: longest >= 3,
    samples: usable.length,
  };
}
