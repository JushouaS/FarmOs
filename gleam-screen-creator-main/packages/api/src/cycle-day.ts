import type { FastifyInstance } from "fastify";

/**
 * The grow-out day.
 *
 * The flock is on `startDay` on the calendar day `startedOn`, then ages one day
 * per day up to CYCLE_END_DAY. Both live in one `system_settings` row (key
 * "cycle") that Settings writes. Everything day-dependent (the Day n / 45
 * header, the growth chart's range, the weight standard for today) is worked
 * out here, so no page has to assume a day.
 */

/** Ross 308 grow-out ends at day 45; the day never counts past it. */
export const CYCLE_END_DAY = 45;
/** The day the flock is on until someone changes it in Settings. */
export const CYCLE_DEFAULT_START_DAY = 16;

export interface CycleSetting {
  startDay: number;
  /** Calendar date (YYYY-MM-DD) on which the flock was on `startDay`. */
  startedOn: string;
}

export interface WeightPoint {
  day: number;
  actualG: number;
  standardG: number;
}

const DAY_MS = 86_400_000;

const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);

export const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The database's calendar date, so the day does not depend on the API server's clock or zone. */
export async function databaseToday(app: FastifyInstance): Promise<string> {
  const rows = await app.sqlRead`SELECT CURRENT_DATE::text AS today`;
  return String(rows[0]!.today);
}

export async function readCycleSetting(app: FastifyInstance, today: string): Promise<CycleSetting> {
  const rows = await app.sqlRead`SELECT value FROM system_settings WHERE key = 'cycle'`;
  const v = (rows[0]?.value ?? {}) as Partial<CycleSetting>;
  const startDay = Number(v.startDay);
  return {
    startDay: Number.isInteger(startDay) && startDay >= 1 && startDay <= CYCLE_END_DAY ? startDay : CYCLE_DEFAULT_START_DAY,
    startedOn: typeof v.startedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.startedOn) ? v.startedOn : today,
  };
}

/** Today's grow-out day: counts up from `startDay`, never before it and never past day 45. */
export function currentDay(setting: CycleSetting, today: string): number {
  const elapsed = Math.max(0, daysBetween(setting.startedOn, today));
  return Math.min(CYCLE_END_DAY, setting.startDay + elapsed);
}

/**
 * A value on the stored curve for any day: straight line between the two
 * stored days around it, continuing the nearest segment's slope outside them
 * (the stored rows stop at day 42 and the grow-out runs to 45).
 */
function lerp(points: { day: number; v: number }[], day: number): number | null {
  if (points.length === 0) return null;
  if (points.length === 1) return points[0]!.v;
  const sorted = [...points].sort((a, b) => a.day - b.day);
  let i = sorted.findIndex((p) => p.day >= day);
  if (i === -1) i = sorted.length - 1;
  if (i === 0) i = 1;
  const a = sorted[i - 1]!;
  const b = sorted[i]!;
  return a.v + ((b.v - a.v) * (day - a.day)) / (b.day - a.day);
}

export function weightAtDay(rows: WeightPoint[], day: number): { actualG: number; standardG: number } | null {
  const exact = rows.find((r) => r.day === day);
  if (exact) return { actualG: exact.actualG, standardG: exact.standardG };
  const actualG = lerp(rows.map((r) => ({ day: r.day, v: r.actualG })), day);
  const standardG = lerp(rows.map((r) => ({ day: r.day, v: r.standardG })), day);
  return actualG === null || standardG === null ? null : { actualG: Math.round(actualG), standardG: Math.round(standardG) };
}

/** The breed's target weight for every day of the window, the dashed line on the growth chart. */
export function standardCurve(rows: WeightPoint[], fromDay: number, toDay: number) {
  const out: { day: number; standardG: number }[] = [];
  for (let day = fromDay; day <= toDay; day++) {
    const w = weightAtDay(rows, day);
    if (w) out.push({ day, standardG: w.standardG });
  }
  return out;
}

/**
 * The weigh-ins to date: one point per day from the start day to today. A day
 * with a stored weigh-in uses it; for any other day the stored curve is read at
 * that day, a stand-in until the scans write one row per day.
 */
export function curveToDate(rows: WeightPoint[], fromDay: number, today: number): WeightPoint[] {
  const out: WeightPoint[] = [];
  for (let day = fromDay; day <= today; day++) {
    const w = weightAtDay(rows, day);
    if (w) out.push({ day, ...w });
  }
  return out;
}
