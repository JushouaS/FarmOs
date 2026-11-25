import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSensorCsv, rowsToFill, type PiSensorRow } from "../src/pi-backfill.js";

describe("Pi sensor CSV backfill", () => {
  it("parses valid readings and derives sensor time from row time and age", () => {
    const now = Date.parse("2026-11-05T12:05:00Z");
    const csv = [
      "time,temperature_c,humidity_pct,reading_age_s,error",
      "2026-11-05T12:00:00Z,28.5,70,10,",
    ].join("\n");
    assert.deepEqual(parseSensorCsv(csv, now), [
      { at: Date.parse("2026-11-05T11:59:50Z"), temperature: 28.5, humidity: 70 },
    ]);
  });

  it("skips malformed, duplicated, stale-future, and out-of-range readings", () => {
    const now = Date.parse("2026-11-05T12:05:00Z");
    const csv = [
      "time,temperature_c,humidity_pct,reading_age_s,error",
      "not-a-time,28,70,0,",
      "2026-11-05T12:00:00Z,28,70,-1,",
      "2026-11-05T12:00:00Z,100,101,0,",
      "2026-11-05T12:00:00Z,28,70,0,",
      "2026-11-05T12:00:00Z,29,71,0,",
      "2026-11-05T12:20:00Z,28,70,0,",
    ].join("\n");
    assert.deepEqual(parseSensorCsv(csv, now), [
      { at: Date.parse("2026-11-05T12:00:00Z"), temperature: 28, humidity: 70 },
    ]);
  });

  it("parses separate daily temperature and humidity files", () => {
    const now = Date.parse("2026-11-05T12:05:00Z");
    assert.deepEqual(
      parseSensorCsv(
        "time,temperature_c,reading_age_s,error\n2026-11-05T12:00:10Z,28.5,10,",
        now,
        "temperature",
      ),
      [{ at: Date.parse("2026-11-05T12:00:00Z"), temperature: 28.5, humidity: null }],
    );
    assert.deepEqual(
      parseSensorCsv(
        "time,humidity_pct,reading_age_s,error\n2026-11-05T12:00:10Z,70,10,",
        now,
        "humidity",
      ),
      [{ at: Date.parse("2026-11-05T12:00:00Z"), temperature: null, humidity: 70 }],
    );
  });

  it("fills only rows farther than the deduplication tolerance from stored times", () => {
    const rows: PiSensorRow[] = [
      { at: 1_000_000, temperature: 28, humidity: 70 },
      { at: 2_000_000, temperature: 29, humidity: 71 },
      { at: 3_000_000, temperature: 30, humidity: 72 },
    ];
    assert.deepEqual(rowsToFill(rows, [2_090_000, 3_000_000]), [rows[0]]);
  });
});
