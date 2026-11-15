/**
 * Out-of-range alerts for the pen temperature and humidity (sensor-monitor.ts RangeWatch).
 *
 *   bun test test/sensor-range.test.ts
 */
import { describe, expect, test } from "bun:test";
import { RangeWatch, statusFor } from "../src/sensor-monitor.js";

const MIN = 60_000;
const feed = (w: RangeWatch, values: number[], lower: number, upper: number, stepMin = 1) =>
  values.map((v, i) => w.update(v, statusFor(v, lower, upper), lower, upper, i * stepMin * MIN));

describe("RangeWatch", () => {
  test("a reading inside the bounds never alerts", () => {
    expect(feed(new RangeWatch("Humidity", "%"), Array(30).fill(65), 50, 70).every((a) => a === null)).toBe(true);
  });

  test("ten minutes outside the bounds raise one alert", () => {
    const out = feed(new RangeWatch("Humidity", "%"), Array(25).fill(74), 50, 70);
    const fired = out.filter(Boolean);
    expect(fired.length).toBe(1);
    expect(out.findIndex(Boolean)).toBe(10);
    expect(fired[0]!.kind).toBe("Humidity Out of Range");
    expect(fired[0]!.message).toContain("above the safe range (50-70 %)");
  });

  test("a short excursion does not alert", () => {
    expect(feed(new RangeWatch("Temperature", "°C"), [30, 35, 35, 35, 30, 35, 35], 26, 34).every((a) => a === null)).toBe(true);
  });

  test("coming back inside resets, so the next excursion alerts again", () => {
    const vals = [...Array(12).fill(36), 30, ...Array(12).fill(36)];
    expect(feed(new RangeWatch("Temperature", "°C"), vals, 26, 34).filter(Boolean).length).toBe(2);
  });

  test("far outside is critical, just outside is a warning", () => {
    const crit = feed(new RangeWatch("Temperature", "°C"), Array(12).fill(40), 26, 34).find(Boolean)!;
    const warn = feed(new RangeWatch("Temperature", "°C"), Array(12).fill(35), 26, 34).find(Boolean)!;
    expect(crit.severity).toBe("critical");
    expect(warn.severity).toBe("warning");
    expect(warn.message).toContain("above");
    const low = feed(new RangeWatch("Temperature", "°C"), Array(12).fill(24), 26, 34).find(Boolean)!;
    expect(low.message).toContain("below");
  });
});
