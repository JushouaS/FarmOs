import { expect, test } from "bun:test";
import { minutesSilent, statusFor } from "../src/sensor-monitor.js";

test("a sensor that never reported is not offline, one that did is silent for whole minutes", () => {
  const now = Date.parse("2026-11-04T10:00:00Z");
  expect(minutesSilent(null, now)).toBeNull();
  expect(minutesSilent(now - 30_000, now)).toBe(0);
  expect(minutesSilent(now - 11 * 60_000 - 5_000, now)).toBe(11);
  expect(minutesSilent(now + 5_000, now)).toBe(0); // a clock a little ahead never gives a negative number
});

test("a reading is nominal inside its bounds and critical well outside", () => {
  expect(statusFor(25, 20, 32)).toBe("nominal");
  expect(statusFor(33, 20, 32)).toBe("warning");
  expect(statusFor(40, 20, 32)).toBe("critical");
});
