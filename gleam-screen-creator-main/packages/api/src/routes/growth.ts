import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { refreshMeasuredDay } from "../measured-weights.js";
import { raiseAlert } from "../notify.js";
import { currentDay, databaseToday, readCycleSetting, standardAtDay, type StandardPoint } from "../cycle-day.js";

/**
 * GET  /growth/analytics  — growth curve, cohorts, volumetric sample, mortality.
 * GET/PUT/DELETE /growth/actual-weights — the weight a person measured for a bird on a
 *                            grow-out day, to compare with the estimate (Flock Tracking).
 * GET  /growth/weight-spread — the weights typed in for the newest grow-out day (up to today) that has any,
 *                            with the breed standard for that day; the pages work out the spread from it.
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

const birdId = z.string().regex(/^B-\d{1,4}$/, "bird ids look like B-001");

const actualWeightBody = z.object({
  birdId,
  day: z.coerce.number().int().min(1).max(100),
  // Grams, as read off the scale.
  actualG: z.coerce.number().min(20).max(8000),
  // What the page estimated for this bird when the weight was entered, kept for later comparison.
  estimatedG: z.coerce.number().min(0).max(20000).optional(),
});

const actualWeightQuery = z.object({ day: z.coerce.number().int().min(1).max(100) });
const actualWeightDelete = z.object({ birdId, day: z.coerce.number().int().min(1).max(100) });

async function activeCycleId(app: FastifyInstance): Promise<string | null> {
  const rows = await app.sqlRead`SELECT id FROM flock_cycles WHERE status = 'active' LIMIT 1`;
  return rows.count === 0 ? null : (rows[0]!.id as string);
}

export async function registerGrowthRoutes(app: FastifyInstance) {
  // The weights entered for one grow-out day, for every bird.
  app.get("/actual-weights", { preHandler: [requireAuth] }, async (request, reply) => {
    const q = actualWeightQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_query" });
    const cycleId = await activeCycleId(app);
    if (!cycleId) return reply.send([]);
    const rows = await app.sqlRead`
      SELECT bird_id AS "birdId", day, actual_g::float AS "actualG", estimated_g::float AS "estimatedG",
             recorded_at::text AS "recordedAt"
      FROM actual_weights WHERE cycle_id = ${cycleId} AND day = ${q.data.day}
      ORDER BY bird_id`;
    return reply.send(rows);
  });

  // For each bird, its most recent weight before a given day, so today's gain can be worked out.
  app.get("/actual-weights/previous", { preHandler: [requireAuth] }, async (request, reply) => {
    const q = actualWeightQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_query" });
    const cycleId = await activeCycleId(app);
    if (!cycleId) return reply.send([]);
    const rows = await app.sqlRead`
      SELECT DISTINCT ON (bird_id) bird_id AS "birdId", day, actual_g::float AS "actualG"
      FROM actual_weights WHERE cycle_id = ${cycleId} AND day < ${q.data.day}
      ORDER BY bird_id, day DESC`;
    return reply.send(rows);
  });

  // The set of weights the Dashboard report, the Analytics weight tab and the AI briefing describe.
  app.get("/weight-spread", { preHandler: [requireAuth] }, async (_request, reply) => {
    const empty = { day: null, n: 0, standardG: null, birds: [] };
    const cycleId = await activeCycleId(app);
    if (!cycleId) return reply.send(empty);
    const today = await databaseToday(app);
    const day = currentDay(await readCycleSetting(app, today), today);
    const newest = await app.sqlRead`
      SELECT max(day)::int AS day FROM actual_weights WHERE cycle_id = ${cycleId} AND day <= ${day}`;
    const measuredDay = newest[0]?.day as number | null;
    if (measuredDay === null || measuredDay === undefined) return reply.send(empty);
    const rows = await app.sqlRead`
      SELECT bird_id AS "id", actual_g::float AS "weightG"
      FROM actual_weights WHERE cycle_id = ${cycleId} AND day = ${measuredDay} ORDER BY bird_id`;
    const standards = await app.sqlRead`SELECT day, standard_g AS "standardG" FROM cycle_weights WHERE cycle_id = ${cycleId}`;
    const points: StandardPoint[] = standards.map((r) => ({ day: Number(r.day), standardG: Number(r.standardG) }));
    return reply.send({ day: measuredDay, n: rows.length, standardG: standardAtDay(points, measuredDay), birds: rows });
  });

  // Enter (or correct) a bird's weight for a day.
  app.put(
    "/actual-weights",
    { preHandler: [requireAuth, requireRole("OPERATOR", "FARM_MANAGER", "ADMIN")] },
    async (request, reply) => {
      const parsed = actualWeightBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      const cycleId = await activeCycleId(app);
      if (!cycleId) return reply.code(404).send({ error: "no_active_cycle" });
      const { birdId: id, day, actualG, estimatedG } = parsed.data;
      await app.sqlWrite`
        INSERT INTO actual_weights (cycle_id, bird_id, day, actual_g, estimated_g, recorded_by)
        VALUES (${cycleId}, ${id}, ${day}, ${actualG}, ${estimatedG ?? null}, ${request.authUser!.sub})
        ON CONFLICT (cycle_id, bird_id, day) DO UPDATE SET
          actual_g = EXCLUDED.actual_g, estimated_g = EXCLUDED.estimated_g,
          recorded_by = EXCLUDED.recorded_by, recorded_at = now()`;
      // The day's mean becomes the point on the growth curve, so the Dashboard
      // and the report follow the weights as they are typed rather than a
      // separate curve nobody updates.
      const measured = await refreshMeasuredDay(app, cycleId, day);
      return reply.send({ saved: true, birdId: id, day, actualG, ...measured });
    },
  );

  // Remove a weight that was entered by mistake.
  app.delete(
    "/actual-weights",
    { preHandler: [requireAuth, requireRole("OPERATOR", "FARM_MANAGER", "ADMIN")] },
    async (request, reply) => {
      const q = actualWeightDelete.safeParse(request.query);
      if (!q.success) return reply.code(400).send({ error: "invalid_query" });
      const cycleId = await activeCycleId(app);
      if (!cycleId) return reply.send({ removed: false });
      const gone = await app.sqlWrite`
        DELETE FROM actual_weights WHERE cycle_id = ${cycleId} AND bird_id = ${q.data.birdId} AND day = ${q.data.day}
        RETURNING bird_id`;
      // A day left with no weigh-ins goes back to being the breed standard.
      const measured = gone.count > 0 ? await refreshMeasuredDay(app, cycleId, q.data.day) : null;
      return reply.send({ removed: gone.count > 0, ...(measured ?? {}) });
    },
  );

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
      WHERE cycle_id = ${c.id} AND actual_g IS NOT NULL
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
      // raiseAlert saves the alert and notifies people by their Settings.
      await raiseAlert(app, {
        facilityId: cycle.facilityId,
        kind: "Mortality Spike",
        severity: "critical",
        message: `Mortality spike in ${houseId}: ${dailyCount} deaths today (previous: ${prev.dailyCount}).`,
      });
      alertRaised = true;
    }

    return reply.send({ day, dailyCount, cumulativeCount, estimatedAlive, alertRaised });
  });
}
