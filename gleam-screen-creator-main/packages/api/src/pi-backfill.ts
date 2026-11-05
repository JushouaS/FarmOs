import type { FastifyInstance } from "fastify";
import { env } from "./config.js";
import { statusFor } from "./sensor-monitor.js";

/**
 * Fills the gaps in the stored temperature and humidity from the files the Raspberry Pi keeps.
 *
 * The API stores a reading each time it asks the Pi for one, so while the laptop is off, asleep, or cannot
 * reach the Pi, nothing is stored. The Pi writes its own row every minute (cerebroil-stream/daily_log.py, files
 * sensors-YYYY-MM-DD.csv). Once the laptop is back this reads those files and stores only the readings that fall
 * in a gap: one that already has a stored reading within TOLERANCE_MS is left alone, so running it again, or
 * running it while the live polling works, adds nothing.
 *
 * Behaviour files are not read back: the Pi writes counts without the day or night rule and with other columns
 * than behavior_snapshots, so they stay as CSV for the daily export rather than being squeezed into that table.
 */

const SENSORS = [
  { id: "SN-DHT22-T", field: "temperature", unit: "°C", min: -40, max: 80 },
  { id: "SN-DHT22-H", field: "humidity", unit: "%", min: 0, max: 100 },
] as const;

/** A stored reading this close to a file row is the same reading, or close enough that the row adds nothing. */
export const TOLERANCE_MS = 90_000;

export interface PiSensorRow {
  /** When the sensor was read: the time the row was written minus the age of the reading. */
  at: number;
  temperature: number | null;
  humidity: number | null;
}

/** One CSV line into fields; a field may be in double quotes with "" for a quote. */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const number = (text: string | undefined): number | null => {
  if (text === undefined || text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/**
 * The rows of a sensors-*.csv that carry a reading. A row cut short by a power cut, one with an unreadable time,
 * one with no value, a value outside what the sensor can measure, and a reading that appears twice are all left out.
 */
export function parseSensorCsv(text: string, now = Date.now()): PiSensorRow[] {
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.startsWith("time,temperature_c,humidity_pct,reading_age_s")) return [];
  const seen = new Set<number>();
  const rows: PiSensorRow[] = [];
  for (const line of lines.slice(1)) {
    const f = fields(line);
    if (f.length < 5) continue;
    const wrote = Date.parse(f[0]!);
    const age = number(f[3]);
    if (!Number.isFinite(wrote) || age === null || age < 0) continue;
    const at = Math.round((wrote - age * 1000) / 1000) * 1000;
    if (at > now + 5 * 60_000 || seen.has(at)) continue;
    let temperature = number(f[1]);
    let humidity = number(f[2]);
    if (temperature !== null && (temperature < SENSORS[0].min || temperature > SENSORS[0].max)) temperature = null;
    if (humidity !== null && (humidity < SENSORS[1].min || humidity > SENSORS[1].max)) humidity = null;
    if (temperature === null && humidity === null) continue;
    seen.add(at);
    rows.push({ at, temperature, humidity });
  }
  return rows;
}

/** The rows with no stored reading within `toleranceMs`. `storedMs` is the stored reading times, in any order. */
export function rowsToFill(rows: PiSensorRow[], storedMs: number[], toleranceMs = TOLERANCE_MS): PiSensorRow[] {
  const stored = [...storedMs].sort((a, b) => a - b);
  return rows.filter((row) => {
    let lo = 0;
    let hi = stored.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (stored[mid]! < row.at) lo = mid + 1;
      else hi = mid;
    }
    const before = lo > 0 ? row.at - stored[lo - 1]! : Infinity;
    const after = lo < stored.length ? stored[lo]! - row.at : Infinity;
    return Math.min(before, after) > toleranceMs;
  });
}

const FILE = /^sensors-\d{4}-\d{2}-\d{2}\.csv$/;

export interface BackfillResult {
  files: number;
  stored: number;
}

