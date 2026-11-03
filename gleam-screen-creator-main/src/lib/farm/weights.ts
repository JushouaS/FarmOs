/**
 * The flock's weights, from what was measured.
 *
 * The only measurement of single birds is the weight a person typed in on Flock Tracking (the API keeps it
 * in `actual_weights` and serves the newest day's set at GET /growth/weight-spread). Everything on the
 * Dashboard report, the Analytics weight tab and the AI briefing that talks about the spread of the flock's
 * weights is worked out here from that set, so there is one place to read and nothing is invented: with no
 * weights typed in there are no birds, no average and no spread.
 */

/** Under 92% of the breed standard for the day a bird is underweight; over 115% it is heavy. */
export const UNDERWEIGHT_RATIO = 0.92;
export const HEAVY_RATIO = 1.15;

/** The grow-out window when the API does not say (Settings default). */
export const DEFAULT_START_DAY = 16;
export const DEFAULT_END_DAY = 45;

export type WeightCategory = "Underweight" | "Optimal" | "Overweight";

export function weightCategoryFor(weightG: number, standardG: number): WeightCategory {
  if (weightG < standardG * UNDERWEIGHT_RATIO) return "Underweight";
  if (weightG > standardG * HEAVY_RATIO) return "Overweight";
  return "Optimal";
}

/** Grams under a kilogram, kilograms above: "598 g", "1.34 kg". */
export const fmtW = (g: number) => (g < 1000 ? `${Math.round(g)} g` : `${(g / 1000).toFixed(2)} kg`);

/** "498 – 539 g" or "1.30 – 1.40 kg": the unit once when both ends share it. */
export function rangeLabel(lo: number, hi: number) {
  if (lo < 1000 && hi < 1000) return `${Math.round(lo)} – ${Math.round(hi)} g`;
  if (lo >= 1000 && hi >= 1000) return `${(lo / 1000).toFixed(2)} – ${(hi / 1000).toFixed(2)} kg`;
  return `${fmtW(lo)} – ${fmtW(hi)}`;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** What GET /growth/weight-spread answers: the newest grow-out day (up to today) that has typed-in weights. */
export interface WeightSpread {
  /** The day the weights were typed in for, or null when none have been. */
  day: number | null;
  n: number;
  /** The breed standard for that day. */
  standardG: number | null;
  birds: { id: string; weightG: number }[];
}

export const NO_SPREAD: WeightSpread = { day: null, n: 0, standardG: null, birds: [] };

export interface FlockWeights {
  /** Today's grow-out day, the day the window starts and its last day. */
  day: number;
  startDay: number;
  endDay: number;
  /** The day the weights were typed in for (not always today), and the standard for that day. */
  measuredDay: number | null;
  standardG: number | null;
  /** The birds weighed on that day. */
  birds: { id: string; weightG: number }[];
  /** How many birds are in the pen (the house the camera watches), when known. */
  population: number | null;
  avgG: number | null;
  medianG: number | null;
  sdG: number | null;
  /** Percent above (+) or below (−) the standard, null with no weights. */
  variancePercent: number | null;
  breakdown: Record<WeightCategory, number>;
  /** The breed's target for the last day, and the weight the flock is heading for if it stays as far ahead or behind. */
  endStandardG: number | null;
  projectedHarvestG: number | null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Everything the weight pages show, from the overview (/operations/overview) and the typed-in weights. */
export function buildFlockWeights(overview: any, spread: WeightSpread = NO_SPREAD): FlockWeights {
  const cycle = overview?.cycle ?? null;
  const day = num(cycle?.day) ?? DEFAULT_START_DAY;
  const startDay = num(cycle?.startDay) ?? DEFAULT_START_DAY;
  const endDay = num(cycle?.endDay ?? cycle?.lengthDays) ?? DEFAULT_END_DAY;

  const birds = spread.birds.filter((b) => Number.isFinite(b.weightG) && b.weightG > 0);
  const weights = birds.map((b) => b.weightG);
  const avgG = weights.length ? Math.round(weights.reduce((s, w) => s + w, 0) / weights.length) : null;
  const sdG =
    avgG !== null && weights.length > 1
      ? Math.round(Math.sqrt(weights.reduce((s, w) => s + (w - avgG) ** 2, 0) / (weights.length - 1)))
      : null;
  const standardG = spread.standardG;
  const variancePercent = avgG !== null && standardG ? Number((((avgG - standardG) / standardG) * 100).toFixed(1)) : null;

  const breakdown: Record<WeightCategory, number> = { Underweight: 0, Optimal: 0, Overweight: 0 };
  if (standardG) for (const w of weights) breakdown[weightCategoryFor(w, standardG)]++;

  const stdCurve: { day: number; standardG: number }[] = Array.isArray(overview?.weight?.standardCurve) ? overview.weight.standardCurve : [];
  const endStandardG = num(stdCurve.find((p) => Number(p.day) === endDay)?.standardG);

  const houses: { id: string; population: number | string }[] = overview?.houses ?? [];
  const house = houses.find((h) => h.id === overview?.cluster?.houseId);

  return {
    day,
    startDay,
    endDay,
    measuredDay: spread.day,
    standardG,
    birds,
    population: house ? num(house.population) : null,
    avgG,
    medianG: weights.length ? Math.round(median(weights)) : null,
    sdG,
    variancePercent,
    breakdown,
    endStandardG,
    projectedHarvestG: endStandardG && avgG !== null && standardG ? Math.round((endStandardG * avgG) / standardG) : null,
  };
}

/** The breed standard for today (the Dashboard's dashed line), whether or not anyone has weighed birds. */
export function standardForToday(overview: any): number | null {
  const day = num(overview?.cycle?.day);
  const curve: { day: number; standardG: number }[] = Array.isArray(overview?.weight?.standardCurve) ? overview.weight.standardCurve : [];
  return day !== null ? num(curve.find((p) => Number(p.day) === day)?.standardG) : null;
}
