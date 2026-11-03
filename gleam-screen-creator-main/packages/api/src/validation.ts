/**
 * Measures how far the system's weights, bird counts and behavior alerts are from what a person found.
 *
 * Three small CSV files are filled in at the farm (templates in docs/templates/) and read here:
 *   weight.csv    date, day, bird_id, scale_g, kinect_g     a bird on a scale, and the Kinect's estimate for it
 *   count.csv     date, frame_id, manual_count, detector_count   birds counted by hand in a picture, and by the detector
 *   behavior.csv  date, kind, observed, alerted             one row per episode: seen by a person, raised by the system
 *
 * The report says what the error is and whether it is inside the target, so the number shown to farmers can be the
 * measured one (plan.md tasks T2.7 to T2.9). Nothing here touches the database.
 */

export type Row = Record<string, string>;

/** Reads CSV text (commas, optional double quotes, a header row) into rows keyed by lower-case header. */
export function parseCsv(text: string): Row[] {
  const lines: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const endField = () => {
    row.push(field.trim());
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c !== "")) lines.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") endField();
    else if (c === "\n") endRow();
    else if (c !== "\r") field += c;
  }
  endRow();
  const header = (lines.shift() ?? []).map((h) => h.toLowerCase().replace(/^﻿/, ""));
  return lines.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const yes = (v: string | undefined): boolean | null => {
  const t = (v ?? "").trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(t)) return true;
  if (["no", "n", "false", "0"].includes(t)) return false;
  return null;
};
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => (xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1)) : 0);
const round = (x: number, d = 1) => Number(x.toFixed(d));
/** The value at or below which `p` (0 to 1) of the values lie (nearest rank). */
const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
};

/* ── Weight ──────────────────────────────────────────────────────────────── */

export interface WeightReport {
  birds: number;
  skipped: number;
  /** Mean of (estimate − scale) / scale, in percent: above 0 the system reads heavy, below 0 light. */
  biasPercent: number;
  /** How far one bird typically is from its scale weight: the mean absolute error and the 80th percentile of it. */
  meanAbsErrorPercent: number;
  p80AbsErrorPercent: number;
  meanAbsErrorG: number;
  /** Share of birds within ±5, 10, 15 and 20 percent. */
  within: Record<"5" | "10" | "15" | "20", number>;
  /** The flock's average from the estimates against the scale's average, for each date with at least 5 birds. */
  sessions: { date: string; birds: number; scaleMeanG: number; kinectMeanG: number; errorPercent: number }[];
  /** True when every session average is within 5% (the plan's target). */
  sessionTargetMet: boolean | null;
  sessionDaysCovered: number;
}

export function weightReport(rows: Row[]): WeightReport {
  const pairs: { date: string; scale: number; kinect: number }[] = [];
  let skipped = 0;
  for (const r of rows) {
    const scale = num(r.scale_g);
    const kinect = num(r.kinect_g);
    if (scale === null || kinect === null || scale <= 0 || kinect <= 0) skipped++;
    else pairs.push({ date: r.date ?? "", scale, kinect });
  }
  if (pairs.length === 0) throw new Error("no bird has both scale_g and kinect_g");
  const err = pairs.map((p) => ((p.kinect - p.scale) / p.scale) * 100);
  const abs = err.map(Math.abs);
  const share = (limit: number) => round((abs.filter((e) => e <= limit).length / abs.length) * 100, 0);

  const byDate = new Map<string, { scale: number[]; kinect: number[] }>();
  for (const p of pairs) {
    const d = byDate.get(p.date) ?? { scale: [], kinect: [] };
    d.scale.push(p.scale);
    d.kinect.push(p.kinect);
    byDate.set(p.date, d);
  }
  const sessions = [...byDate.entries()]
    .filter(([, d]) => d.scale.length >= 5)
    .map(([date, d]) => ({
      date,
      birds: d.scale.length,
      scaleMeanG: Math.round(mean(d.scale)),
      kinectMeanG: Math.round(mean(d.kinect)),
      errorPercent: round(((mean(d.kinect) - mean(d.scale)) / mean(d.scale)) * 100),
    }));

  return {
    birds: pairs.length,
    skipped,
    biasPercent: round(mean(err)),
    meanAbsErrorPercent: round(mean(abs)),
    p80AbsErrorPercent: round(percentile(abs, 0.8)),
    meanAbsErrorG: Math.round(mean(pairs.map((p) => Math.abs(p.kinect - p.scale)))),
    within: { "5": share(5), "10": share(10), "15": share(15), "20": share(20) },
    sessions,
    sessionTargetMet: sessions.length === 0 ? null : sessions.every((s) => Math.abs(s.errorPercent) <= 5),
    sessionDaysCovered: sessions.length,
  };
}

