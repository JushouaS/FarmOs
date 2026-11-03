import { describe, expect, test } from "bun:test";
import { behaviorReport, countReport, formatReport, parseCsv, weightReport } from "../src/validation.js";

describe("reading the CSV files", () => {
  test("headers in any case, quotes, a comma inside quotes, blank lines and a BOM", () => {
    const rows = parseCsv('\uFEFFDate,Bird_ID,Notes\r\n2026-11-10,B-001,"hen, left"\r\n\r\n2026-11-10,B-002,\r\n');
    expect(rows).toEqual([
      { date: "2026-11-10", bird_id: "B-001", notes: "hen, left" },
      { date: "2026-11-10", bird_id: "B-002", notes: "" },
    ]);
  });
});

describe("weight", () => {
  const csv = (pairs: [string, number, number][]) =>
    parseCsv("date,day,bird_id,scale_g,kinect_g\n" + pairs.map(([d, s, k], i) => `${d},22,B-${i + 1},${s},${k}`).join("\n"));

  test("bias, typical error and the share within each limit", () => {
    // errors: +10%, -10%, +5%, 0%, -20%
    const r = weightReport(csv([["d1", 1000, 1100], ["d1", 1000, 900], ["d1", 1000, 1050], ["d1", 1000, 1000], ["d1", 1000, 800]]));
    expect(r.birds).toBe(5);
    expect(r.biasPercent).toBe(-3);
    expect(r.meanAbsErrorPercent).toBe(9);
    expect(r.meanAbsErrorG).toBe(90);
    expect(r.within).toEqual({ "5": 40, "10": 80, "15": 80, "20": 100 });
    expect(r.p80AbsErrorPercent).toBe(10);
    expect(r.sessions).toEqual([{ date: "d1", birds: 5, scaleMeanG: 1000, kinectMeanG: 970, errorPercent: -3 }]);
    expect(r.sessionTargetMet).toBe(true);
  });

  test("a day whose flock average is more than 5% off fails the target, and a day with under 5 birds is not judged", () => {
    const r = weightReport(csv([["d1", 1000, 1100], ["d1", 1000, 1100], ["d1", 1000, 1100], ["d1", 1000, 1100], ["d1", 1000, 1100], ["d2", 1000, 1000]]));
    expect(r.sessions.map((s) => s.date)).toEqual(["d1"]);
    expect(r.sessionTargetMet).toBe(false);
  });

  test("rows missing a weight are skipped, and no usable row is an error", () => {
    const rows = parseCsv("date,scale_g,kinect_g\nd1,1000,\nd1,,900\nd1,1000,1000");
    expect(weightReport(rows).skipped).toBe(2);
    expect(() => weightReport(parseCsv("date,scale_g,kinect_g\nd1,,"))).toThrow();
  });
});

describe("count", () => {
  test("error is the total miss as a share of the birds counted by hand", () => {
    const rows = parseCsv("frame_id,manual_count,detector_count\na,20,18\nb,10,10\nc,30,33\nd,0,2");
    const r = countReport(rows);
    expect(r.manualTotal).toBe(60);
    expect(r.detectorTotal).toBe(63);
    expect(r.bias).toBe(0.75);
    expect(r.errorPercent).toBe(11.7); // (2 + 0 + 3 + 2) / 60
    expect(r.targetMet).toBe(false);
    expect(r.worst[0]!.frame).toBe("c");
    expect(r.withinOne).toBe(25);
  });
});

describe("behavior", () => {
  test("hits, false alarms, misses and advice per kind", () => {
    const rows = parseCsv(
      "kind,observed,alerted\n" +
        "inactive,yes,yes\ninactive,yes,no\ninactive,no,yes\ninactive,no,yes\ninactive,yes,yes\n" +
        "huddling,yes,yes\nhuddling,maybe,yes",
    );
    const [inactive, huddling] = behaviorReport(rows);
    expect(inactive).toMatchObject({ kind: "inactive", observed: 3, alerted: 4, hits: 2, falseAlarms: 2, misses: 1, precisionPercent: 50, recallPercent: 67 });
    expect(inactive!.advice).toContain("false alarms");
    expect(huddling).toMatchObject({ observed: 1, alerted: 1, hits: 1 }); // the row with "maybe" is left out
  });

  test("the text report names each figure", () => {
    const text = formatReport("behavior", parseCsv("kind,observed,alerted\ninactive,yes,yes"));
    expect(text).toContain("Behavior, inactive: 1 seen, 1 alerts, 1 matched");
  });
});
