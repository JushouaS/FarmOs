import {
  broilers as BASE_BIRDS,
  farm as BASE_FARM,
  kinectDetections as BASE_KINECT,
  morpho,
  type BroilerBird,
  type KinectDetection,
  type WeightCategory,
} from "./dataset";
import type { FarmDataset } from "./types";

/**
 * The built-in sample flock, moved to the grow-out day Settings sets.
 *
 * The sample (dataset.ts) was written for one day. The pages that still run on
 * it (Flock Tracking, Analytics, Live Camera, Insights) must still agree with
 * the day and the weight the Dashboard shows, so this takes the API's
 * /operations/overview (the day, the breed standard for that day, the flock's
 * average weight) and rescales the sample around it: same spread of birds,
 * same behaviours, weights that match the day. Nothing here is stored.
 */

/** Under 92% of the breed standard for the day a bird is underweight; over 115% it is heavy. */
export const UNDERWEIGHT_RATIO = 0.92;
export const HEAVY_RATIO = 1.15;

/** The grow-out window when the API does not say (Settings default). */
export const DEFAULT_START_DAY = 16;
export const DEFAULT_END_DAY = 45;

/** The sample's standard weight before it is moved: its numbers were written around this. */
const BASE_STANDARD_G = 1300;

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

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

export interface SampleFlock {
  /** The grow-out day, the day the window starts, and the last day. */
  day: number;
  startDay: number;
  endDay: number;
  standardG: number;
  farm: FarmDataset;
  broilers: BroilerBird[];
  kinect: KinectDetection[];
  weightBreakdown: Record<WeightCategory, number>;
}

export function sampleForDay(overview: any): SampleFlock {
  const cycle = overview?.cycle ?? null;
  const weight = overview?.weight ?? null;

  const day = num(cycle?.day) ?? BASE_FARM.cycle.day;
  const startDay = num(cycle?.startDay) ?? DEFAULT_START_DAY;
  const endDay = num(cycle?.endDay ?? cycle?.lengthDays) ?? DEFAULT_END_DAY;
  const standardG = num(weight?.standardG) ?? BASE_STANDARD_G;

  const baseAvg = mean(BASE_BIRDS.map((b) => b.weightG));
  const targetAvg = num(weight?.actualAvgG) ?? baseAvg * (standardG / BASE_STANDARD_G);
  const k = targetAvg / baseAvg;

  const birds: BroilerBird[] = BASE_BIRDS.map((b) => {
    const weightG = Math.round(b.weightG * k);
    return { ...b, weightG, ...morpho(weightG) };
  });
  const avgG = Math.round(mean(birds.map((b) => b.weightG)));
  const variancePercent = standardG ? Number((((avgG - standardG) / standardG) * 100).toFixed(1)) : 0;

  // The target curve for the whole window and the weights to date.
  const stdCurve: { day: number; standardG: number }[] = Array.isArray(weight?.standardCurve) ? weight.standardCurve : [];
  const actualByDay = new Map<number, number>(
    (Array.isArray(weight?.curve) ? weight.curve : []).map((p: any) => [Number(p.day), Number(p.actualG)]),
  );
  const curve = stdCurve.length
    ? stdCurve.map((p) => ({
        day: Number(p.day),
        standardG: Number(p.standardG),
        actualG: Number(p.day) === day ? avgG : Number(p.day) < day ? (actualByDay.get(Number(p.day)) ?? 0) : 0,
      }))
    : BASE_FARM.weight.curve;

  // Gain per day: the standard's step into today, carried by how far ahead or behind the flock is.
  const yesterday = stdCurve.find((p) => Number(p.day) === day - 1);
  const adgG = yesterday ? Math.round((standardG - Number(yesterday.standardG)) * (1 + variancePercent / 100)) : BASE_FARM.feed.adgG;
  // Feed eaten so far: the bodyweight the pen has put on, at the flock's feed conversion.
  const cycleConsumedKg = Number((birds.length * Math.max(0, avgG / 1000 - 0.042) * BASE_FARM.feed.fcr).toFixed(1));

  const weights = birds.map((b) => b.weightG);
  const farm: FarmDataset = {
    ...BASE_FARM,
    cycle: {
      ...BASE_FARM.cycle,
      day,
      startDate: typeof cycle?.startDate === "string" ? cycle.startDate : BASE_FARM.cycle.startDate,
      projectedYieldDate: typeof cycle?.projectedYieldDate === "string" ? cycle.projectedYieldDate : BASE_FARM.cycle.projectedYieldDate,
      windowStart: typeof cycle?.windowStart === "string" ? cycle.windowStart : BASE_FARM.cycle.windowStart,
      windowEnd: typeof cycle?.windowEnd === "string" ? cycle.windowEnd : BASE_FARM.cycle.windowEnd,
    },
    weight: {
      ...BASE_FARM.weight,
      actualAvgG: avgG,
      standardG,
      variancePercent,
      status: variancePercent >= 0 ? "optimal" : variancePercent > -5 ? "nominal" : "warning",
      estimationConfidencePercent: num(weight?.estimationConfidencePercent) ?? BASE_FARM.weight.estimationConfidencePercent,
      curve,
    },
    cohorts: BASE_FARM.cohorts.map((c) => ({
      ...c,
      minG: Math.min(...weights),
      maxG: Math.max(...weights),
      medianG: Math.round(c.medianG * k),
      standardDeviationG: Math.round(c.standardDeviationG * k),
    })),
    feed: { ...BASE_FARM.feed, adgG, cycleConsumedKg },
    volumetric: { ...BASE_FARM.volumetric, calculatedMassG: avgG, ...morpho(avgG) },
    detections: BASE_FARM.detections.map((d) => {
      const w = Math.round(d.estimatedWeightG * k);
      const size = 46 + (w > standardG ? 4 : 0);
      return { ...d, estimatedWeightG: w, box: { ...d.box, width: size, height: size } };
    }),
    alerts: BASE_FARM.alerts.map((a) => {
      if (a.id !== "ALT-003") return a;
      const low = birds.find((b) => b.flag === "LOW_WEIGHT");
      return low
        ? { ...a, message: `${low.id} estimated at ${low.weightG.toLocaleString()} g, underweight (under ${Math.round(standardG * UNDERWEIGHT_RATIO).toLocaleString()} g for Day ${day}). Monitor closely.` }
        : a;
    }),
  };

  const weightBreakdown: Record<WeightCategory, number> = { Underweight: 0, Optimal: 0, Overweight: 0 };
  for (const b of birds) weightBreakdown[weightCategoryFor(b.weightG, standardG)]++;

  return {
    day,
    startDay,
    endDay,
    standardG,
    farm,
    broilers: birds,
    kinect: BASE_KINECT.map((kd) => ({ ...kd, weightG: Math.round(kd.weightG * k) })),
    weightBreakdown,
  };
}
