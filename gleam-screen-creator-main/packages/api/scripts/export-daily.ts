/**
 * export-daily.ts: writes one day's data as CSV files and a health summary, ready to be collected or synced.
 *
 *   npx tsx scripts/export-daily.ts                       yesterday (the farm's calendar day)
 *   npx tsx scripts/export-daily.ts --date 2026-11-05     one day
 *   npx tsx scripts/export-daily.ts --days 7              the last 7 finished days (catches up after an outage)
 *   npx tsx scripts/export-daily.ts --out D:\Drive\farm   somewhere else (default: EXPORT_DIR, else packages\api\exports)
 *
 * Files go to <out>\<date>\ (see src/export-daily.ts). Run it again for the same day and it writes the same files over:
 * a day that was incomplete when first exported (the laptop was off) is complete after the gap-fill has run.
 * Needs the database running. Point EXPORT_DIR at a folder that Google Drive or OneDrive syncs to get the files at home.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";
import { exportDay } from "../src/export-daily.js";

const here = fileURLToPath(new URL(".", import.meta.url));
dotenv.config({ path: resolve(here, "..", ".env") });

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (packages\\api\\.env).");
  process.exit(1);
}
const sql = postgres(url, { max: 1 });
const timeZone = process.env.FARM_TZ || "Asia/Manila";
const outDir = resolve(arg("out") ?? process.env.EXPORT_DIR ?? resolve(here, "..", "exports"));
const piBase = process.env.SENSOR_SOURCE_URL || process.env.VISION_SERVICE_URL;
const pi = piBase && process.env.VISION_SERVICE_TOKEN ? { baseUrl: piBase.replace(/\/+$/, ""), token: process.env.VISION_SERVICE_TOKEN } : null;

try {
  const date = arg("date");
  const days = Math.max(1, Math.min(60, Number(arg("days") ?? 1) || 1));
  const wanted: string[] = [];
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date must look like 2026-11-05");
    wanted.push(date);
  } else {
    // The last `days` finished days: yesterday and the ones before it, in the farm's calendar.
    for (let back = 1; back <= days; back++) {
      const [row] = await sql`SELECT ((now() AT TIME ZONE ${timeZone})::date - ${back}::int)::text AS d`;
      wanted.push(String(row!.d));
    }
  }
  for (const day of wanted.reverse()) {
    const summary = await exportDay(sql, day, outDir, timeZone, pi, Number(process.env.SENSOR_POLL_SECONDS) || 60);
    console.log(
      `${day}: ${summary.sensor.readings} sensor readings, ${summary.rows.behavior} behaviour snapshots, ` +
        `${summary.rows.weightsTyped} typed weights, ${summary.alerts.total} alerts, ${summary.pi.files.length} Pi file(s) -> ${resolve(outDir, day)}`,
    );
  }
} catch (err) {
  const why = err instanceof Error ? err.message || (err as { code?: string }).code || err.name : String(err);
  console.error(`Export failed: ${why}${why === "ECONNREFUSED" ? " (is the database running? npm run db:local:start)" : ""}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
