/**
 * The data behind the dashboard's Growth card, and the one place that reads it
 * out of the /operations/overview response.
 *
 * The card (components/farm/GrowthCard.tsx) shows nothing of its own: every
 * name, number, unit and status on it comes from `GrowthCardData`, and a field
 * the API did not send is null and shows as "—". So connecting more data means
 * filling a field here, not editing the card.
 *
 *   field                     comes from (overview response)
 *   standardName              facility.breed                    e.g. "Ross 308"
 *   cycleDay / cycleLength    cycle.day / cycle.lengthDays (the last day, 45)
 *   cycleStart                cycle.startDay (the day the window starts, Settings)
 *   curve                     weight.curve[]  { day, actualG, standardG } up to today
 *   standardCurve             weight.standardCurve[]  { day, standardG } to the last day
 *   actualG / standardG       weight.actualAvgG / weight.standardG
 *   variancePercent           weight.variancePercent
 *   confidencePercent         weight.estimationConfidencePercent
 *   sampleSize                weight.sampleSize
 *   fcr                       feed.fcr
 *   flock                     houses[].population (the camera's house), activity.value
 *   temperature / humidity /  cluster.readings[] by `parameter`:
 *   ammonia                   temperature, humidity, nh3  { value, unit, status, bounds.label }
 */

export interface GrowthPoint {
  day: number;
  actualG: number;
  standardG: number;
}

export interface GrowthReading {
  value: number | null;
  /** As stored ("PPM", "%", "°C"); format with `formatUnit`. */
  unit: string | null;
  /** The allowed range as text, e.g. "<= 25 ppm". */
  range: string | null;
  /** "nominal" | "warning" | "critical" | "deviation", as the sensor pipeline set it. */
  status: string | null;
}

export interface GrowthCardData {
  standardName: string | null;
  cycleDay: number | null;
  cycleLength: number;
  /** The first day on the chart: the start day set in Settings. */
  cycleStart: number;
  curve: GrowthPoint[];
  /** The breed's target for every day of the window, so the target line runs to the last day. */
  standardCurve: { day: number; standardG: number }[];
  actualG: number | null;
  standardG: number | null;
  variancePercent: number | null;
  confidencePercent: number | null;
  sampleSize: number | null;
  fcr: number | null;
  flock: { total: number | null; active: number | null; inactive: number | null };
  temperature: GrowthReading;
  humidity: GrowthReading;
  ammonia: GrowthReading;
}

/** Used only when the API does not say where the grow-out starts and ends (days 16 to 45). */
export const DEFAULT_CYCLE_LENGTH = 45;
export const DEFAULT_CYCLE_START = 16;

/** Postgres numerics arrive as strings; "", null and NaN become null. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function reading(readings: any[], parameter: string): GrowthReading {
  const r = readings.find((x) => x?.parameter === parameter);
  return {
    value: num(r?.value),
    unit: typeof r?.unit === "string" ? r.unit : null,
    range: typeof r?.bounds?.label === "string" ? r.bounds.label : null,
    status: typeof r?.status === "string" ? r.status : null,
  };
}

export function buildGrowthCardData(overview: any): GrowthCardData {
  const curve: GrowthPoint[] = [];
  for (const p of overview?.weight?.curve ?? []) {
    const day = num(p?.day);
    const actualG = num(p?.actualG);
    const standardG = num(p?.standardG);
    if (day !== null && actualG !== null && standardG !== null) curve.push({ day, actualG, standardG });
  }
  curve.sort((a, b) => a.day - b.day);
  const last = curve[curve.length - 1];
  const standardCurve: { day: number; standardG: number }[] = [];
  for (const p of overview?.weight?.standardCurve ?? []) {
    const day = num(p?.day);
    const standardG = num(p?.standardG);
    if (day !== null && standardG !== null) standardCurve.push({ day, standardG });
  }
  standardCurve.sort((a, b) => a.day - b.day);

  const actualG = num(overview?.weight?.actualAvgG) ?? last?.actualG ?? null;
  const standardG = num(overview?.weight?.standardG) ?? last?.standardG ?? null;
  const variance =
    num(overview?.weight?.variancePercent) ??
    (actualG !== null && standardG ? ((actualG - standardG) / standardG) * 100 : null);

  // The flock count is the house the live camera watches, as on the Live Camera page.
  const houses: { id: string; population: number | string }[] = overview?.houses ?? [];
  const house = houses.find((h) => h.id === overview?.cluster?.houseId);
  const total = house
    ? num(house.population)
    : houses.length > 0
      ? houses.reduce((sum, h) => sum + (num(h.population) ?? 0), 0)
      : null;
  // null, not 0, while no activity is recorded: 0 would read as "every bird inactive".
  const activityPct = num(overview?.activity?.value);
  const active = total !== null && activityPct !== null ? Math.round((total * activityPct) / 100) : null;

  const readings: any[] = overview?.cluster?.readings ?? [];

  return {
    standardName: typeof overview?.facility?.breed === "string" ? overview.facility.breed : null,
    cycleDay: num(overview?.cycle?.day) ?? last?.day ?? null,
    cycleLength: num(overview?.cycle?.lengthDays) ?? DEFAULT_CYCLE_LENGTH,
    cycleStart: num(overview?.cycle?.startDay) ?? curve[0]?.day ?? DEFAULT_CYCLE_START,
    curve,
    standardCurve,
    actualG,
    standardG,
    variancePercent: variance,
    confidencePercent: num(overview?.weight?.estimationConfidencePercent),
    sampleSize: num(overview?.weight?.sampleSize),
    fcr: num(overview?.feed?.fcr),
    flock: { total, active, inactive: active !== null && total !== null ? total - active : null },
    temperature: reading(readings, "temperature"),
    humidity: reading(readings, "humidity"),
    ammonia: reading(readings, "nh3"),
  };
}

/** "PPM" -> "ppm", "LX" -> "lx"; units with symbols ("°C", "%") stay as stored. */
export function formatUnit(unit: string | null): string | undefined {
  if (!unit) return undefined;
  return /^[A-Z/]+$/.test(unit) ? unit.toLowerCase() : unit;
}
