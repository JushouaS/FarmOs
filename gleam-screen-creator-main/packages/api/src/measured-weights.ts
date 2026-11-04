import type { FastifyInstance } from "fastify";

import { standardAtDay, type StandardPoint } from "./cycle-day.js";

/**
 * Keeps the growth curve in step with the weights people type in.
 *
 * Flock Tracking writes one row per bird per day into `actual_weights`. The
 * Dashboard, the growth report and Analytics read `cycle_weights`, one row per
 * day. Nothing used to join the two, so the curve on those pages came from the
 * sample dataset while the typed weights sat in their own table. This is the
 * join: after every save or removal, the day's row is the mean of what was
 * measured that day, or the bare breed standard again when nothing is left.
 *
 * The mean is rounded to the gram because the standard and every figure the
 * pages show are grams; half a gram of precision would suggest a scale reading
 * the app does not have.
 */

export interface MeasuredDay {
  /** The mean of the day's weigh-ins, or null when nothing is left to measure. */
  meanG: number | null;
  /** How many birds were weighed that day. */
  sampleSize: number;
}

export async function refreshMeasuredDay(app: FastifyInstance, cycleId: string, day: number): Promise<MeasuredDay> {
  const aggregate = await app.sqlRead`
    SELECT avg(actual_g)::float AS mean, count(*)::int AS n
    FROM actual_weights
    WHERE cycle_id = ${cycleId} AND day = ${day}`;
  const mean = aggregate[0]?.mean as number | null | undefined;
  const sampleSize = Number(aggregate[0]?.n ?? 0);

  if (mean == null || sampleSize === 0) {
    // The last weight for the day was removed: the row goes back to being the
    // standard it was before, rather than disappearing and leaving a gap in the
    // dashed line the chart draws through it.
    await app.sqlWrite`
      UPDATE cycle_weights
         SET actual_g = NULL, sample_size = NULL, estimation_confidence = NULL, source = 'standard'
       WHERE cycle_id = ${cycleId} AND day = ${day} AND source = 'measured'`;
    return { meanG: null, sampleSize: 0 };
  }

  const meanG = Math.round(mean);

  // The standard for the day, read the same way the chart reads it, so the two
  // lines cannot disagree by a gram at the point they meet.
  const standardRows = await app.sqlRead`
    SELECT day, standard_g::float AS "standardG" FROM cycle_weights WHERE cycle_id = ${cycleId}`;
  const standard: StandardPoint[] = standardRows.map((r) => ({
    day: Number(r.day),
    standardG: Number(r.standardG),
  }));
  const standardG = standardAtDay(standard, day);
  if (standardG === null) {
    // No standard rows at all for this cycle: `standard_g` is NOT NULL, so there
    // is no row to write. The typed weights still stand on their own page.
    return { meanG, sampleSize };
  }

  await app.sqlWrite`
    INSERT INTO cycle_weights (cycle_id, day, actual_g, standard_g, sample_size, estimation_confidence, source, recorded_at)
    VALUES (${cycleId}, ${day}, ${meanG}, ${standardG}, ${sampleSize}, NULL, 'measured', now())
    ON CONFLICT (cycle_id, day) DO UPDATE SET
      actual_g = EXCLUDED.actual_g,
      standard_g = EXCLUDED.standard_g,
      sample_size = EXCLUDED.sample_size,
      estimation_confidence = NULL,
      source = 'measured',
      recorded_at = now()`;

  return { meanG, sampleSize };
}
