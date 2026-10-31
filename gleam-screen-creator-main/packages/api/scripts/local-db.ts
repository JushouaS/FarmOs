/**
 * Runs a private PostgreSQL server for local development, without Docker and
 * without the machine's PostgreSQL superuser password.
 *
 * It uses the PostgreSQL binaries already installed on this machine (initdb,
 * pg_ctl, createdb) to create a separate data directory at
 * `packages/api/.pgdata` (git-ignored), owned by the current Windows user.
 * Port, user, password and database name all come from DATABASE_URL in
 * packages/api/.env, so the API and this server always agree.
 *
 * Usage:
 *   npm run db:local:init     # create the server + database once, then start it
 *   npm run db:local:start    # start it (e.g. after a reboot)
 *   npm run db:local:stop
 *   npm run db:local:status
 *
 * Binaries are found in PG_BIN if set, else the newest
 * "C:\Program Files\PostgreSQL\<version>\bin", else PATH.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = fileURLToPath(new URL(".", import.meta.url));
dotenv.config({ path: resolve(here, "..", ".env") });

const DATA_DIR = resolve(here, "..", ".pgdata");
const LOG_FILE = join(DATA_DIR, "server.log");

function findBin(): string {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const root = "C:\\Program Files\\PostgreSQL";
  if (existsSync(root)) {
    const versions = readdirSync(root)
      .filter((v) => /^\d+$/.test(v))
      .sort((a, b) => Number(b) - Number(a));
    for (const v of versions) {
      const bin = join(root, v, "bin");
      if (existsSync(join(bin, "pg_ctl.exe"))) return bin;
    }
  }
  return "";
}

const BIN = findBin();
const exe = (name: string) =>
  BIN ? join(BIN, process.platform === "win32" ? `${name}.exe` : name) : name;

function readTarget() {
  const raw = process.env.DATABASE_URL;
  if (!raw) fail("DATABASE_URL is missing from packages/api/.env");
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    fail(`DATABASE_URL points at ${url.hostname}; this script only manages a local server.`);
  }
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    port: url.port || "5432",
  };
}

function fail(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`local-db: ${message}`);
  process.exit(1);
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync(exe(cmd), args, { stdio: "inherit", env: { ...process.env, ...env } });
}

const isRunning = () =>
  existsSync(join(DATA_DIR, "PG_VERSION")) &&
  spawnSync(exe("pg_ctl"), ["status", "-D", DATA_DIR], { stdio: "ignore" }).status === 0;

function start() {
  if (!existsSync(join(DATA_DIR, "PG_VERSION"))) fail("no local server yet; run db:local:init first.");
  if (isRunning()) {
    // eslint-disable-next-line no-console
    console.log("local-db: already running.");
    return;
  }
  const r = run("pg_ctl", ["start", "-D", DATA_DIR, "-l", LOG_FILE, "-w", "-t", "60"]);
  if (r.status !== 0) fail(`server did not start; see ${LOG_FILE}`);
}

function init() {
  const t = readTarget();

  if (existsSync(join(DATA_DIR, "PG_VERSION"))) {
    // eslint-disable-next-line no-console
    console.log("local-db: data directory already exists, skipping initdb.");
  } else {
    // The password reaches initdb through a short-lived file, never argv.
    const tmp = mkdtempSync(join(tmpdir(), "local-db-"));
    const pwFile = join(tmp, "pw");
    try {
      writeFileSync(pwFile, `${t.password}\n`, { mode: 0o600 });
      const r = run("initdb", [
        "-D", DATA_DIR,
        "-U", t.user,
        `--pwfile=${pwFile}`,
        "--auth=scram-sha-256",
        "--encoding=UTF8",
        "--locale=C",
      ]);
      if (r.status !== 0) fail("initdb failed.");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    // Local-only: listen on loopback, on the port DATABASE_URL names.
    appendFileSync(
      join(DATA_DIR, "postgresql.conf"),
      `\n# Added by scripts/local-db.ts\nport = ${t.port}\nlisten_addresses = 'localhost'\n`,
    );
  }

  start();

  const created = run(
    "createdb",
    ["-h", "localhost", "-p", t.port, "-U", t.user, t.database],
    { PGPASSWORD: t.password },
  );
  // createdb exits 1 when the database already exists; check before failing.
  if (created.status !== 0) {
    const exists = spawnSync(
      exe("psql"),
      ["-h", "localhost", "-p", t.port, "-U", t.user, "-d", t.database, "-Atc", "select 1"],
      { stdio: "ignore", env: { ...process.env, PGPASSWORD: t.password } },
    );
    if (exists.status !== 0) fail(`could not create database ${t.database}.`);
  }
  // eslint-disable-next-line no-console
  console.log(`local-db: ready on localhost:${t.port}, database "${t.database}".`);
}

const command = process.argv[2];
switch (command) {
  case "init":
    init();
    break;
  case "start":
    start();
    break;
  case "stop":
    run("pg_ctl", ["stop", "-D", DATA_DIR, "-m", "fast"]);
    break;
  case "status":
    run("pg_ctl", ["status", "-D", DATA_DIR]);
    break;
  default:
    fail("usage: local-db <init|start|stop|status>");
}
