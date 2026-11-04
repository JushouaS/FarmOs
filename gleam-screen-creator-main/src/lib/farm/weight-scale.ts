/**
 * The weight scale the pages grade a bird against: two ratios of the breed's
 * standard for the day, and the two formatters that print grams and kilograms.
 *
 * This is policy, not data — it used to live beside the built-in sample flock
 * (`sample.ts`), which made it look like it came from the sample too.
 */

/** Under 92% of the breed standard for the day a bird is underweight; over 115% it is heavy. */
export const UNDERWEIGHT_RATIO = 0.92;
export const HEAVY_RATIO = 1.15;

export type WeightBand = "Underweight" | "Optimal" | "Overweight";

/** Which of the three bands a weighed bird falls in, against the day's standard. */
export function weightBandFor(weightG: number, standardG: number): WeightBand {
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
