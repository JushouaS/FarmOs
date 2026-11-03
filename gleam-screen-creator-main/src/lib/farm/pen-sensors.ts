/**
 * The pen's real sensor readings, from the dashboard data (`cluster.readings`).
 *
 * The DHT22 on the Raspberry Pi is stored about once a minute. A reading older than this is the
 * seeded sample from 2024 or a sensor that has stopped, and must not be shown as the pen's air.
 */
export const FRESH_MS = 5 * 60_000;

export interface PenReading {
  value: number;
  unit: string;
  /** "nominal", "warning" or "critical". */
  status: string;
}

export function freshReading(overview: any, parameter: "temperature" | "humidity", now = Date.now()): PenReading | null {
  const readings: any[] = overview?.cluster?.readings ?? [];
  const found = readings
    .filter((r) => r?.parameter === parameter && r.recordedAt)
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))[0];
  if (!found) return null;
  const at = Date.parse(found.recordedAt);
  const value = Number(found.value);
  if (!Number.isFinite(at) || !Number.isFinite(value) || now - at > FRESH_MS) return null;
  return { value, unit: String(found.unit ?? ""), status: String(found.status ?? "nominal") };
}

/**
 * How long ago a sensor last reported, when it has gone quiet: more than the fresh limit and at most a week.
 * Older than that is the seeded sample from 2024 or a sensor that was never connected, which is not "offline".
 */
export function silentFor(overview: any, parameter: "temperature" | "humidity", now = Date.now()): number | null {
  const readings: any[] = overview?.cluster?.readings ?? [];
  const times = readings
    .filter((r) => r?.parameter === parameter && r.recordedAt)
    .map((r) => Date.parse(r.recordedAt))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return null;
  const age = now - Math.max(...times);
  return age > FRESH_MS && age <= 7 * 24 * 3_600_000 ? age : null;
}
