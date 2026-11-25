import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";
import { importPiCsvExports } from "../src/pi-csv-import.js";

const here = fileURLToPath(new URL(".", import.meta.url));
dotenv.config({ path: resolve(here, "..", ".env") });

const databaseUrl = process.env.DATABASE_WRITE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL or DATABASE_WRITE_URL is not set (packages\\api\\.env).");
  process.exit(1);
}

const exportsRoot = resolve(process.env.PI_CSV_EXPORT_DIR ?? resolve(here, "..", "exports"));
const sql = postgres(databaseUrl, { max: 1 });

try {
  const result = await importPiCsvExports(sql, exportsRoot);
  console.log(
    `${result.files} Pi CSV file(s): ${result.sensorReadings} sensor reading(s), ` +
      `${result.ammoniaRows} ammonia row(s), ${result.behaviorRows} behavior row(s).`,
  );
} catch (error) {
  console.error("Pi CSV import failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
