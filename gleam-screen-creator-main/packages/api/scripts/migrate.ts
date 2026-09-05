/**
 * Runs every `*.sql` file under `packages/api/migrations/` in filename order
 * against the write-enabled database role.
 *
 * Usage:
 *   pnpm -C packages/api db:migrate                 # run every pending file
 *   pnpm -C packages/api db:migrate --up-to NAME    # stop after NAME.sql
 *   pnpm -C packages/api db:migrate --status        # list applied files
 *
 * Migrations are tracked in a `schema_migrations` table created on first run.
 * Each file is executed inside a transaction; partial runs are rolled back.
 */

import { readdir, readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import postgres from "postgres";

const here = fileURLToPath(new URL(".", import.meta.url));

// Load .env from packages/api/ regardless of CWD (npm workspaces run from root).
dotenv.config({ path: resolve(here, "..", ".env") });
const MIGRATIONS_DIR = resolve(here, "..", "migrations");

async function listMigrations(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

async function ensureMigrationsTable(sql: postgres.Sql) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function applied(sql: postgres.Sql): Promise<Set<string>> {
  const rows = await sql<{ filename: string }[]>`SELECT filename FROM schema_migrations`;
  return new Set(rows.map((r) => r.filename));
}

async function run(
  sql: postgres.Sql,
  filename: string,
  body: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`INSERT INTO schema_migrations (filename) VALUES (${filename})`;
  });
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${filename}`);
}

function parseArgs(argv: string[]) {
  const out: { upTo?: string; status: boolean } = { status: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--up-to") {
      out.upTo = argv[i + 1];
      i++;
    } else if (a === "--status") {
      out.status = true;
    }
  }
  return out;
}

async function main() {
  const url = process.env.DATABASE_WRITE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    // eslint-disable-next-line no-console
    console.error("DATABASE_URL or DATABASE_WRITE_URL is required");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, connect_timeout: 10 });

  const args = parseArgs(process.argv.slice(2));
  const all = await listMigrations();
  await ensureMigrationsTable(sql);
  const done = await applied(sql);

  if (args.status) {
    // eslint-disable-next-line no-console
    console.log(all.map((f) => `${done.has(f) ? "[x]" : "[ ]"} ${f}`).join("\n"));
    await sql.end();
    return;
  }

  const pending = all.filter((f) => !done.has(f));
  const target = args.upTo;
  const toRun = target
    ? pending.slice(0, pending.findIndex((f) => f === target) + 1)
    : pending;

  if (toRun.length === 0) {
    // eslint-disable-next-line no-console
    console.log("No pending migrations.");
    await sql.end();
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`Applying ${toRun.length} migration(s)…`);
  for (const filename of toRun) {
    const body = await readFile(resolve(MIGRATIONS_DIR, filename), "utf8");
    await run(sql, filename, body);
  }
  // eslint-disable-next-line no-console
  console.log(`\nMigrations applied: ${toRun.length}.`);
  await sql.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed:", err);
  process.exit(1);
});

void basename;
