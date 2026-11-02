import type { FastifyInstance } from "fastify";
import { env } from "./config.js";

/**
 * Stores the pen's real temperature and humidity.
 *
 * A DHT22 sensor on the Raspberry Pi is read by dht22_reader.py (its own service there), and the camera
 * service (cerebroil-stream) shows the newest reading at /sensors. Every SENSOR_POLL_SECONDS this asks for it
 * and stores it in sensor_readings for the two sensors migration 0024 adds, so the dashboard and the
 * growth card show it like any other reading.
 */

const SENSORS = [
  { id: "SN-DHT22-T", field: "temperature", unit: "°C" },
  { id: "SN-DHT22-H", field: "humidity", unit: "%" },
] as const;

/** A reading older than this is not stored: the sensor or its reader has stopped. */
const MAX_AGE_SECONDS = 120;

/** What the camera service reports at /sensors. */
export interface SensorReport {
  running: boolean;
  temperature?: number | null;
  humidity?: number | null;
  /** Seconds since the last good reading; null until there has been one. */
  ageSeconds?: number | null;
  error?: string | null;
}

/**
 * "nominal" inside the bounds, "warning" a little outside, "critical" well outside (by more than a fifth
 * of the allowed range). A bound that is null does not apply.
 */
export function statusFor(value: number, lower: number | null, upper: number | null): "nominal" | "warning" | "critical" {
  const span = lower != null && upper != null ? upper - lower : Math.abs(upper ?? lower ?? 0);
  const out = Math.max(lower != null && value < lower ? lower - value : 0, upper != null && value > upper ? value - upper : 0);
  if (out === 0) return "nominal";
  return out > span * 0.2 ? "critical" : "warning";
}

/** Stores one report. Returns how many readings were written (0 when it was too old or empty). */
export async function storeReport(app: FastifyInstance, report: SensorReport, now = Date.now()): Promise<number> {
  if (!report.running || report.ageSeconds == null || report.ageSeconds > MAX_AGE_SECONDS) return 0;
  const recordedAt = new Date(now - report.ageSeconds * 1000);
  let stored = 0;
  for (const sensor of SENSORS) {
    const value = report[sensor.field];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const bounds = await app.sqlRead`
      SELECT lower_bound AS lower, upper_bound AS upper
      FROM sensor_bounds
      WHERE sensor_id = ${sensor.id} AND effective_from <= CURRENT_DATE
        AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
      ORDER BY effective_from DESC LIMIT 1`;
    const lower = bounds[0]?.lower != null ? Number(bounds[0].lower) : null;
    const upper = bounds[0]?.upper != null ? Number(bounds[0].upper) : null;
    await app.sqlWrite`
      INSERT INTO sensor_readings (sensor_id, value, unit, status, recorded_at)
      VALUES (${sensor.id}, ${value}, ${sensor.unit}, ${statusFor(value, lower, upper)}, ${recordedAt})`;
    stored++;
  }
  return stored;
}

export function startSensorMonitor(app: FastifyInstance): void {
  if (env.SENSOR_MONITOR === "off") return;
  let warned = false;
  let lastAt = 0;

  const tick = async () => {
    let report: SensorReport;
    try {
      const res = await fetch(`${env.VISION_SERVICE_URL}/sensors`, {
        headers: { "X-Vision-Token": env.VISION_SERVICE_TOKEN },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      report = (await res.json()) as SensorReport;
    } catch (err) {
      // The camera service being off or older is normal; say so once, not every minute.
      if (!warned) {
        app.log.info({ err: err instanceof Error ? err.message : err }, "sensor monitor: camera service not answering");
        warned = true;
      }
      return;
    }
    warned = false;
    // The same reading is not stored twice when the reader is slower than this poll.
    const at = report.ageSeconds != null ? Date.now() - report.ageSeconds * 1000 : 0;
    if (Math.abs(at - lastAt) < 2_000) return;
    const stored = await storeReport(app, report);
    if (stored > 0) lastAt = at;
  };

  const timer = setInterval(() => void tick().catch((err) => app.log.error({ err }, "sensor monitor failed")), env.SENSOR_POLL_SECONDS * 1000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
  app.log.info({ everySeconds: env.SENSOR_POLL_SECONDS }, "sensor monitor started");
}
