import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAmmoniaCsv, parseBehaviorCsv } from "../src/pi-csv-import.js";

describe("Pi CSV history import", () => {
  it("keeps measured ammonia values and sensor errors as separate raw rows", () => {
    const rows = parseAmmoniaCsv(
      [
        "time,ammonia_ppm,error",
        '2026-11-15T20:50:30+08:00,5.4,',
        '2026-11-15T20:51:30+08:00,,"no ammonia sensor connected"',
      ].join("\n"),
      "2026-11-15/pi/ammonia/ammonia-2026-11-15.csv",
    );
    assert.deepEqual(rows, [
      {
        recordedAt: "2026-11-15T12:50:30.000Z",
        ammoniaPpm: 5.4,
        error: null,
        sourceFile: "2026-11-15/pi/ammonia/ammonia-2026-11-15.csv",
        sourceRow: 2,
      },
      {
        recordedAt: "2026-11-15T12:51:30.000Z",
        ammoniaPpm: null,
        error: "no ammonia sensor connected",
        sourceFile: "2026-11-15/pi/ammonia/ammonia-2026-11-15.csv",
        sourceRow: 3,
      },
    ]);
  });

  it("accepts legacy ammonia files with a timestamp column", () => {
    const previousTimezone = process.env.FARM_TZ;
    process.env.FARM_TZ = "Asia/Manila";
    try {
      const rows = parseAmmoniaCsv(
        [
          "timestamp,temperature_c,humidity_pct,ammonia_ppm",
          "2026-11-17T00:00:16,24.5,100.0,2.00",
        ].join("\n"),
        "2026-11-17/pi/ammonia/ammonia-2026-11-17.csv",
      );
      assert.deepEqual(rows, [
        {
          recordedAt: "2026-11-16T16:00:16.000Z",
          ammoniaPpm: 2,
          error: null,
          sourceFile: "2026-11-17/pi/ammonia/ammonia-2026-11-17.csv",
          sourceRow: 2,
        },
      ]);
    } finally {
      if (previousTimezone === undefined) delete process.env.FARM_TZ;
      else process.env.FARM_TZ = previousTimezone;
    }
  });

  it("parses raw behavior fields without inventing welfare classifications", () => {
    const rows = parseBehaviorCsv(
      [
        "time,birds,still_birds,huddled_birds,flock_moving,huddle_fdi,error",
        "2026-11-15T20:50:30+08:00,20,12,4,0.35,0.2,",
        '2026-11-15T20:51:30+08:00,,,,,,"no_frame"',
        "not-a-time,99,1,1,0.5,0.2,",
      ].join("\n"),
      "2026-11-15/pi/behavior/behavior-2026-11-15.csv",
    );
    assert.deepEqual(rows, [
      {
        recordedAt: "2026-11-15T12:50:30.000Z",
        birds: 20,
        stillBirds: 12,
        huddledBirds: 4,
        flockMoving: 0.35,
        huddleFdi: 0.2,
        error: null,
        sourceFile: "2026-11-15/pi/behavior/behavior-2026-11-15.csv",
        sourceRow: 2,
      },
      {
        recordedAt: "2026-11-15T12:51:30.000Z",
        birds: null,
        stillBirds: null,
        huddledBirds: null,
        flockMoving: null,
        huddleFdi: null,
        error: "no_frame",
        sourceFile: "2026-11-15/pi/behavior/behavior-2026-11-15.csv",
        sourceRow: 3,
      },
    ]);
  });
});
