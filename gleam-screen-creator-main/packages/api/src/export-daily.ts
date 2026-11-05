import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type postgres from "postgres";

/**
 * One day's data as plain files, so it can be collected without opening the website: the readings, the
 * behaviour snapshots, the weights, the alerts, and a short health summary that says whether the day is whole.
 *
 *   exports/2026-11-05/sensors.csv  behavior.csv  weights-typed.csv  weights-by-day.csv  alerts.csv
 *                      health.txt   health.json   pi/sensors-2026-11-05.csv  pi/behavior-2026-11-05.csv
 *
 * Run by scripts/export-daily.ts. The day is the farm's calendar day (FARM_TZ), not the database's or the Pi's.
 */

type Row = Record<string, unknown>;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns: string[], rows: Row[]): string {
  return [columns.join(","), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(","))].join("\n") + "\n";
}

export interface Gap {
  from: number;
  to: number;
  minutes: number;
}

/** The silences of at least `minMinutes` between consecutive times, plus the stretch before the first and after the last inside [start, end]. */
export function findGaps(timesMs: number[], startMs: number, endMs: number, minMinutes: number): Gap[] {
  const sorted = [...timesMs].sort((a, b) => a - b);
  const edges = [startMs, ...sorted, endMs];
  const gaps: Gap[] = [];
  for (let i = 1; i < edges.length; i++) {
    const minutes = (edges[i]! - edges[i - 1]!) / 60_000;
    if (minutes >= minMinutes) gaps.push({ from: edges[i - 1]!, to: edges[i]!, minutes: Math.round(minutes) });
  }
  return gaps;
}

