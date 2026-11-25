import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { exportDay, findGaps, localTime, toCsv } from "../src/export-daily.js";
import { piLogDate, safePiLogPath } from "../src/pi-logs.js";
import type postgres from "postgres";

describe("daily export helpers", () => {
  it("writes escaped CSV cells and preserves blank values", () => {
    assert.equal(
      toCsv(["name", "note"], [{ name: 'Bird "A"', note: "line one,\nline two" }, { name: null, note: undefined }]),
      'name,note\n"Bird ""A""","line one,\nline two"\n,\n',
    );
  });

  it("finds gaps at the threshold and formats timestamps in the farm timezone", () => {
    const start = Date.parse("2026-11-05T00:00:00Z");
    const middle = start + 10 * 60_000;
    const end = start + 16 * 60_000;
    assert.deepEqual(findGaps([middle], start, end, 5), [
      { from: start, to: middle, minutes: 10 },
      { from: middle, to: end, minutes: 6 },
    ]);
    assert.equal(localTime(start, "UTC"), "2026-11-05 00:00:00");
  });

  it("accepts legacy flat files and supported nested logs, but rejects unsafe paths", () => {
    assert.equal(safePiLogPath({ name: "sensors-2026-11-05.csv" }), "sensors-2026-11-05.csv");
    const nested = {
      name: "temperature-2026-11-05.csv",
      path: "temperature/temperature-2026-11-05.csv",
    };
    assert.equal(safePiLogPath(nested), nested.path);
    assert.equal(piLogDate(nested.path), "2026-11-05");
    assert.equal(safePiLogPath({ path: "../temperature-2026-11-05.csv" }), null);
    assert.equal(safePiLogPath({ path: "humidity/temperature-2026-11-05.csv" }), null);
  });

  it("copies nested and flat Pi logs into the matching export paths", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "pi-daily-export-"));
    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url === "http://pi/logs") {
        return new Response(JSON.stringify({
          files: [
            { name: "temperature-2026-11-05.csv", path: "temperature/temperature-2026-11-05.csv" },
            { name: "sensors-2026-11-05.csv" },
            { name: "humidity-2026-11-04.csv", path: "humidity/humidity-2026-11-04.csv" },
            { name: "temperature-2026-11-05.csv", path: "../temperature-2026-11-05.csv" },
          ],
        }));
      }
      return new Response(url.includes("/temperature/") ? "temperature data" : "legacy data");
    };
    const fakeSql = ((first: TemplateStringsArray | unknown[]) => {
      if (Array.isArray(first) && "raw" in first) {
        const query = first.join("");
        if (query.includes("SELECT ((")) {
          return [{ start: new Date("2026-11-05T00:00:00Z"), end: new Date("2026-11-06T00:00:00Z") }];
        }
        return [];
      }
      return "sensor ids";
    }) as unknown as postgres.Sql;

    try {
      const summary = await exportDay(
        fakeSql,
        "2026-11-05",
        outDir,
        "UTC",
        { baseUrl: "http://pi", token: "test" },
      );
      assert.deepEqual(summary.pi.files, [
        "temperature/temperature-2026-11-05.csv",
        "sensors-2026-11-05.csv",
      ]);
      assert.equal(
        await readFile(join(outDir, "2026-11-05", "pi", "temperature", "temperature-2026-11-05.csv"), "utf8"),
        "temperature data",
      );
      assert.equal(
        await readFile(join(outDir, "2026-11-05", "pi", "sensors-2026-11-05.csv"), "utf8"),
        "legacy data",
      );
      assert.equal(requested.includes("http://pi/logs/../temperature-2026-11-05.csv"), false);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