/* ── Count ───────────────────────────────────────────────────────────────── */

export interface CountReport {
  frames: number;
  skipped: number;
  manualTotal: number;
  detectorTotal: number;
  /** Mean of (detector − manual): above 0 the detector counts too many. */
  bias: number;
  meanAbsError: number;
  /** Total absolute error as a share of the total counted by hand (the plan's target is 10% or less). */
  errorPercent: number;
  withinOne: number;
  worst: { frame: string; manual: number; detector: number }[];
  targetMet: boolean;
}

export function countReport(rows: Row[]): CountReport {
  const frames: { frame: string; manual: number; detector: number }[] = [];
  let skipped = 0;
  for (const r of rows) {
    const manual = num(r.manual_count);
    const detector = num(r.detector_count);
    if (manual === null || detector === null || manual < 0 || detector < 0) skipped++;
    else frames.push({ frame: r.frame_id || String(frames.length + 1), manual, detector });
  }
  if (frames.length === 0) throw new Error("no frame has both manual_count and detector_count");
  const diffs = frames.map((f) => f.detector - f.manual);
  const manualTotal = frames.reduce((s, f) => s + f.manual, 0);
  const absTotal = diffs.reduce((s, d) => s + Math.abs(d), 0);
  const errorPercent = manualTotal > 0 ? round((absTotal / manualTotal) * 100) : absTotal === 0 ? 0 : 100;
  return {
    frames: frames.length,
    skipped,
    manualTotal,
    detectorTotal: frames.reduce((s, f) => s + f.detector, 0),
    bias: round(mean(diffs), 2),
    meanAbsError: round(absTotal / frames.length, 2),
    errorPercent,
    withinOne: round((diffs.filter((d) => Math.abs(d) <= 1).length / diffs.length) * 100, 0),
    worst: [...frames].sort((a, b) => Math.abs(b.detector - b.manual) - Math.abs(a.detector - a.manual)).slice(0, 3),
    targetMet: errorPercent <= 10,
  };
}

/* ── Behavior ────────────────────────────────────────────────────────────── */

export interface BehaviorKindReport {
  kind: string;
  /** Episodes a person saw, alerts raised, and how they line up. */
  observed: number;
  alerted: number;
  hits: number;
  falseAlarms: number;
  misses: number;
  /** Of the alerts, the share that were real; of the real episodes, the share that raised an alert. null with none to judge. */
  precisionPercent: number | null;
  recallPercent: number | null;
  advice: string;
}

