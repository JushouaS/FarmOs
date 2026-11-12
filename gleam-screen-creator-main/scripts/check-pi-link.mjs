// Why the website shows no readings: checks each link from the Raspberry Pi to the website, in order, and says which
// one is broken. Run it on the computer that runs the website, from the project folder:
//
//     node scripts/check-pi-link.mjs
//
// It only reads. Secrets (the token, the database password) are never printed.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(root, "packages", "api");
let failed = 0;
const ok = (msg) => console.log(`  OK    ${msg}`);
const bad = (msg, fix) => { failed++; console.log(`  FAIL  ${msg}`); if (fix) console.log(`        -> ${fix}`); };
const info = (msg) => console.log(`        ${msg}`);

function readEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function get(url, headers = {}, ms = 6000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body };
}

console.log("\n1. This computer's network");
for (const [name, addrs] of Object.entries(networkInterfaces())) {
  for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) info(`${name}: ${a.address}`);
}
info("The Pi must be on the same Wi-Fi as this computer (no internet needed).");

console.log("\n2. The API's settings (packages/api/.env)");
let env;
try {
  env = readEnv(join(apiDir, ".env"));
  ok(".env found");
} catch {
  bad("packages/api/.env is missing", "copy packages/api/.env.example to packages/api/.env and fill it in (HOW_TO_RUN.md)");
  process.exit(1);
}
const piUrl = env.VISION_SERVICE_URL;
const token = env.VISION_SERVICE_TOKEN;
if (!piUrl) bad("VISION_SERVICE_URL is not set", "set it to the Pi's address, e.g. VISION_SERVICE_URL=http://behavior.local:5000");
else info(`VISION_SERVICE_URL=${piUrl}`);
if (!token) bad("VISION_SERVICE_TOKEN is not set", "copy the value from ~/cerebroil-stream/.env on the Pi");
for (const key of ["SENSOR_MONITOR", "BEHAVIOR_MONITOR"]) {
  if ((env[key] ?? "").toLowerCase() === "off") bad(`${key}=off turns that reading off`, `remove the ${key} line or set it to on`);
}

console.log("\n3. Can this computer reach the Pi?");
let piReached = false;
if (piUrl) {
  const host = new URL(piUrl).hostname;
  try {
    const { address } = await lookup(host);
    ok(`${host} is ${address}`);
  } catch {
    bad(`${host} cannot be found on this network`,
      "join the Pi's Wi-Fi. If it is on it already, Windows may just not know the name: put the Pi's number in " +
      "VISION_SERVICE_URL instead (on the Pi: hostname -I), e.g. http://192.168.0.105:5000, then restart the API");
  }
  try {
    const s = await get(`${piUrl}/sensors`, { "X-Vision-Token": token ?? "" });
    piReached = true;
    if (s.status === 401 || s.status === 403) {
      bad("the Pi answered but refused the token", "VISION_SERVICE_TOKEN must be the same in packages/api/.env and ~/cerebroil-stream/.env on the Pi");
    } else if (s.status !== 200) {
      bad(`the Pi answered HTTP ${s.status} at /sensors`);
    } else if (!s.body?.running) {
      bad(`the Pi has no sensor reading (${s.body?.reason ?? "not running"})`, "on the Pi: sudo systemctl restart dht22");
    } else {
      ok(`the Pi's sensor: ${s.body.temperature} °C, ${s.body.humidity} %, ${s.body.ageSeconds} s old`);
      if (s.body.ageSeconds > 120) bad("that reading is over 2 minutes old, so it is not stored", "on the Pi: sudo systemctl restart dht22");
    }
    const b = await get(`${piUrl}/behavior/status?night=0`, { "X-Vision-Token": token ?? "" });
    if (b.status === 200 && b.body?.running) ok(`the Pi's behaviour monitor: ${b.body.birds} birds, rules ${b.body.rules ?? "old"}`);
    else if (b.status === 200) bad(`the Pi's behaviour monitor is not running (${b.body?.reason ?? b.body?.error ?? "?"})`, "LIVE_BEHAVIOR=1 in ~/cerebroil-stream/.env on the Pi, then restart cerebroil-stream");
    const l = await get(`${piUrl}/logs`, { "X-Vision-Token": token ?? "" });
    if (l.status === 200) ok(`the Pi lists ${Array.isArray(l.body?.files) ? l.body.files.length : "its"} log files for catching up`);
  } catch (e) {
    if (!piReached) bad(`no answer from ${piUrl} (${e.cause?.code ?? e.name})`,
      "the Pi is off, on another Wi-Fi, or the camera service is stopped (on the Pi: systemctl is-active cerebroil-stream)");
  }
}

console.log("\n4. Is the API running on this computer?");
const apiPort = env.PORT || "4000";
try {
  const h = await get(`http://127.0.0.1:${apiPort}/health`);
  if (h.status === 200) ok(`the API answers on port ${apiPort}`);
  else bad(`the API answered HTTP ${h.status}`);
} catch {
  bad(`the API is not running (nothing on port ${apiPort})`,
    "start it (HOW_TO_RUN.md: database, then API, then website). The API is what asks the Pi for readings; with it off nothing is stored");
}

console.log("\n5. What the database holds");
if (!env.DATABASE_URL) {
  bad("DATABASE_URL is not set in packages/api/.env");
} else {
  let sql;
  try {
    const require = createRequire(join(apiDir, "package.json"));
    const postgres = require("postgres");
    sql = postgres(env.DATABASE_URL, { connect_timeout: 5, max: 1, onnotice: () => {} });
    const sensors = await sql`SELECT id FROM sensors WHERE id IN ('SN-DHT22-T', 'SN-DHT22-H')`;
    if (sensors.length < 2) bad("the database has no rows for the Pi's sensors", "run: npm run db:migrate   (in packages/api; migration 0024 adds them)");
    else ok("the Pi's two sensors are set up in the database");
    const [r] = await sql`SELECT count(*)::int AS n, max(recorded_at) AS last FROM sensor_readings WHERE sensor_id IN ('SN-DHT22-T', 'SN-DHT22-H')`;
    if (!r.n) bad("no temperature or humidity reading has ever been stored", "fix the FAIL lines above, then wait a minute with the API running");
    else {
      const mins = Math.round((Date.now() - new Date(r.last).getTime()) / 60000);
      (mins <= 5 ? ok : bad)(`${r.n} readings stored, the newest ${mins} min ago`,
        mins > 5 ? "the API has stopped storing: see the FAIL lines above" : undefined);
    }
    const [s] = await sql`SELECT count(*)::int AS n, max(at) AS last FROM behavior_snapshots`;
    if (!s.n) bad("no behaviour snapshot has ever been stored", "the Behaviour page fills from the API's camera scans: the camera must be reachable (step 3)");
    else info(`${s.n} behaviour snapshots, the newest ${Math.round((Date.now() - new Date(s.last).getTime()) / 60000)} min ago`);
  } catch (e) {
    bad(`cannot read the database (${e.code ?? e.message})`,
      e.code === "ECONNREFUSED" ? "the database is not running: start it first (in packages/api: npm run db:local:start)" : "check DATABASE_URL in packages/api/.env");
  } finally {
    await sql?.end({ timeout: 1 }).catch(() => {});
  }
}

console.log(failed ? `\n${failed} problem(s) found. Fix the first FAIL first: the later ones often follow from it.\n`
  : "\nEvery link works. If the website still shows nothing, reload it and check you are signed in.\n");
process.exit(failed ? 1 : 0);
