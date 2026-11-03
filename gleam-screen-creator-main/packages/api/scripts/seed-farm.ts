/**
 * seed-farm.ts
 *
 * A new database comes with demo rows (migration 0009): three extra houses, two extra cameras, their sensors,
 * four alerts, an incident, reports and cohorts, all dated 2024, plus a facility called POULTRY_AI. This removes
 * them and sets up the real farm: its name, the one house the camera watches, and how many birds are in it.
 * What was measured for real stays (the DHT22 readings, typed-in weights, accounts, settings, real alerts).
 *
 * Usage (from packages/api):
 *   npx tsx scripts/seed-farm.ts --name "My Farm"                          show what would change; changes nothing
 *   npx tsx scripts/seed-farm.ts --name "My Farm" --birds 20 --yes         do it
 *
 *   --name    <text>   the farm's name (required)
 *   --house   <text>   the house's name (default: keep the current one, "Pen 1")
 *   --birds   <n>      how many birds are in the house (default: keep the current number)
 *   --breed   <text>   the breed (default: keep, "Ross 308")
 *   --yes              make the changes (all or nothing, in one transaction)
 *
 * Back the database up first (scripts/backup-db.ps1 in the project root). To run it against another database,
 * set DATABASE_URL in the command's environment.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: resolve(fileURLToPath(new URL(".", import.meta.url)), "..", ".env") });

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const name = arg("name")?.trim();
const houseName = arg("house")?.trim();
const birds = arg("birds") !== undefined ? Number(arg("birds")) : undefined;
const breed = arg("breed")?.trim();
const apply = process.argv.includes("--yes");

if (!name) {
  console.error('Give the farm a name: --name "My Farm"  (see the top of this file for the options)');
  process.exit(1);
}
if (birds !== undefined && (!Number.isInteger(birds) || birds < 1 || birds > 2_000_000)) {
  console.error("--birds must be a whole number of at least 1");
  process.exit(1);
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Check packages/api/.env");
  process.exit(1);
}

/** Rows older than this are the 2024 demo rows; nothing real can be older than the project. */
const DEMO_BEFORE = "2025-01-01";

const sql = postgres(DATABASE_URL, { max: 1 });

async function main() {
  const cams = await sql`SELECT house_id FROM cameras WHERE id LIKE 'CAM-%' ORDER BY id LIMIT 1`;
  if (cams.length === 0) throw new Error("no real camera (CAM-01) is registered, so there is no house to keep");
  const keep = String(cams[0]!.house_id);

  await sql.begin(async (tx) => {
    const lines: string[] = [];
    // Each step says what it removes, runs, and reports how many rows went (a dry run rolls the transaction back).
    const step = async (what: string, q: ReturnType<typeof tx>) => {
      const r = await q;
      lines.push(`  ${String(r.count).padStart(5)}  ${what}`);
    };

    await step("incidents (with their peaks and evidence)", tx`DELETE FROM incidents WHERE started_at < ${DEMO_BEFORE}`);
    await step("alerts from 2024", tx`DELETE FROM alerts WHERE raised_at < ${DEMO_BEFORE}`);
    await step("anomaly events from 2024", tx`DELETE FROM anomaly_events WHERE at < ${DEMO_BEFORE}`);
    await step("monitoring reports from 2024 (with their findings)", tx`DELETE FROM monitoring_reports WHERE generated_at < ${DEMO_BEFORE}`);
    await step("archived reports from 2024", tx`DELETE FROM archived_reports WHERE generated_at < ${DEMO_BEFORE}`);
    await step("cohorts (demo weight groups)", tx`DELETE FROM cohorts`);
    await step("demo cameras", tx`DELETE FROM cameras WHERE id NOT LIKE 'CAM-%'`);
    await step("readings of demo sensors", tx`DELETE FROM sensor_readings WHERE sensor_id NOT LIKE 'SN-DHT22-%'`);
    await step("weight samples of demo sensors", tx`DELETE FROM volumetric_samples WHERE sensor_id NOT LIKE 'SN-DHT22-%'`);
    await step("demo sensors", tx`DELETE FROM sensors WHERE id NOT LIKE 'SN-DHT22-%'`);
    await step("mortality entries of demo houses", tx`DELETE FROM mortality_logs WHERE house_id <> ${keep}`);
    await step("demo houses", tx`DELETE FROM houses WHERE id <> ${keep}`);

    const house = (await tx`SELECT label, population FROM houses WHERE id = ${keep}`)[0]!;
    const facility = (await tx`SELECT id, name, breed FROM facilities ORDER BY id LIMIT 1`)[0]!;
    const newHouse = houseName || String(house.label);
    await tx`UPDATE houses SET label = ${newHouse}, population = ${birds ?? Number(house.population)} WHERE id = ${keep}`;
    await tx`UPDATE facilities SET name = ${name!}, breed = ${breed || String(facility.breed)}, house_range_label = ${newHouse} WHERE id = ${facility.id}`;
    lines.push(`  farm:   "${facility.name}" -> "${name}"${breed ? `, breed "${breed}"` : ""}`);
    lines.push(`  house:  ${keep} "${house.label}" (${house.population} birds) -> "${newHouse}" (${birds ?? house.population} birds)`);

    console.log(apply ? "Done. Changes made:" : "Dry run. This would change:");
    console.log(lines.join("\n"));
    if (!apply) {
      console.log("\nNothing was changed. Add --yes to do it (back the database up first).");
      throw new RollbackOnly();
    }
  });
}

class RollbackOnly extends Error {}

try {
  await main();
} catch (err) {
  if (!(err instanceof RollbackOnly)) {
    console.error(`seed-farm failed, nothing was changed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
} finally {
  await sql.end({ timeout: 5 });
}
