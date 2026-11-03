import { describe, expect, test } from "bun:test";
import { buildLiveSnapshot } from "./snapshot";
import { NO_SPREAD, buildFlockWeights, standardForToday, weightCategoryFor } from "./weights";

const overview = {
  facility: { name: "Test Farm", breed: "Ross 308" },
  cycle: { day: 22, startDay: 16, endDay: 45, lengthDays: 45 },
  houses: [{ id: "H02", label: "Pen 1", population: 20 }],
  cluster: { houseId: "H02", houseLabel: "Pen 1", readings: [] as any[] },
  weight: { standardCurve: [{ day: 22, standardG: 1000 }, { day: 45, standardG: 3000 }] },
  alerts: [] as any[],
  lighting: { dayStart: "05:00", nightStart: "17:00" },
};

const birds = [900, 1000, 1100, 1200, 800].map((weightG, i) => ({ id: `B-00${i + 1}`, weightG }));

describe("the flock's weights come only from weighed birds", () => {
  test("with none weighed there is no average, spread or projection", () => {
    const f = buildFlockWeights(overview, NO_SPREAD);
    expect(f.birds).toEqual([]);
    expect([f.avgG, f.medianG, f.sdG, f.variancePercent, f.projectedHarvestG]).toEqual([null, null, null, null, null]);
    expect(f.population).toBe(20);
    expect(f.endStandardG).toBe(3000);
  });

  test("the average, spread, categories and projection are worked out from the weights", () => {
    const f = buildFlockWeights(overview, { day: 22, n: 5, standardG: 1000, birds });
    expect(f.avgG).toBe(1000);
    expect(f.medianG).toBe(1000);
    expect(f.sdG).toBe(158); // sample standard deviation of 800..1200
    expect(f.variancePercent).toBe(0);
    expect(f.breakdown).toEqual({ Underweight: 2, Optimal: 2, Overweight: 1 }); // under 920 g: 800, 900; over 1,150 g: 1,200
    expect(f.projectedHarvestG).toBe(3000);
  });

  test("a flock ahead of the standard is projected ahead", () => {
    const f = buildFlockWeights(overview, { day: 22, n: 2, standardG: 1000, birds: [{ id: "B-001", weightG: 1100 }, { id: "B-002", weightG: 1100 }] });
    expect(f.variancePercent).toBe(10);
    expect(f.projectedHarvestG).toBe(3300);
  });

  test("categories and today's standard", () => {
    expect(weightCategoryFor(900, 1000)).toBe("Underweight");
    expect(weightCategoryFor(1160, 1000)).toBe("Overweight");
    expect(weightCategoryFor(1000, 1000)).toBe("Optimal");
    expect(standardForToday(overview)).toBe(1000);
    expect(standardForToday({})).toBeNull();
  });
});

describe("the AI snapshot says what is measured and what is not", () => {
  const now = new Date("2026-11-04T10:00:00Z");

  test("with nothing measured it says so, and invents nothing", () => {
    const { text, hasData } = buildLiveSnapshot({ overview, spread: NO_SPREAD, behavior: { running: false }, now });
    expect(hasData).toBe(false);
    expect(text).toContain("no bird weights have been typed in");
    expect(text).toContain("no current reading");
    expect(text).toContain("behavior monitor is off");
    expect(text).toContain("NOT MEASURED");
    expect(text).not.toMatch(/ammonia \d|incident \(|ppm baseline/i);
  });

  test("measured weights, a fresh reading, behavior and a recent open alert appear; an old alert does not", () => {
    const withData = {
      ...overview,
      cluster: { ...overview.cluster, readings: [{ parameter: "temperature", value: 30.2, unit: "°C", status: "nominal", recordedAt: new Date(now.getTime() - 60_000).toISOString() }] },
      alerts: [
        { acknowledged: false, raisedAt: "2024-05-24T12:40:00Z", severity: "critical", kind: "CRITICAL_EVENT", message: "an old demo alert" },
        { acknowledged: false, raisedAt: new Date(now.getTime() - 3_600_000).toISOString(), severity: "warning", kind: "Sensor Offline", message: "no reading for 12 minutes" },
      ],
    };
    const { text, hasData } = buildLiveSnapshot({
      overview: withData,
      spread: { day: 22, n: 5, standardG: 1000, birds },
      behavior: { running: true, birds: 18, inactive: [{ id: 3, still_seconds: 900 }], flock_inactive: null, huddle: { birds: 4, fdi: 0.2, seconds: 600, warning: false } },
      now,
    });
    expect(hasData).toBe(true);
    expect(text).toContain("5 birds were weighed");
    expect(text).toContain("temperature 30.2 °C");
    expect(text).toContain("18 birds followed; 1 have stayed still");
    expect(text).toContain("no reading for 12 minutes");
    expect(text).not.toContain("an old demo alert");
  });
});
