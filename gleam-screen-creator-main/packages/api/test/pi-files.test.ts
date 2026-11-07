/**
 * The Pi's daily files: filling a gap in the stored readings from them, and the daily export's helpers.
 *
 *   bun test            (from packages/api; the last block needs the local database running)
 *
 * The last block stores readings dated January 2020 through the real code and deletes them again, so it never
 * touches the readings of the real farm. The Pi is a small stand-in server.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { findGaps, localTime, toCsv } from "../src/export-daily.js";
import { backfillSensors, mergeReadings, parseSensorCsv, parseValueCsv, rowsToFill, sensorDays } from "../src/pi-backfill.js";

const HEADER = "time,temperature_c,humidity_pct,reading_age_s,error";
const at = (iso: string) => Date.parse(iso);

describe("reading a Pi sensor file", () => {
  test("a row's time is when the sensor was read: the row time minus the reading's age", () => {
    const rows = parseSensorCsv(`${HEADER}\n2020-01-01T10:00:30+08:00,28.4,70.8,30,\n`);
    expect(rows).toEqual([{ at: at("2020-01-01T10:00:00+08:00"), temperature: 28.4, humidity: 70.8 }]);
  });

  test("rows with no reading, a cut-short row and an unreadable time are left out", () => {
    const text = [
      HEADER,
      "2020-01-01T10:00:00+08:00,,,,the sensor did not answer (check the wires and the 3.3 V)",
      "2020-01-01T10:01:00+08:00,28.5,70.1,0,",
      "2020-01-01T10:02:00+08:00,28.", // cut off by a power cut
      "not a time,28.5,70.1,0,",
    ].join("\n");
    expect(parseSensorCsv(text).map((r) => r.temperature)).toEqual([28.5]);
  });

  test("the same reading logged twice, a value the sensor cannot give, and a row from the future are left out", () => {
    const text = [
      HEADER,
      "2020-01-01T10:01:00+08:00,28.5,70.1,60,", // read at 10:00:00
      "2020-01-01T10:02:00+08:00,28.5,70.1,120,", // the same reading, a minute older
      "2020-01-01T10:03:00+08:00,250,70.1,0,", // 250 °C is not a temperature: the humidity is kept
      "2999-01-01T00:00:00+08:00,28.5,70.1,0,",
    ].join("\n");
    expect(parseSensorCsv(text)).toEqual([
      { at: at("2020-01-01T10:00:00+08:00"), temperature: 28.5, humidity: 70.1 },
      { at: at("2020-01-01T10:03:00+08:00"), temperature: null, humidity: 70.1 },
    ]);
  });

  test("a file that is not a sensor file gives nothing", () => {
    expect(parseSensorCsv("time,birds,still_birds\n2020-01-01T10:00:00+08:00,3,1\n")).toEqual([]);
    expect(parseSensorCsv("")).toEqual([]);
  });
});

describe("one folder per reading (from 2026-11-07)", () => {
  const T_HEADER = "time,temperature_c,reading_age_s,error";
  const H_HEADER = "time,humidity_pct,reading_age_s,error";

  test("a temperature file and a humidity file are read on their own and joined back by the moment of reading", () => {
    const t = parseValueCsv(
      [T_HEADER, "2020-01-01T10:00:30+08:00,28.4,30,", "2020-01-01T10:01:30+08:00,,,the sensor did not answer", ""].join("\n"),
      "temperature",
    );
    const h = parseValueCsv([H_HEADER, "2020-01-01T10:00:30+08:00,70.8,30,", "2020-01-01T10:02:00+08:00,71.2,0,"].join("\n"), "humidity");
    expect(mergeReadings(t, h)).toEqual([
      { at: at("2020-01-01T10:00:00+08:00"), temperature: 28.4, humidity: 70.8 },
      { at: at("2020-01-01T10:02:00+08:00"), temperature: null, humidity: 71.2 },
    ]);
  });

  test("a value the sensor cannot give, or the wrong kind of file, gives nothing", () => {
    expect(parseValueCsv(`${T_HEADER}\n2020-01-01T10:00:00+08:00,250,0,\n`, "temperature")).toEqual([]);
    expect(parseValueCsv(`${H_HEADER}\n2020-01-01T10:00:00+08:00,70,0,\n`, "temperature")).toEqual([]);
    expect(parseValueCsv("time,ammonia_ppm,error\n2020-01-01T10:00:00+08:00,,no ammonia sensor connected\n", "humidity")).toEqual([]);
  });

  test("the newest days are picked, the separate files win over an old combined one, and other readings are ignored", () => {
    const files = [
      { name: "temperature-2020-01-03.csv", path: "temperature/temperature-2020-01-03.csv", folder: "temperature" },
      { name: "humidity-2020-01-03.csv", path: "humidity/humidity-2020-01-03.csv", folder: "humidity" },
      { name: "ammonia-2020-01-03.csv", path: "ammonia/ammonia-2020-01-03.csv", folder: "ammonia" },
      { name: "behavior-2020-01-03.csv", path: "behavior/behavior-2020-01-03.csv", folder: "behavior" },
      { name: "sensors-2020-01-02.csv" }, // a Pi from before the folders gives only the name
      { name: "sensors-2020-01-01.csv", path: "sensors-2020-01-01.csv", folder: null },
    ];
    expect(sensorDays(files, 2)).toEqual([
      { date: "2020-01-03", temperature: "temperature/temperature-2020-01-03.csv", humidity: "humidity/humidity-2020-01-03.csv" },
      { date: "2020-01-02", combined: "sensors-2020-01-02.csv" },
    ]);
  });
});

describe("which rows fill a gap", () => {
  const row = (iso: string) => ({ at: at(iso), temperature: 28, humidity: 70 });
  test("a row with a stored reading close by adds nothing; a row in a gap is kept", () => {
    const rows = [row("2020-01-01T10:00:00Z"), row("2020-01-01T10:01:10Z"), row("2020-01-01T10:30:00Z")];
    const stored = [at("2020-01-01T10:00:20Z"), at("2020-01-01T10:01:00Z")];
    expect(rowsToFill(rows, stored).map((r) => r.at)).toEqual([at("2020-01-01T10:30:00Z")]);
  });
  test("with nothing stored every row is kept", () => {
    expect(rowsToFill([row("2020-01-01T10:00:00Z")], [])).toHaveLength(1);
  });
});

describe("the daily export's helpers", () => {
  test("silences are found between readings and at both ends of the day", () => {
    const start = at("2020-01-01T00:00:00Z");
    const end = at("2020-01-02T00:00:00Z");
    const times = [at("2020-01-01T10:00:00Z"), at("2020-01-01T10:01:00Z"), at("2020-01-01T10:30:00Z")];
    expect(findGaps(times, start, end, 5).map((g) => g.minutes)).toEqual([600, 29, 810]);
    expect(findGaps([], start, end, 5).map((g) => g.minutes)).toEqual([1440]);
  });

  test("a value with a comma, a quote or a line break is quoted, and a missing value is blank", () => {
    expect(toCsv(["a", "b", "c"], [{ a: 'say "hi", ok', b: null, c: 3 }])).toBe('a,b,c\n"say ""hi"", ok",,3\n');
  });

  test("a time is shown on the farm's wall clock", () => {
    expect(localTime(at("2026-11-05T08:20:07Z"), "Asia/Manila")).toBe("2026-11-05 16:20:07");
  });
});

describe("filling a gap from the Pi, through the database", () => {
  let app: Awaited<ReturnType<(typeof import("../src/app.js"))["buildApp"]>>;
  let pi: Server;
  let base = "";
  // The day before the change: one combined file at the top. The day after: one folder per reading.
  const FILE = "sensors-2020-01-01.csv";
  const csv = [
    HEADER,
    "2020-01-01T10:00:30+08:00,28.4,70.8,30,",
    "2020-01-01T10:01:30+08:00,28.6,71.0,30,",
    "2020-01-01T10:02:30+08:00,,,,the sensor did not answer (check the wires and the 3.3 V)",
    "",
  ].join("\n");
  const TEMP = "temperature/temperature-2020-01-02.csv";
  const HUM = "humidity/humidity-2020-01-02.csv";
  const tempCsv = ["time,temperature_c,reading_age_s,error", "2020-01-02T10:00:30+08:00,29.1,30,", ""].join("\n");
  const humCsv = ["time,humidity_pct,reading_age_s,error", "2020-01-02T10:00:30+08:00,68.5,30,", ""].join("\n");
  const served: Record<string, string> = { [FILE]: csv, [TEMP]: tempCsv, [HUM]: humCsv };
  const stored = async () =>
    Number((await app.sqlRead`SELECT count(*)::int AS n FROM sensor_readings WHERE recorded_at < '2021-01-01'`)[0]!.n);
  const clean = () =>
    app.sqlWrite`DELETE FROM sensor_readings WHERE recorded_at < '2021-01-01' AND sensor_id IN ('SN-DHT22-T', 'SN-DHT22-H')`;

  beforeAll(async () => {
    pi = createServer((req, res) => {
      if (req.headers["x-vision-token"] !== "test-token") return void res.writeHead(401).end("{}");
      if (req.url === "/logs")
        return void res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            files: [
              { name: "temperature-2020-01-02.csv", path: TEMP, folder: "temperature" },
              { name: "humidity-2020-01-02.csv", path: HUM, folder: "humidity" },
              { name: "ammonia-2020-01-02.csv", path: "ammonia/ammonia-2020-01-02.csv", folder: "ammonia" },
              { name: FILE, path: FILE, folder: null },
              { name: "behavior-2020-01-01.csv", path: "behavior-2020-01-01.csv", folder: null },
            ],
          }),
        );
      const wanted = req.url?.startsWith("/logs/") ? served[req.url.slice("/logs/".length)] : undefined;
      if (wanted !== undefined) return void res.writeHead(200, { "content-type": "text/csv" }).end(wanted);
      res.writeHead(404).end("{}");
    });
    await new Promise<void>((resolve) => pi.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(pi.address() as AddressInfo).port}`;
    process.env.SENSOR_MONITOR = "off";
    process.env.BEHAVIOR_MONITOR = "off";
    process.env.BEHAVIOR_INTERVAL_MINUTES = "0";
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await clean();
  }, 60_000);

  afterAll(async () => {
    if (app) {
      await clean();
      await app.close();
    }
    pi?.close();
  }, 60_000);

  test("both layouts are stored once, with the temperature and humidity of each reading", async () => {
    const done = await backfillSensors(app, 2, { baseUrl: base, token: "test-token" });
    // Old day: two readings with both values (the blank row is not stored). New day: one reading from two files.
    expect(done).toEqual({ files: 3, stored: 6 });
    expect(await stored()).toBe(6);
    const t =
      await app.sqlRead`SELECT value::float AS v FROM sensor_readings WHERE sensor_id = 'SN-DHT22-T' AND recorded_at < '2021-01-01' ORDER BY recorded_at`;
    expect(t.map((r) => r.v)).toEqual([28.4, 28.6, 29.1]);
    const h =
      await app.sqlRead`SELECT value::float AS v FROM sensor_readings WHERE sensor_id = 'SN-DHT22-H' AND recorded_at < '2021-01-01' ORDER BY recorded_at`;
    expect(h.map((r) => r.v)).toEqual([70.8, 71.0, 68.5]);
  });

  test("running it again adds nothing", async () => {
    const done = await backfillSensors(app, 2, { baseUrl: base, token: "test-token" });
    expect(done.stored).toBe(0);
    expect(await stored()).toBe(6);
  });

  test("a Pi that refuses the token is an error, not an empty success", async () => {
    await expect(backfillSensors(app, 2, { baseUrl: base, token: "wrong" })).rejects.toThrow(/401/);
  });
});
