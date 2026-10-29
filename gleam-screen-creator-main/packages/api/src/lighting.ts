import type { FastifyInstance } from "fastify";

/**
 * The farm's lighting hours: when the day starts and when the night starts
 * (local time, HH:MM). Stored in one `system_settings` row (key "lighting")
 * that Settings writes, and sent to the pages in /operations/overview.
 */
export interface Lighting {
  dayStart: string;
  nightStart: string;
}

export const DEFAULT_LIGHTING: Lighting = { dayStart: "05:00", nightStart: "17:00" };

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function readLighting(app: FastifyInstance): Promise<Lighting> {
  const rows = await app.sqlRead`SELECT value FROM system_settings WHERE key = 'lighting'`;
  const v = (rows[0]?.value ?? {}) as Partial<Lighting>;
  const dayStart = typeof v.dayStart === "string" && HHMM.test(v.dayStart) ? v.dayStart : DEFAULT_LIGHTING.dayStart;
  const nightStart = typeof v.nightStart === "string" && HHMM.test(v.nightStart) ? v.nightStart : DEFAULT_LIGHTING.nightStart;
  // Equal times would make the day zero or 24 hours long; fall back to the default.
  return dayStart === nightStart ? DEFAULT_LIGHTING : { dayStart, nightStart };
}
