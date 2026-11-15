import type { FastifyInstance } from "fastify";
import { env } from "./config.js";
import { raiseAlert } from "./notify.js";

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

/** Whole minutes since the last stored reading, or null when there has never been one (a pen with no sensor is not "offline"). */
export function minutesSilent(lastGoodAt: number | null, now: number): number | null {
  return lastGoodAt === null ? null : Math.max(0, Math.floor((now - lastGoodAt) / 60_000));
}

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

/** How long a reading must stay outside its bounds before an alert is raised: one odd reading is not a problem. */
export const OUT_OF_RANGE_MINUTES = 10;

export interface RangeAlert {
  kind: string;
  severity: "warning" | "critical";
  message: string;
}

/**
 * Watches one reading (temperature or humidity) and says when it has stayed outside its bounds for
 * OUT_OF_RANGE_MINUTES. It fires once per excursion; the reading has to come back inside before it can fire again,
 * and raiseAlert's de-duplication keeps a long excursion from repeating within the hour.
 */
export class RangeWatch {
  private outSince: number | null = null;
  private fired = false;
  private worst: "warning" | "critical" = "warning";

  constructor(private readonly label: string, private readonly unit: string, private readonly minutes = OUT_OF_RANGE_MINUTES) {}

  update(value: number, status: "nominal" | "warning" | "critical", lower: number | null, upper: number | null, now: number): RangeAlert | null {
    if (status === "nominal") {
      this.outSince = null;
      this.fired = false;
      this.worst = "warning";
      return null;
    }
    if (status === "critical") this.worst = "critical";
    this.outSince ??= now;
    if (this.fired || now - this.outSince < this.minutes * 60_000) return null;
    this.fired = true;
    const side = upper != null && value > upper ? "above" : "below";
    const limit = side === "above" ? upper : lower;
    const range = lower != null && upper != null ? `${lower}-${upper} ${this.unit}` : `${limit} ${this.unit}`;
    return {
      kind: `${this.label} Out of Range`,
      severity: this.worst,
      message: `${this.label} has been ${side} the safe range (${range}) for ${this.minutes} minutes; now ${value} ${this.unit}. Check the house ventilation, heating and drinkers.`,
    };
  }
}

/** Stores one report. Returns how many readings were written (0 when it was too old or empty). */
export async function storeReport(
  app: FastifyInstance,
  report: SensorReport,
  now = Date.now(),
  watches?: Record<string, RangeWatch>,
): Promise<number> {
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
    const status = statusFor(value, lower, upper);
    await app.sqlWrite`
      INSERT INTO sensor_readings (sensor_id, value, unit, status, recorded_at)
      VALUES (${sensor.id}, ${value}, ${sensor.unit}, ${status}, ${recordedAt})`;
    stored++;
    const alert = watches?.[sensor.id]?.update(value, status, lower, upper, now);
    if (alert) await raiseAlert(app, { ...alert, dedupeMinutes: 60 });
  }
  return stored;
}

/** The time of the newest stored DHT22 reading, so a restart does not forget that the sensor used to work. */
async function newestStoredReading(app: FastifyInstance): Promise<number | null> {
  const rows = await app.sqlRead`SELECT max(recorded_at) AS at FROM sensor_readings WHERE sensor_id IN ('SN-DHT22-T', 'SN-DHT22-H')`;
  const at = rows[0]?.at ? new Date(rows[0].at as string | Date).getTime() : NaN;
  return Number.isFinite(at) ? at : null;
}

export function startSensorMonitor(app: FastifyInstance): void {
  if (env.SENSOR_MONITOR === "off") return;
  let warned = false;
  let lastAt = 0;
  // When a reading was last stored (null: never), and whether this silence has been reported already.
  let lastGoodAt: number | null = null;
  let reported = false;
  // Out-of-range alerts for the live readings: alert when a reading stays outside its stored bounds (Sensors page).
  const watches: Record<string, RangeWatch> = {
    "SN-DHT22-T": new RangeWatch("Temperature", "°C"),
    "SN-DHT22-H": new RangeWatch("Humidity", "%"),
  };
  void newestStoredReading(app).then((at) => {
    lastGoodAt = lastGoodAt ?? at;
  }).catch(() => {});

  // Says so when a sensor that used to report has gone quiet: a wire came loose, the Pi lost power, or the reader stopped.
  const checkSilence = async (why: string) => {
    const silent = minutesSilent(lastGoodAt, Date.now());
    if (silent === null || silent < env.SENSOR_OFFLINE_MINUTES || reported) return;
    reported = true;
    // An outage that was already reported in the last 12 hours (even one somebody has acknowledged) is not reported
    // again just because the API restarted.
    const recent = await app.sqlRead`SELECT 1 FROM alerts WHERE kind = 'Sensor Offline' AND raised_at > now() - interval '12 hours' LIMIT 1`;
    if (recent.length > 0) return;
    await raiseAlert(app, {
      kind: "Sensor Offline",
      severity: "warning",
      message: `The pen temperature and humidity sensor has sent no reading for ${silent} minutes (${why}). Check its wires and power on the Raspberry Pi.`,
    });
  };

  const tick = async () => {
    let report: SensorReport;
    try {
      const res = await fetch(`${env.SENSOR_SOURCE_URL ?? env.VISION_SERVICE_URL}/sensors`, {
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
      await checkSilence("the camera computer is not answering");
      return;
    }
    warned = false;
    // The same reading is not stored twice when the reader is slower than this poll.
    const at = report.ageSeconds != null ? Date.now() - report.ageSeconds * 1000 : 0;
    if (Math.abs(at - lastAt) < 2_000) return;
    const stored = await storeReport(app, report, Date.now(), watches);
    if (stored > 0) {
      lastAt = at;
      lastGoodAt = Date.now();
      reported = false;
    } else {
      await checkSilence(report.error ?? "the sensor did not answer");
    }
  };

  const timer = setInterval(() => void tick().catch((err) => app.log.error({ err }, "sensor monitor failed")), env.SENSOR_POLL_SECONDS * 1000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
  app.log.info({ everySeconds: env.SENSOR_POLL_SECONDS }, "sensor monitor started");
}
