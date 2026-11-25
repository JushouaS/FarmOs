import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type postgres from "postgres";
import { parsePiCsv } from "./pi-csv.js";
import { parseSensorCsv, rowsToFill, TOLERANCE_MS, type PiSensorRow } from "./pi-backfill.js";
import { piLogDate, piLogSensorKind, safePiLogPath } from "./pi-logs.js";
import { statusFor } from "./sensor-monitor.js";

interface SourceFile {
  path: string;
  date: string;
  kind: "temperature" | "humidity" | "combined" | "ammonia" | "behavior";
  text: string;
}

export interface PiAmmoniaRow {
  recordedAt: string;
  ammoniaPpm: number | null;
  error: string | null;
  sourceFile: string;
  sourceRow: number;
}

export interface PiBehaviorRow {
  recordedAt: string;
  birds: number | null;
  stillBirds: number | null;
  huddledBirds: number | null;
  flockMoving: number | null;
  huddleFdi: number | null;
  error: string | null;
  sourceFile: string;
  sourceRow: number;
}

interface ImportedPiHistory {
  sensorReadings: number;
  ammoniaRows: number;
  behaviorRows: number;
  files: number;
}

type JsonRecord = { [key: string]: postgres.JSONValue };

function nullableNumber(value: string | undefined, min: number, max: number): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function nullableCount(value: string | undefined): number | null {
  const parsed = nullableNumber(value, 0, Number.MAX_SAFE_INTEGER);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function column(header: string[], name: string): number {
  return header.indexOf(name);
}

function cell(row: string[], index: number): string | undefined {
  return index < 0 ? undefined : row[index];
}

function parseTime(value: string | undefined): string | null {
  if (!value) return null;
  const wallTime = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(value);
  if (wallTime && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const [, year, month, day, hour, minute, second = "0", fraction = ""] = wallTime;
    const wallClockMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: process.env.FARM_TZ ?? "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    let utcMs = wallClockMs;
    for (let attempt = 0; attempt < 3; attempt++) {
      const parts = formatter.formatToParts(new Date(utcMs));
      const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
      const formattedAsUtc = Date.UTC(
        part("year"),
        part("month") - 1,
        part("day"),
        part("hour"),
        part("minute"),
        part("second"),
      );
      const adjusted = wallClockMs - (formattedAsUtc - utcMs);
      if (adjusted === utcMs) break;
      utcMs = adjusted;
    }
    const milliseconds = Number(fraction.padEnd(3, "0").slice(0, 3));
    return new Date(utcMs + milliseconds).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function parseError(value: string | undefined): string | null {
  const error = value?.trim();
  return error ? error : null;
}

export function parseAmmoniaCsv(text: string, sourceFile: string): PiAmmoniaRow[] {
  const records = parsePiCsv(text);
  const header = records[0]?.map((value) => value.trim()) ?? [];
  const timeIndex = column(header, "time");
  const timestampIndex = timeIndex >= 0 ? timeIndex : column(header, "timestamp");
  const valueIndex = column(header, "ammonia_ppm");
  const errorIndex = column(header, "error");
  if (timestampIndex < 0 || valueIndex < 0) return [];

  return records.slice(1).flatMap((record, index) => {
    const recordedAt = parseTime(cell(record, timestampIndex));
    if (!recordedAt) return [];
    const ammoniaPpm = nullableNumber(cell(record, valueIndex), 0, Number.MAX_SAFE_INTEGER);
    const error = parseError(cell(record, errorIndex));
    if (ammoniaPpm === null && error === null) return [];
    return [{ recordedAt, ammoniaPpm, error, sourceFile, sourceRow: index + 2 }];
  });
}

export function parseBehaviorCsv(text: string, sourceFile: string): PiBehaviorRow[] {
  const records = parsePiCsv(text);
  const header = records[0]?.map((value) => value.trim()) ?? [];
  const timeIndex = column(header, "time");
  const birdsIndex = column(header, "birds");
  const stillIndex = column(header, "still_birds");
  const huddledIndex = column(header, "huddled_birds");
  const movingIndex = column(header, "flock_moving");
  const fdiIndex = column(header, "huddle_fdi");
  const errorIndex = column(header, "error");
  if (timeIndex < 0) return [];

  return records.slice(1).flatMap((record, index) => {
    const recordedAt = parseTime(cell(record, timeIndex));
    if (!recordedAt) return [];
    const birds = nullableCount(cell(record, birdsIndex));
    const stillBirds = nullableCount(cell(record, stillIndex));
    const huddledBirds = nullableCount(cell(record, huddledIndex));
    const flockMoving = nullableNumber(cell(record, movingIndex), 0, 1);
    const huddleFdi = nullableNumber(cell(record, fdiIndex), 0, 1);
    const error = parseError(cell(record, errorIndex));
    if (
      birds === null &&
      stillBirds === null &&
      huddledBirds === null &&
      flockMoving === null &&
      huddleFdi === null &&
      error === null
    ) return [];
    return [{
      recordedAt,
      birds,
      stillBirds,
      huddledBirds,
      flockMoving,
      huddleFdi,
      error,
      sourceFile,
      sourceRow: index + 2,
    }];
  });
}

async function collectFiles(exportsRoot: string): Promise<SourceFile[]> {
  const sources: SourceFile[] = [];
  const days = await readdir(exportsRoot, { withFileTypes: true });

  for (const dayEntry of days) {
    if (!dayEntry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(dayEntry.name)) continue;
    const piRoot = join(exportsRoot, dayEntry.name, "pi");
    try {
      await readdir(piRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }

    const visit = async (directory: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(absolute, relative);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".csv")) continue;
        const safePath = safePiLogPath({ path: relative });
        const date = safePath ? piLogDate(safePath) : null;
        if (!safePath || date !== dayEntry.name) continue;

        const sensorKind = piLogSensorKind(safePath);
        const basename = safePath.split("/").at(-1)!;
        const kind =
          sensorKind ??
          (basename.startsWith("ammonia-") ? "ammonia" : basename.startsWith("behavior-") ? "behavior" : null);
        if (!kind) continue;
        const text = await readFile(absolute, "utf8");
        sources.push({ path: safePath, date, kind, text });
      }
    };
    await visit(piRoot, "");
  }
  return sources;
}

async function insertSensorRows(sql: postgres.Sql, rows: JsonRecord[]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch = rows.slice(offset, offset + 500);
    await sql`
      INSERT INTO sensor_readings (sensor_id, value, unit, status, recorded_at)
      SELECT sensor_id, value, unit, status, recorded_at
      FROM jsonb_to_recordset(${sql.json(batch)}::jsonb)
        AS item(sensor_id text, value numeric, unit text, status text, recorded_at timestamptz)`;
  }
}