export function behaviorReport(rows: Row[]): BehaviorKindReport[] {
  const kinds = new Map<string, { observed: number; alerted: number; hits: number }>();
  for (const r of rows) {
    const observed = yes(r.observed);
    const alerted = yes(r.alerted);
    if (observed === null || alerted === null) continue;
    const kind = (r.kind || "episode").toLowerCase();
    const k = kinds.get(kind) ?? { observed: 0, alerted: 0, hits: 0 };
    if (observed) k.observed++;
    if (alerted) k.alerted++;
    if (observed && alerted) k.hits++;
    kinds.set(kind, k);
  }
  if (kinds.size === 0) throw new Error("no row has both observed and alerted set to yes or no");
  return [...kinds.entries()].map(([kind, k]) => {
    const falseAlarms = k.alerted - k.hits;
    const misses = k.observed - k.hits;
    const precision = k.alerted > 0 ? round((k.hits / k.alerted) * 100, 0) : null;
    const recall = k.observed > 0 ? round((k.hits / k.observed) * 100, 0) : null;
    let advice = "Looks balanced. Keep the thresholds.";
    if (precision !== null && precision < 70) advice = "Too many false alarms: make the time before an alert longer (LIVE_INACTIVE_SECONDS or LIVE_HUDDLE_SECONDS).";
    else if (recall !== null && recall < 70) advice = "It misses real episodes: make the time before an alert shorter.";
    else if (k.observed < 10) advice = "Too few episodes to judge yet: watch more video.";
    return { kind, observed: k.observed, alerted: k.alerted, hits: k.hits, falseAlarms, misses, precisionPercent: precision, recallPercent: recall, advice };
  });
}

/** The figures as plain text for a person to read. */
export function formatReport(kind: "weight" | "count" | "behavior", rows: Row[]): string {
  if (kind === "weight") {
    const w = weightReport(rows);
    const out = [
      `Weight: ${w.birds} birds compared${w.skipped ? ` (${w.skipped} rows skipped: a scale or Kinect weight is missing)` : ""}`,
      `  Bias:                    ${w.biasPercent >= 0 ? "+" : ""}${w.biasPercent}%  (above 0 the Kinect reads heavy)`,
      `  One bird is off by:      ${w.meanAbsErrorPercent}% on average (${w.meanAbsErrorG} g); 4 in 5 birds are within ${w.p80AbsErrorPercent}%`,
      `  Within 5/10/15/20%:      ${w.within["5"]}% / ${w.within["10"]}% / ${w.within["15"]}% / ${w.within["20"]}%`,
    ];
    if (w.sessions.length === 0) out.push("  Flock average:           needs a date with at least 5 birds");
    for (const s of w.sessions) out.push(`  Flock average ${s.date}: scale ${s.scaleMeanG} g, Kinect ${s.kinectMeanG} g (${s.errorPercent >= 0 ? "+" : ""}${s.errorPercent}%, ${s.birds} birds)`);
    out.push(
      w.sessionTargetMet === null
        ? "  Target (flock average within 5% on every day): not judged yet"
        : `  Target (flock average within 5% on every day): ${w.sessionTargetMet ? "MET" : "NOT MET"} over ${w.sessionDaysCovered} day(s)${w.sessionDaysCovered < 3 ? "; the plan asks for 3 different days" : ""}`,
      `  To show in the app: "one bird can be off by about ${Math.ceil(w.p80AbsErrorPercent)}%".`,
    );
    return out.join("\n");
  }
  if (kind === "count") {
    const c = countReport(rows);
    return [
      `Count: ${c.frames} pictures compared${c.skipped ? ` (${c.skipped} skipped)` : ""}`,
      `  Counted by hand ${c.manualTotal}, by the detector ${c.detectorTotal}  (bias ${c.bias >= 0 ? "+" : ""}${c.bias} birds per picture)`,
      `  Error: ${c.errorPercent}% of the birds counted by hand; ${c.meanAbsError} birds per picture on average; ${c.withinOne}% of pictures within 1 bird`,
      `  Target (error 10% or less): ${c.targetMet ? "MET" : "NOT MET"}${c.frames < 20 ? "; the plan asks for 20 pictures" : ""}`,
      `  Worst pictures: ${c.worst.map((f) => `${f.frame} (hand ${f.manual}, detector ${f.detector})`).join("; ")}`,
    ].join("\n");
  }
  return behaviorReport(rows)
    .map(
      (b) =>
        `Behavior, ${b.kind}: ${b.observed} seen, ${b.alerted} alerts, ${b.hits} matched, ${b.falseAlarms} false alarms, ${b.misses} missed\n` +
        `  Alerts that were real: ${b.precisionPercent ?? "—"}%   Episodes that raised an alert: ${b.recallPercent ?? "—"}%\n  ${b.advice}`,
    )
    .join("\n");
}