/** A time as the farm's wall clock, "2026-11-05 16:20:07". */
export function localTime(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export interface PiSource {
  baseUrl: string;
  token: string;
}

export interface DaySummary {
  date: string;
  timeZone: string;
  rows: Record<string, number>;
  sensor: {
    readings: number;
    expectedPerSensorPerDay: number;
    coveragePercent: number | null;
    first: string | null;
    last: string | null;
    gapsOverMinutes: number;
    gaps: { from: string; to: string; minutes: number }[];
  };
  alerts: { total: number; byKind: Record<string, number> };
  pi: { reachable: boolean; files: string[]; note: string | null };
}

const SENSOR_IDS = ["SN-DHT22-T", "SN-DHT22-H"];
const GAP_MINUTES = 5;

export async function exportDay(
  sql: postgres.Sql,
  date: string,
  outDir: string,
  timeZone: string,
  pi: PiSource | null,
  pollSeconds = 60,
): Promise<DaySummary> {
  const folder = join(outDir, date);
  await mkdir(folder, { recursive: true });
  // The farm's day as two instants, so the indexes on the time columns are used.
  const [{ start, end }] = (await sql`
    SELECT ((${date}::date)::timestamp AT TIME ZONE ${timeZone}) AS start,
           ((${date}::date + 1)::timestamp AT TIME ZONE ${timeZone}) AS "end"`) as unknown as [{ start: Date; end: Date }];
  const startMs = start.getTime();
  const endMs = end.getTime();
  const withLocal = (rows: Row[], key: string): Row[] =>
    rows.map((r) => ({ ...r, time_utc: new Date(r[key] as string | Date).toISOString(), time_local: localTime(new Date(r[key] as string | Date).getTime(), timeZone) }));

  const sensors = withLocal(
    await sql`
      SELECT sensor_id, value::float AS value, unit, status, recorded_at
      FROM sensor_readings
      WHERE sensor_id IN ${sql(SENSOR_IDS)} AND recorded_at >= ${start} AND recorded_at < ${end}
      ORDER BY recorded_at, sensor_id`,
    "recorded_at",
  );
  const behavior = withLocal(
    await sql`
      SELECT camera_id, at, movement_index::float AS movement_index, movement_label, movement_status,
             huddling_risk::float AS huddling_risk, huddling_label, huddling_status, aggression_events,
             bird_count, zone_count, evaluable_count, inactive_count, huddled_count, confidence::float AS confidence, night
      FROM behavior_snapshots WHERE at >= ${start} AND at < ${end} ORDER BY at, camera_id`,
    "at",
  );
  const typed = withLocal(
    await sql`
      SELECT cycle_id, bird_id, day AS grow_out_day, actual_g::float AS actual_g, estimated_g::float AS estimated_g, recorded_at
      FROM actual_weights WHERE recorded_at >= ${start} AND recorded_at < ${end} ORDER BY recorded_at, bird_id`,
    "recorded_at",
  );
  const byDay = await sql`
    SELECT cw.day AS grow_out_day, cw.actual_g::float AS actual_g, cw.standard_g::float AS standard_g, cw.sample_size, cw.source
    FROM cycle_weights cw JOIN flock_cycles fc ON fc.id = cw.cycle_id
    WHERE fc.status = 'active' ORDER BY cw.day`;
  const alerts = withLocal(
    await sql`
      SELECT id, kind, severity, message, raised_at, acknowledged
      FROM alerts WHERE raised_at >= ${start} AND raised_at < ${end} ORDER BY raised_at`,
    "raised_at",
  );

  await writeFile(join(folder, "sensors.csv"), toCsv(["time_local", "time_utc", "sensor_id", "value", "unit", "status"], sensors));
  await writeFile(
    join(folder, "behavior.csv"),
    toCsv(
      ["time_local", "time_utc", "camera_id", "bird_count", "inactive_count", "huddled_count", "evaluable_count", "zone_count", "movement_index", "movement_label", "movement_status", "huddling_risk", "huddling_label", "huddling_status", "confidence", "night"],
      behavior,
    ),
  );
  await writeFile(join(folder, "weights-typed.csv"), toCsv(["time_local", "time_utc", "cycle_id", "bird_id", "grow_out_day", "actual_g", "estimated_g"], typed));
  await writeFile(join(folder, "weights-by-day.csv"), toCsv(["grow_out_day", "actual_g", "standard_g", "sample_size", "source"], byDay as unknown as Row[]));
  await writeFile(join(folder, "alerts.csv"), toCsv(["time_local", "time_utc", "id", "kind", "severity", "message", "acknowledged"], alerts));

  // The Pi's own files for the day, which hold what the laptop could not store while it was off (and the behaviour counts).
  const piSummary: DaySummary["pi"] = { reachable: false, files: [], note: null };
  if (pi) {
    try {
      const headers = { "X-Vision-Token": pi.token };
      const listed = await fetch(`${pi.baseUrl}/logs`, { headers, signal: AbortSignal.timeout(8_000) });
      if (!listed.ok) throw new Error(`HTTP ${listed.status}`);
      piSummary.reachable = true;
      const names = ((await listed.json()) as { files: { name: string }[] }).files.map((f) => f.name).filter((n) => n.endsWith(`-${date}.csv`));
      if (names.length > 0) await mkdir(join(folder, "pi"), { recursive: true });
      for (const name of names) {
        const res = await fetch(`${pi.baseUrl}/logs/${name}`, { headers, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) continue;
        await writeFile(join(folder, "pi", name), Buffer.from(await res.arrayBuffer()));
        piSummary.files.push(name);
      }
      if (names.length === 0) piSummary.note = "The Pi answered but has no file for this day.";
    } catch (err) {
      piSummary.note = `The Pi's files could not be fetched (${err instanceof Error ? err.message : err}).`;
    }
  } else {
    piSummary.note = "No Pi address is configured.";
  }

  const times = sensors.filter((r) => r.sensor_id === SENSOR_IDS[0]).map((r) => new Date(r.recorded_at as string | Date).getTime());
  const expected = Math.round(86_400 / pollSeconds);
  const gaps = findGaps(times, startMs, endMs, GAP_MINUTES);
  const byKind: Record<string, number> = {};
  for (const a of alerts) byKind[String(a.kind)] = (byKind[String(a.kind)] ?? 0) + 1;
  const summary: DaySummary = {
    date,
    timeZone,
    rows: { sensors: sensors.length, behavior: behavior.length, weightsTyped: typed.length, alerts: alerts.length },
    sensor: {
      readings: times.length,
      expectedPerSensorPerDay: expected,
      coveragePercent: times.length === 0 ? null : Math.min(100, Math.round((times.length / expected) * 100)),
      first: times.length ? localTime(Math.min(...times), timeZone) : null,
      last: times.length ? localTime(Math.max(...times), timeZone) : null,
      gapsOverMinutes: GAP_MINUTES,
      gaps: gaps.slice(0, 20).map((g) => ({ from: localTime(g.from, timeZone), to: localTime(g.to, timeZone), minutes: g.minutes })),
    },
    alerts: { total: alerts.length, byKind },
    pi: piSummary,
  };
  await writeFile(join(folder, "health.json"), JSON.stringify(summary, null, 2) + "\n");
  await writeFile(join(folder, "health.txt"), formatSummary(summary, gaps.length));
  return summary;
}

export function formatSummary(s: DaySummary, gapCount: number): string {
  const lines = [
    `Daily export for ${s.date} (${s.timeZone})`,
    "",
    `Temperature and humidity: ${s.sensor.readings} readings of about ${s.sensor.expectedPerSensorPerDay} expected` +
      (s.sensor.coveragePercent === null ? " (none today)" : ` (${s.sensor.coveragePercent} %)`),
  ];
  if (s.sensor.first) lines.push(`  first ${s.sensor.first}, last ${s.sensor.last}`);
  if (gapCount > 0) {
    lines.push(`  ${gapCount} silence(s) of ${s.sensor.gapsOverMinutes} minutes or more${gapCount > s.sensor.gaps.length ? ` (the first ${s.sensor.gaps.length} shown)` : ""}:`);
    for (const g of s.sensor.gaps) lines.push(`    ${g.from} to ${g.to}  (${g.minutes} min)`);
  } else if (s.sensor.readings > 0) {
    lines.push("  no silences");
  }
  lines.push(
    "",
    `Behaviour snapshots: ${s.rows.behavior}`,
    `Weights typed in: ${s.rows.weightsTyped}`,
    `Alerts raised: ${s.alerts.total}` + (s.alerts.total ? ` (${Object.entries(s.alerts.byKind).map(([k, n]) => `${k} ${n}`).join(", ")})` : ""),
    "",
    s.pi.reachable
      ? `Raspberry Pi files: ${s.pi.files.length ? s.pi.files.join(", ") : "none for this day"}${s.pi.note ? ` (${s.pi.note})` : ""}`
      : `Raspberry Pi files: not fetched. ${s.pi.note ?? ""}`,
    "",
    "A blank value in a Pi file means no reading that minute; the error column says why. A silence above is a time with nothing stored.",
    "",
  );
  return lines.join("\n");
}