async function upsertAmmoniaRows(sql: postgres.Sql, rows: PiAmmoniaRow[]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch: JsonRecord[] = rows.slice(offset, offset + 500).map((row) => ({
      recordedAt: row.recordedAt,
      ammoniaPpm: row.ammoniaPpm,
      error: row.error,
      sourceFile: row.sourceFile,
      sourceRow: row.sourceRow,
    }));
    await sql`
      INSERT INTO pi_ammonia_logs (recorded_at, ammonia_ppm, error, source_file, source_row)
      SELECT "recordedAt", "ammoniaPpm", error, "sourceFile", "sourceRow"
      FROM jsonb_to_recordset(${sql.json(batch)}::jsonb)
        AS item("recordedAt" timestamptz, "ammoniaPpm" numeric, error text, "sourceFile" text, "sourceRow" integer)
      ON CONFLICT (source_file, source_row) DO UPDATE SET
        recorded_at = EXCLUDED.recorded_at,
        ammonia_ppm = EXCLUDED.ammonia_ppm,
        error = EXCLUDED.error`;
  }
}

async function upsertBehaviorRows(sql: postgres.Sql, rows: PiBehaviorRow[]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch: JsonRecord[] = rows.slice(offset, offset + 500).map((row) => ({
      recordedAt: row.recordedAt,
      birds: row.birds,
      stillBirds: row.stillBirds,
      huddledBirds: row.huddledBirds,
      flockMoving: row.flockMoving,
      huddleFdi: row.huddleFdi,
      error: row.error,
      sourceFile: row.sourceFile,
      sourceRow: row.sourceRow,
    }));
    await sql`
      INSERT INTO pi_behavior_logs (
        recorded_at, birds, still_birds, huddled_birds, flock_moving, huddle_fdi, error, source_file, source_row
      )
      SELECT "recordedAt", birds, "stillBirds", "huddledBirds", "flockMoving", "huddleFdi", error, "sourceFile", "sourceRow"
      FROM jsonb_to_recordset(${sql.json(batch)}::jsonb)
        AS item(
          "recordedAt" timestamptz, birds integer, "stillBirds" integer, "huddledBirds" integer,
          "flockMoving" numeric, "huddleFdi" numeric, error text, "sourceFile" text, "sourceRow" integer
        )
      ON CONFLICT (source_file, source_row) DO UPDATE SET
        recorded_at = EXCLUDED.recorded_at,
        birds = EXCLUDED.birds,
        still_birds = EXCLUDED.still_birds,
        huddled_birds = EXCLUDED.huddled_birds,
        flock_moving = EXCLUDED.flock_moving,
        huddle_fdi = EXCLUDED.huddle_fdi,
        error = EXCLUDED.error`;
  }
}

