/**
 * SVG path builders. Charts are drawn from the dataset's numeric series instead
 * of hand-written path strings, so a chart can never disagree with the figure
 * printed next to it.
 */

interface ScaleOptions {
  /** Lower bound of the value axis; defaults to the series minimum. */
  min?: number;
  /** Upper bound of the value axis; defaults to the series maximum. */
  max?: number;
  /** Vertical breathing room, in viewBox units, kept at both edges. */
  padding?: number;
}

function scaleY(values: number[], height: number, options: ScaleOptions = {}) {
  const padding = options.padding ?? 0;
  const min = options.min ?? Math.min(...values);
  const max = options.max ?? Math.max(...values);
  const span = max - min || 1;
  const usable = height - padding * 2;
  return (value: number) => padding + (1 - (value - min) / span) * usable;
}

/** Polyline through `values`, spread evenly across `width`. */
export function linePath(
  values: number[],
  width: number,
  height: number,
  options: ScaleOptions = {},
): string {
  if (values.length === 0) return "";
  const y = scaleY(values, height, options);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
}

/** Same geometry as `linePath`, closed along the baseline for gradient fills. */
export function areaPath(
  values: number[],
  width: number,
  height: number,
  options: ScaleOptions = {},
): string {
  const line = linePath(values, width, height, options);
  if (!line) return "";
  return `${line} L${width},${height} L0,${height} Z`;
}

/** Coordinates of every value, matching `linePath` geometry, for point markers. */
export function points(
  values: number[],
  width: number,
  height: number,
  options: ScaleOptions = {},
): { x: number; y: number }[] {
  const y = scaleY(values, height, options);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values.map((v, i) => ({ x: i * step, y: y(v) }));
}

/** Evenly spaced horizontal gridline offsets for a chart of `height`. */
export function gridlines(count: number, height: number): number[] {
  return Array.from({ length: count }, (_, i) => ((i + 1) / (count + 1)) * height);
}
