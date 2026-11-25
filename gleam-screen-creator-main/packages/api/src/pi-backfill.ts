import type { FastifyInstance } from "fastify";
import { env } from "./config.js";
import { parsePiCsv } from "./pi-csv.js";
import { encodePiLogPath, piLogDate, piLogSensorKind, safePiLogPath, type PiSensorLogKind } from "./pi-logs.js";
import { statusFor } from "./sensor-monitor.js";

const SENSORS = [
  // What a broiler pen can read. The sensor's own limits are wider (-40 to 80 °C, 0 to 100 %), but its corrupted reads
  // land outside the pen's: 0.0 and 0.1 to 2.4 °C, 51.1 °C, and 0 to 20 % humidity were all found in the Pi's files.
  { id: "SN-DHT22-T", field: "temperature", unit: "°C", min: 5, max: 45 },
  { id: "SN-DHT22-H", field: "humidity", unit: "%", min: 20, max: 100 },
] as const;

export const TOLERANCE_MS = 90_000;

export interface PiSensorRow {
  at: number;
  temperature: number | null;
  humidity: number | null;
}

const number = (text: string | undefined): number | null => {
  if (text === undefined || text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

export function parseSensorCsv(text: string, now = Date.now(), kind?: PiSensorLogKind): PiSensorRow[] {
  const records = parsePiCsv(text);
  if (!records[0]) return [];
  const header = records[0]!.map((value) => value.trim());
  const timeIndex = header.indexOf("time");
  if (timeIndex < 0) return [];
  const ageIndex = header.indexOf("reading_age_s");
  const valueIndex = header.findIndex((column) => column === "value" || column === "reading");
  const temperatureIndex = header.findIndex((column) => column === "temperature_c" || column === "temperature");
  const humidityIndex = header.findIndex((column) => column === "humidity_pct" || column === "humidity");
  const tempIndex = temperatureIndex >= 0 ? temperatureIndex : kind === "temperature" ? valueIndex : -1;
  const humidIndex = humidityIndex >= 0 ? humidityIndex : kind === "humidity" ? valueIndex : -1;
  if (tempIndex < 0 && humidIndex < 0) return [];
  // An older reader wrote 0.0 for a failed read and gave the reason in the error column (e.g. "only 24 of 40 bits
  // arrived"). That 0 is not a reading. A row with an error may still repeat the last good value, so only the 0 goes.
  const errorIndex = header.indexOf("error");
  const seen = new Set<number>();
  const rows: PiSensorRow[] = [];
  for (const f of records.slice(1)) {
    if (f.length <= Math.max(timeIndex, tempIndex, humidIndex, ageIndex)) continue;
    const wrote = Date.parse(f[timeIndex]!);
    const age = ageIndex < 0 ? 0 : number(f[ageIndex]);
    if (!Number.isFinite(wrote) || age === null || age < 0) continue;
    const at = Math.round((wrote - age * 1000) / 1000) * 1000;
    if (at > now + 5 * 60_000 || seen.has(at)) continue;
    let temperature = tempIndex >= 0 ? number(f[tempIndex]) : null;
    let humidity = humidIndex >= 0 ? number(f[humidIndex]) : null;
    if (errorIndex >= 0 && (f[errorIndex] ?? "").trim() !== "") {
      if (temperature === 0) temperature = null;
      if (humidity === 0) humidity = null;
    }
    if (temperature !== null && (temperature < SENSORS[0].min || temperature > SENSORS[0].max)) temperature = null;
    if (humidity !== null && (humidity < SENSORS[1].min || humidity > SENSORS[1].max)) humidity = null;
    if (temperature === null && humidity === null) continue;
    seen.add(at);
    rows.push({ at, temperature, humidity });
  }
  return rows;
}

/* Helpers for the per-reading files (temperature/, humidity/), kept for the file tests and other callers. */
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


export interface PiValueRow {
  at: number;
  value: number;
}

/**
 * The rows of a one-reading file (temperature/temperature-*.csv: time,temperature_c,reading_age_s,error, or
 * humidity/humidity-*.csv: time,humidity_pct,...) that carry a value. Same rules as parseSensorCsv.
 */
export function parseValueCsv(text: string, kind: "temperature" | "humidity", now = Date.now()): PiValueRow[] {
  const sensor = kind === "temperature" ? SENSORS[0] : SENSORS[1];
  const column = kind === "temperature" ? "temperature_c" : "humidity_pct";
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.startsWith(`time,${column},reading_age_s`)) return [];
  const seen = new Set<number>();
  const rows: PiValueRow[] = [];
  for (const line of lines.slice(1)) {
    const f = fields(line);
    if (f.length < 4) continue;
    const wrote = Date.parse(f[0]!);
    const age = number(f[2]);
    const value = number(f[1]);
    if (!Number.isFinite(wrote) || age === null || age < 0 || value === null) continue;
    if (value < sensor.min || value > sensor.max) continue;
    const at = Math.round((wrote - age * 1000) / 1000) * 1000;
    if (at > now + 5 * 60_000 || seen.has(at)) continue;
    seen.add(at);
    rows.push({ at, value });
  }
  return rows;
}

/** Temperature and humidity rows of the same reading (same moment) joined back into one, oldest first. */
export function mergeReadings(temperature: PiValueRow[], humidity: PiValueRow[]): PiSensorRow[] {
  const byAt = new Map<number, PiSensorRow>();
  for (const r of temperature) byAt.set(r.at, { at: r.at, temperature: r.value, humidity: null });
  for (const r of humidity) {
    const row = byAt.get(r.at);
    if (row) row.humidity = r.value;
    else byAt.set(r.at, { at: r.at, temperature: null, humidity: r.value });
  }
  return [...byAt.values()].sort((a, b) => a.at - b.at);
}

/** A file in the Pi's list. `path` is what /logs/<path> takes; a Pi from before the folders gives only `name`. */
export interface PiFile {
  name: string;
  path?: string;
  folder?: string | null;
}

export interface SensorDay {
  date: string;
  temperature?: string;
  humidity?: string;
  /** The old combined file, used only when the day has no separate files. */
  combined?: string;
}

/** The newest `days` days that have sensor files, newest first, with the path of each file for that day. */
export function sensorDays(files: PiFile[], days: number): SensorDay[] {
  const byDate = new Map<string, SensorDay>();
  for (const f of files) {
    const found = /^(temperature|humidity|sensors)-(\d{4}-\d{2}-\d{2})\.csv$/.exec(f.name);
    if (!found) continue;
    const [, kind, date] = found as unknown as [string, "temperature" | "humidity" | "sensors", string];
    const path = f.path ?? f.name;
    const day = byDate.get(date) ?? { date };
    if (kind === "sensors") day.combined = path;
    else day[kind] = path;
    byDate.set(date, day);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, days);
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

export interface BackfillResult {
  files: number;
  stored: number;
}

export async function backfillSensors(
  app: FastifyInstance,
  days = 2,
  source: { baseUrl: string; token: string } = { baseUrl: env.SENSOR_SOURCE_URL ?? env.VISION_SERVICE_URL, token: env.VISION_SERVICE_TOKEN },
): Promise<BackfillResult> {
  const base = source.baseUrl;
  const headers = { "X-Vision-Token": source.token };
  const listed = await fetch(`${base}/logs`, { headers, signal: AbortSignal.timeout(8_000) });
  if (!listed.ok) throw new Error(`the Pi's file list answered HTTP ${listed.status}`);
  const files = ((await listed.json()) as { files?: { name?: unknown; path?: unknown }[] }).files ?? [];
  const candidates = files
    .map((file) => {
      const path = safePiLogPath(file);
      return path ? { path, date: piLogDate(path), kind: piLogSensorKind(path) } : null;
    })
    .filter((file): file is { path: string; date: string; kind: PiSensorLogKind } =>
      file !== null && file.date !== null && file.kind !== null);
  const dates = [...new Set(candidates.map((file) => file.date))].sort().reverse().slice(0, days);
  const selected = candidates.filter((file) => dates.includes(file.date));
  if (selected.length === 0) return { files: 0, stored: 0 };

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

  const merged = new Map<number, PiSensorRow>();
  for (const file of selected) {
    const res = await fetch(`${base}/logs/${encodePiLogPath(file.path)}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`the Pi's log ${file.path} answered HTTP ${res.status}`);
    const rows = parseSensorCsv(await res.text(), Date.now(), file.kind);
    for (const row of rows) {
      const current = merged.get(row.at) ?? { at: row.at, temperature: null, humidity: null };
      merged.set(row.at, {
        at: row.at,
        temperature: row.temperature ?? current.temperature,
        humidity: row.humidity ?? current.humidity,
      });
    }
  }
  const rows = [...merged.values()].filter((row) => row.temperature !== null || row.humidity !== null);
  if (rows.length === 0) return { files: selected.length, stored: 0 };
  const from = new Date(Math.min(...rows.map((row) => row.at)) - TOLERANCE_MS);
  const to = new Date(Math.max(...rows.map((row) => row.at)) + TOLERANCE_MS);
  const have = await app.sqlRead`
    SELECT sensor_id, recorded_at FROM sensor_readings
    WHERE sensor_id IN ('SN-DHT22-T', 'SN-DHT22-H') AND recorded_at BETWEEN ${from} AND ${to}`;

  let stored = 0;
  for (const sensor of SENSORS) {
    const sensorRows = rows.filter((row) => row[sensor.field] !== null);
    const storedTimes = have
      .filter((row) => row.sensor_id === sensor.id)
      .map((row) => new Date(row.recorded_at as string | Date).getTime());
    const missing = rowsToFill(sensorRows, storedTimes);
    for (const row of missing) {
      const value = row[sensor.field]!;
      const boundsForSensor = bounds.get(sensor.id)!;
      await app.sqlWrite`
        INSERT INTO sensor_readings (sensor_id, value, unit, status, recorded_at)
        VALUES (${sensor.id}, ${value}, ${sensor.unit}, ${statusFor(value, boundsForSensor.lower, boundsForSensor.upper)}, ${new Date(row.at)})`;
      stored++;
    }
  }
  return { files: selected.length, stored };
}

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
