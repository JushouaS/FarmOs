import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/middleware.js";

/**
 * GET /growth/analytics — growth curve, cohorts, volumetric sample.
 */
export async function registerGrowthRoutes(app: FastifyInstance) {
  app.get("/analytics", { preHandler: [requireAuth] }, async (request, reply) => {
    const cycle = await app.sqlRead`
      SELECT id, label, start_date::text AS "startDate",
             projected_yield_date::text AS "projectedYieldDate"
      FROM flock_cycles WHERE status = 'active' LIMIT 1`;
    if (cycle.count === 0) return reply.code(404).send({ error: "no_active_cycle" });
    const c = cycle[0]!;

    const curve = await app.sqlRead`
      SELECT day, actual_g AS "actualG", standard_g AS "standardG",
             sample_size AS "sampleSize", estimation_confidence AS "estimationConfidence"
      FROM cycle_weights
      WHERE cycle_id = ${c.id}
      ORDER BY day ASC`;

    const cohorts = await app.sqlRead`
      SELECT c.id, c.house_id AS "houseId", c.min_g AS "minG", c.max_g AS "maxG",
             c.standard_deviation_g AS "standardDeviationG", c.median_g AS "medianG",
             c.status, h.label AS "houseLabel"
      FROM cohorts c
      JOIN houses h ON h.id = c.house_id
      WHERE c.cycle_id = ${c.id}
      ORDER BY h.sort_order`;

    const volumetric = await app.sqlRead`
      SELECT v.sensor_id AS "sensorId", v.cohort_id AS "cohortId",
             v.breast_width_mm AS "breastWidthMm", v.total_length_mm AS "totalLengthMm",
             v.depth_z_mm AS "depthZMm", v.calculated_mass_g AS "calculatedMassG",
             v.morphological_index AS "morphologicalIndex",
             v.density_ratio AS "densityRatio", v.precision_percent AS "precisionPercent",
             h.label AS "cohortHouseLabel"
      FROM volumetric_samples v
      LEFT JOIN cohorts co ON co.id = v.cohort_id
      LEFT JOIN houses h ON h.id = co.house_id
      ORDER BY v.sampled_at DESC LIMIT 1`;

    return reply.send({
      cycle: c,
      curve,
      cohorts,
      volumetric: volumetric[0] ?? null,
    });
  });
}
