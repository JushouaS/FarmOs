import { describe, expect, it } from "bun:test";
import { pictureArea, watchMinutes, watchSummary } from "./stillness";

const bird = (id: number, still_seconds: number, level: "yellow" | "orange", at: [number, number] = [0.5, 0.5]) => ({
  id,
  still_seconds,
  level,
  at,
});

describe("watch list", () => {
  it("is null for a camera service that sends none", () => {
    expect(watchSummary(null)).toBeNull();
    expect(watchSummary({ running: true, birds: 20 })).toBeNull();
  });

  it("sorts longest first and picks out the orange birds", () => {
    const s = watchSummary({ running: true, watch: [bird(3, 400, "yellow"), bird(7, 1200, "orange"), bird(9, 950, "orange")] });
    expect(s?.all.map((w) => w.id)).toEqual([7, 9, 3]);
    expect(s?.orange.map((w) => w.id)).toEqual([7, 9]);
  });

  it("uses the levels the camera computer reports, or 5 and 15", () => {
    expect(watchMinutes({ running: true, watch_minutes: [2, 10] })).toEqual([2, 10]);
    expect(watchMinutes({ running: true })).toEqual([5, 15]);
    expect(watchMinutes({ running: true, watch_minutes: [15, 5] as [number, number] })).toEqual([5, 15]);
  });
});

describe("pictureArea", () => {
  it("names the nine areas of the picture", () => {
    expect(pictureArea([0.1, 0.1])).toBe("Top left");
    expect(pictureArea([0.5, 0.1])).toBe("Top");
    expect(pictureArea([0.9, 0.5])).toBe("Right");
    expect(pictureArea([0.5, 0.5])).toBe("Centre");
    expect(pictureArea([0.2, 0.95])).toBe("Bottom left");
    expect(pictureArea(undefined)).toBe("Centre");
  });
});
