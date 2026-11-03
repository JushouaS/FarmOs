import type { FastifyInstance } from "fastify";
import { standardAtDay, type WeightPoint } from "./cycle-day.js";

/**
 * The flock's measured weight for a grow-out day, kept in cycle_weights for the Dashboard's growth chart.
 *
 * The only measurement today is the weight a person typed in for a bird on Flock Tracking
 * (actual_weights). The day's figure is the mean of those weights and the sample size is how many birds
 * were weighed. The Kinect's estimates are not used here: they are about 18% off for one bird and have not
 * been checked on this farm's birds yet, so they stay on the Live Camera page (plan.md, T2.7).
 *
 * A day with no weights has no measurement; it keeps only the breed standard.
 */
export async function syncDayWeight(app: FastifyInstance, cycleId: string, day: number): Promise<void> {
  const measured = await app.sqlWrite`
    SELECT avg(actual_g)::float AS mean, count(*)::int AS n
    FROM actual_weights WHERE cycle_id = ${cycleId} AND day = ${day}`;
  const n = Number(measured[0]?.n ?? 0);

  if (n === 0) {
    await app.sqlWrite`
      UPDATE cycle_weights
         SET actual_g = NULL, sample_size = NULL, estimation_confidence = NULL, source = NULL, recorded_at = now()
       WHERE cycle_id = ${cycleId} AND day = ${day}`;
    return;
  }

  const rows = await app.sqlWrite`SELECT day, standard_g AS "standardG" FROM cycle_weights WHERE cycle_id = ${cycleId}`;
  const standards: WeightPoint[] = rows.map((r) => ({ day: Number(r.day), actualG: null, standardG: Number(r.standardG) }));
  const standardG = standardAtDay(standards, day);
  if (standardG === null) return; // no breed standard stored for this cycle, so there is nothing to compare with

  await app.sqlWrite`
    INSERT INTO cycle_weights (cycle_id, day, actual_g, standard_g, sample_size, estimation_confidence, source, recorded_at)
    VALUES (${cycleId}, ${day}, ${Math.round(Number(measured[0]!.mean))}, ${standardG}, ${n}, NULL, 'scale', now())
    ON CONFLICT (cycle_id, day) DO UPDATE SET
      actual_g = EXCLUDED.actual_g, sample_size = EXCLUDED.sample_size, estimation_confidence = NULL,
      source = 'scale', recorded_at = now()`;
}

/** Brings every day that has typed-in weights up to date (at start-up, in case weights were saved before this existed). */
export async function syncAllWeights(app: FastifyInstance): Promise<number> {
  const days = await app.sqlWrite`SELECT DISTINCT cycle_id AS "cycleId", day FROM actual_weights`;
  for (const d of days) await syncDayWeight(app, String(d.cycleId), Number(d.day));
  return days.length;
}