/** Reads the newest `days` sensor files from the Pi and stores the readings that fall in a gap. */
export async function backfillSensors(
  app: FastifyInstance,
  days = 2,
  source: { baseUrl: string; token: string } = { baseUrl: env.SENSOR_SOURCE_URL ?? env.VISION_SERVICE_URL, token: env.VISION_SERVICE_TOKEN },
): Promise<BackfillResult> {
  const base = source.baseUrl;
  const headers = { "X-Vision-Token": source.token };
  const listed = await fetch(`${base}/logs`, { headers, signal: AbortSignal.timeout(8_000) });
  if (!listed.ok) throw new Error(`the Pi's file list answered HTTP ${listed.status}`);
  const names = ((await listed.json()) as { files?: { name: string }[] }).files
    ?.map((f) => f.name)
    .filter((n) => FILE.test(n))
    .sort()
    .reverse()
    .slice(0, days);
  if (!names?.length) return { files: 0, stored: 0 };

  const bounds = new Map<string, { lower: number | null; upper: number | null }>();
  for (const sensor of SENSORS) {
    const rows = await app.sqlRead`
      SELECT lower_bound AS lower, upper_bound AS upper
      FROM sensor_bounds
      WHERE sensor_id = ${sensor.id} AND effective_from <= CURRENT_DATE
        AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
      ORDER BY effective_from DESC LIMIT 1`;
    bounds.set(sensor.id, {
      lower: rows[0]?.lower != null ? Number(rows[0].lower) : null,
      upper: rows[0]?.upper != null ? Number(rows[0].upper) : null,
    });
  }

  let stored = 0;
  for (const name of names) {
    const res = await fetch(`${base}/logs/${name}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) continue;
    const rows = parseSensorCsv(await res.text());
    if (rows.length === 0) continue;
    const from = new Date(Math.min(...rows.map((r) => r.at)) - TOLERANCE_MS);
    const to = new Date(Math.max(...rows.map((r) => r.at)) + TOLERANCE_MS);
    const have = await app.sqlRead`
      SELECT recorded_at FROM sensor_readings
      WHERE sensor_id IN ('SN-DHT22-T', 'SN-DHT22-H') AND recorded_at BETWEEN ${from} AND ${to}`;
    const missing = rowsToFill(rows, have.map((r) => new Date(r.recorded_at as string | Date).getTime()));
    for (const row of missing) {
      for (const sensor of SENSORS) {
        const value = row[sensor.field];
        if (value === null) continue;
        const b = bounds.get(sensor.id)!;
        await app.sqlWrite`
          INSERT INTO sensor_readings (sensor_id, value, unit, status, recorded_at)
          VALUES (${sensor.id}, ${value}, ${sensor.unit}, ${statusFor(value, b.lower, b.upper)}, ${new Date(row.at)})`;
        stored++;
      }
    }
  }
  return { files: names.length, stored };
}

/** Runs the gap-fill shortly after start-up and then every PI_BACKFILL_MINUTES. 0 turns it off. */
export function startPiBackfill(app: FastifyInstance): void {
  if (env.SENSOR_MONITOR === "off" || env.PI_BACKFILL_MINUTES <= 0) return;
  let running = false;
  let warned = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const done = await backfillSensors(app);
      warned = false;
      if (done.stored > 0) app.log.info(done, "filled a gap in the sensor readings from the Pi's files");
    } catch (err) {
      // The Pi being off or older than this feature is normal; say so once, not every hour.
      if (!warned) app.log.info({ err: err instanceof Error ? err.message : err }, "sensor gap-fill: the Pi's files are not available");
      warned = true;
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), 45_000);
  const timer = setInterval(() => void run(), env.PI_BACKFILL_MINUTES * 60_000);
  first.unref();
  timer.unref();
  app.addHook("onClose", async () => {
    clearTimeout(first);
    clearInterval(timer);
  });
  app.log.info({ everyMinutes: env.PI_BACKFILL_MINUTES }, "sensor gap-fill started");
}
