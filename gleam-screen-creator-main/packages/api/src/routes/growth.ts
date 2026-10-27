import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";

/**
 * GET  /growth/analytics  — growth curve, cohorts, volumetric sample, mortality.
 * POST /growth/mortality  — log an observed daily death count for a house
 *                            (OPERATOR/FARM_MANAGER/ADMIN). Raises a
 *                            mortality_spike alert when the daily count
 *                            jumps by >= 3 versus the previous entry for
 *                            that house, mirroring cerebroil-backend's rule.
 */
const mortalityBody = z.object({
  houseId: z.string().min(1),
  day: z.coerce.number().int().min(0),
  dailyCount: z.coerce.number().int().min(0),
});

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

    // Mortality rate — added in migration 0013. Trailing series per house,
    // newest first, plus a per-house "latest" convenience row.
    const mortalitySeries = await app.sqlRead`
      SELECT m.house_id AS "houseId", h.label AS "houseLabel", m.day,
             m.daily_count AS "dailyCount", m.cumulative_count AS "cumulativeCount",
             m.estimated_alive AS "estimatedAlive", m.recorded_at AS "recordedAt"
      FROM mortality_logs m
      JOIN houses h ON h.id = m.house_id
      WHERE m.cycle_id = ${c.id}
      ORDER BY m.house_id, m.day ASC`;

    const latestByHouse = new Map<string, (typeof mortalitySeries)[number]>();
    for (const row of mortalitySeries) latestByHouse.set(row.houseId, row);

    return reply.send({
      cycle: c,
      curve,
      cohorts,
      volumetric: volumetric[0] ?? null,
      mortality: {
        series: mortalitySeries,
        latestByHouse: Object.fromEntries(latestByHouse),
      },
    });
  });

  app.post("/mortality", { preHandler: [requireAuth, requireRole("OPERATOR", "FARM_MANAGER", "ADMIN")] }, async (request, reply) => {
    const parsed = mortalityBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    const { houseId, day, dailyCount } = parsed.data;

    const houseRows = await app.sqlRead`SELECT id, population FROM houses WHERE id = ${houseId}`;
    if (houseRows.count === 0) return reply.code(404).send({ error: "house_not_found" });
    const house = houseRows[0]!;

    const activeCycle = await app.sqlRead`SELECT id, facility_id AS "facilityId" FROM flock_cycles WHERE status = 'active' LIMIT 1`;
    if (activeCycle.count === 0) return reply.code(404).send({ error: "no_active_cycle" });
    const cycle = activeCycle[0]!;

    const prevRows = await app.sqlRead`
      SELECT day, daily_count AS "dailyCount", cumulative_count AS "cumulativeCount", estimated_alive AS "estimatedAlive"
      FROM mortality_logs
      WHERE cycle_id = ${cycle.id} AND house_id = ${houseId}
      ORDER BY day DESC LIMIT 1`;
    const prev = prevRows[0] as { day: number; dailyCount: number; cumulativeCount: number; estimatedAlive: number | null } | undefined;

    const cumulativeCount = (prev?.cumulativeCount ?? 0) + dailyCount;
    const baseline = prev?.estimatedAlive ?? house.population;
    const estimatedAlive = Math.max(0, baseline - dailyCount);

    await app.sqlWrite`
      INSERT INTO mortality_logs (cycle_id, house_id, day, daily_count, cumulative_count, estimated_alive)
      VALUES (${cycle.id}, ${houseId}, ${day}, ${dailyCount}, ${cumulativeCount}, ${estimatedAlive})
      ON CONFLICT (cycle_id, house_id, day) DO UPDATE SET
        daily_count = EXCLUDED.daily_count,
        cumulative_count = EXCLUDED.cumulative_count,
        estimated_alive = EXCLUDED.estimated_alive,
        recorded_at = now()`;

    let alertRaised = false;
    if (prev && dailyCount - prev.dailyCount >= 3) {
      const alertId = `ALT-MORT-${Date.now()}`;
      await app.sqlWrite`
        INSERT INTO alerts (id, facility_id, kind, severity, message, raised_at)
        VALUES (${alertId}, ${cycle.facilityId}, ${"Mortality Spike"}, ${"critical"},
                ${`Mortality spike in ${houseId}: ${dailyCount} deaths today (previous: ${prev.dailyCount}).`}, now())`;
      alertRaised = true;
    }

    return reply.send({ day, dailyCount, cumulativeCount, estimatedAlive, alertRaised });
  });
}
