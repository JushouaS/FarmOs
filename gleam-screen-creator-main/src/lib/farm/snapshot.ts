import { freshReading } from "./pen-sensors";
import { isNightCycle } from "./lighting";
import { buildFlockWeights, fmtW, type WeightSpread } from "./weights";

/**
 * Grounding context for the intelligence engine, written only from what was measured.
 *
 * Every line comes from a real source: the weights typed in on Flock Tracking, the DHT22 sensor, the live
 * behavior monitor, and the alerts the monitors raised. Anything with no source is listed under NOT MEASURED,
 * and the model is told to say so rather than guess. There is no sample flock behind this text.
 */
export interface SnapshotInputs {
  /** GET /operations/overview */
  overview: any;
  /** GET /growth/weight-spread */
  spread: WeightSpread;
  /** GET /visual/behavior: `running: false` when the monitor is off or the camera computer is away. */
  behavior: any;
  now?: Date;
}

/** Alerts newer than this are "recent" (older ones are the sample rows that came with the database or long closed). */
const RECENT_ALERT_DAYS = 7;

export function buildLiveSnapshot({ overview, spread, behavior, now = new Date() }: SnapshotInputs): { text: string; hasData: boolean } {
  const flock = buildFlockWeights(overview, spread);
  const lines: string[] = [];
  let hasData = false;

  const facility = overview?.facility;
  const houseLabel: string = overview?.cluster?.houseLabel ?? "the pen";
  lines.push(`FARM TELEMETRY SNAPSHOT (${facility?.name ?? "farm"}, taken ${now.toISOString()})`);
  lines.push(
    `- Flock: ${facility?.breed ?? "broilers"}, ${houseLabel}${flock.population ? `, ${flock.population} birds` : ""}, grow-out day ${flock.day} of ${flock.endDay}.`,
  );

  // Weight: only what a person weighed.
  if (flock.avgG !== null && flock.standardG && flock.variancePercent !== null) {
    hasData = true;
    const v = flock.variancePercent;
    let line = `- Weight: ${flock.birds.length} birds were weighed on a scale on day ${flock.measuredDay}. Average ${fmtW(flock.avgG)} against the Ross 308 standard of ${fmtW(flock.standardG)} for that day (${v >= 0 ? "+" : ""}${v}%).`;
    const lightest = flock.birds.reduce((a, b) => (b.weightG < a.weightG ? b : a));
    const heaviest = flock.birds.reduce((a, b) => (b.weightG > a.weightG ? b : a));
    line += ` Lightest ${lightest.id} ${fmtW(lightest.weightG)}, heaviest ${heaviest.id} ${fmtW(heaviest.weightG)}.`;
    if (flock.sdG !== null) line += ` Standard deviation ${flock.sdG} g.`;
    line += ` Under the target band: ${flock.breakdown.Underweight}; in it: ${flock.breakdown.Optimal}; over it: ${flock.breakdown.Overweight}.`;
    if (flock.birds.length < 10) line += ` Only ${flock.birds.length} birds were weighed, so this is a weak sample.`;
    if (flock.projectedHarvestG) line += ` Heading for about ${fmtW(flock.projectedHarvestG)} on day ${flock.endDay} if it stays as far ahead or behind the standard.`;
    lines.push(line);
  } else {
    lines.push(`- Weight: no bird weights have been typed in yet, so the flock's weight is unknown.`);
  }

  // The pen's air, when the sensor reported in the last few minutes.
  const t = freshReading(overview, "temperature", now.getTime());
  const h = freshReading(overview, "humidity", now.getTime());
  if (t || h) {
    hasData = true;
    const parts = [t ? `temperature ${t.value.toFixed(1)} °C (${t.status})` : null, h ? `humidity ${Math.round(h.value)}% (${h.status})` : null].filter(Boolean);
    lines.push(`- ${houseLabel} air now: ${parts.join(", ")}. Comfortable range for broilers is about 20 to 32 °C and 50 to 70% humidity.`);
  } else {
    lines.push(`- ${houseLabel} air: no current reading (the temperature and humidity sensor is silent).`);
  }

  // Behavior from the live monitor on the camera computer.
  if (behavior?.running) {
    hasData = true;
    const birds = Number(behavior.birds ?? 0);
    const still = behavior.flock_inactive ? birds : Array.isArray(behavior.inactive) ? behavior.inactive.length : 0;
    const huddled = Number(behavior.huddle?.birds ?? 0);
    const night = isNightCycle(now, overview?.lighting);
    lines.push(
      `- Behavior (live camera, ${night ? "night" : "day"}): ${birds} birds followed; ${still} have stayed still for a long time${night ? " (still birds are expected to sleep at night)" : ""}; ${huddled} are huddled together${behavior.huddle?.warning ? " (above the warning level)" : ""}.`,
    );
  } else {
    lines.push(`- Behavior: the live behavior monitor is off, so activity and huddling are unknown.`);
  }

  // What the monitors raised lately and nobody has dealt with.
  const alerts: any[] = Array.isArray(overview?.alerts) ? overview.alerts : [];
  const cutoff = now.getTime() - RECENT_ALERT_DAYS * 86_400_000;
  const open = alerts.filter((a) => !a.acknowledged && Date.parse(a.raisedAt) >= cutoff);
  if (open.length > 0) {
    hasData = true;
    lines.push(`- Open alerts (${open.length}, not yet acknowledged, from the last ${RECENT_ALERT_DAYS} days):`);
    for (const a of open.slice(0, 6)) lines.push(`  * ${a.severity} ${a.kind}: ${a.message}`);
  } else {
    lines.push(`- Open alerts: none from the last ${RECENT_ALERT_DAYS} days.`);
  }

  lines.push(`- NOT MEASURED (no sensor or no data): feed and feed conversion, water intake, ammonia, CO2, per-bird behavior, mortality unless typed in.`);
  return { text: lines.join("\n"), hasData };
}
