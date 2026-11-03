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

/**
 * One day of the weight table. `standardG` is the breed's target (reference data). `actualG` is a
 * measurement, or null when nothing was measured that day: a day with no measurement is never filled in.
 */
export interface WeightPoint {
  day: number;
  actualG: number | null;
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

/** The breed's target weight for any day, read off the stored standards (a straight line between stored days). */
export function standardAtDay(rows: WeightPoint[], day: number): number | null {
  const v = lerp(rows.map((r) => ({ day: r.day, v: r.standardG })), day);
  return v === null ? null : Math.round(v);
}

/** The newest measurement on or before `day`, with the standard for the day it was measured. */
export function latestMeasured(rows: WeightPoint[], day: number): { day: number; actualG: number; standardG: number } | null {
  let best: WeightPoint | null = null;
  for (const r of rows) {
    if (r.actualG !== null && r.day <= day && (best === null || r.day > best.day)) best = r;
  }
  if (!best || best.actualG === null) return null;
  return { day: best.day, actualG: best.actualG, standardG: standardAtDay(rows, best.day) ?? best.standardG };
}

/** The breed's target weight for every day of the window, the dashed line on the growth chart. */
export function standardCurve(rows: WeightPoint[], fromDay: number, toDay: number) {
  const out: { day: number; standardG: number }[] = [];
  for (let day = fromDay; day <= toDay; day++) {
    const standardG = standardAtDay(rows, day);
    if (standardG !== null) out.push({ day, standardG });
  }
  return out;
}

/** The weigh-ins to date: one point for each day from the start day to today that has a measurement. */
export function curveToDate(rows: WeightPoint[], fromDay: number, today: number): { day: number; actualG: number; standardG: number }[] {
  const out: { day: number; actualG: number; standardG: number }[] = [];
  for (const r of [...rows].sort((a, b) => a.day - b.day)) {
    if (r.actualG === null || r.day < fromDay || r.day > today) continue;
    out.push({ day: r.day, actualG: r.actualG, standardG: standardAtDay(rows, r.day) ?? r.standardG });
  }
  return out;
}