export async function importPiCsvExports(sql: postgres.Sql, exportsRoot: string): Promise<ImportedPiHistory> {
  const sources = await collectFiles(exportsRoot);
  const sensorSources = sources.filter(
    (source): source is SourceFile & { kind: "temperature" | "humidity" | "combined" } =>
      source.kind === "temperature" || source.kind === "humidity" || source.kind === "combined",
  );
  const mergedSensors = new Map<number, PiSensorRow>();
  const ammoniaRows: PiAmmoniaRow[] = [];
  const behaviorRows: PiBehaviorRow[] = [];

  for (const source of sources) {
    const sourceFile = `${source.date}/pi/${source.path}`;
    if (source.kind === "ammonia") ammoniaRows.push(...parseAmmoniaCsv(source.text, sourceFile));
    else if (source.kind === "behavior") behaviorRows.push(...parseBehaviorCsv(source.text, sourceFile));
  }
  for (const source of sensorSources) {
    for (const row of parseSensorCsv(source.text, Date.now(), source.kind)) {
      const current = mergedSensors.get(row.at) ?? { at: row.at, temperature: null, humidity: null };
      mergedSensors.set(row.at, {
        at: row.at,
        temperature: row.temperature ?? current.temperature,
        humidity: row.humidity ?? current.humidity,
      });
    }
  }

  let sensorRowsWritten = 0;
  const sensorValues: JsonRecord[] = [];
  const definitions = [
    { id: "SN-DHT22-T", field: "temperature" as const, unit: "°C" },
    { id: "SN-DHT22-H", field: "humidity" as const, unit: "%" },
  ];
  const rows = [...mergedSensors.values()].sort((a, b) => a.at - b.at);
  if (rows.length) {
    const from = new Date(rows[0]!.at - TOLERANCE_MS);
    const to = new Date(rows[rows.length - 1]!.at + TOLERANCE_MS);
    const existing = await sql`
      SELECT sensor_id, recorded_at FROM sensor_readings
      WHERE sensor_id IN ('SN-DHT22-T', 'SN-DHT22-H') AND recorded_at BETWEEN ${from} AND ${to}`;

    for (const sensor of definitions) {
      const boundsRows = await sql`
        SELECT lower_bound AS lower, upper_bound AS upper FROM sensor_bounds
        WHERE sensor_id = ${sensor.id} AND effective_from <= CURRENT_DATE
          AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        ORDER BY effective_from DESC LIMIT 1`;
      const lower = boundsRows[0]?.lower != null ? Number(boundsRows[0].lower) : null;
      const upper = boundsRows[0]?.upper != null ? Number(boundsRows[0].upper) : null;
      const candidates = rows.filter((row) => row[sensor.field] !== null);
      const storedTimes = existing
        .filter((row) => row.sensor_id === sensor.id)
        .map((row) => new Date(row.recorded_at as string | Date).getTime());
      const missing = rowsToFill(candidates, storedTimes).sort((a, b) => a.at - b.at);
      let previous: number | null = null;
      for (const row of missing) {
        if (previous !== null && row.at - previous <= TOLERANCE_MS) continue;
        const value = row[sensor.field]!;
        sensorValues.push({
          sensor_id: sensor.id,
          value,
          unit: sensor.unit,
          status: statusFor(value, lower, upper),
          recorded_at: new Date(row.at).toISOString(),
        });
        previous = row.at;
      }
    }
    await insertSensorRows(sql, sensorValues);
    sensorRowsWritten = sensorValues.length;
  }

  await upsertAmmoniaRows(sql, ammoniaRows);
  await upsertBehaviorRows(sql, behaviorRows);
  return {
    sensorReadings: sensorRowsWritten,
    ammoniaRows: ammoniaRows.length,
    behaviorRows: behaviorRows.length,
    files: sources.length,
  };
}
