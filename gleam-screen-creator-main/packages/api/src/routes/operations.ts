import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/middleware.js";

/**
 * GET /operations/overview
 * Mirrors the `getOperationsOverview` server function.
 */
export async function registerOperationsRoutes(app: FastifyInstance) {
  app.get("/overview", { preHandler: [requireAuth] }, async (request, reply) => {
    const facility = await app.sqlRead`
      SELECT id, name, breed, house_range_label AS "houseRange"
      FROM facilities LIMIT 1`;
    if (facility.count === 0) return reply.code(404).send({ error: "no_facility" });
    const f = facility[0]!;

    const houses = await app.sqlRead`
      SELECT id, label, section, population
      FROM houses WHERE facility_id = ${f.id} AND is_active = true
      ORDER BY sort_order`;

    const cycle = await app.sqlRead`
      SELECT id, label,
             start_date::text AS "startDate",
             projected_yield_date::text AS "projectedYieldDate",
             (CURRENT_DATE - start_date)::int AS day,
             (start_date + interval '6 days')::text AS "windowStart",
             (start_date + interval '41 days')::text AS "windowEnd",
             now()::text AS "asOf"
      FROM flock_cycles
      WHERE facility_id = ${f.id} AND status = 'active'
      LIMIT 1`;

    const latestReadings = await app.sqlRead`
      SELECT DISTINCT ON (s.id) s.id AS "sensorId", s.house_id AS "houseId",
             st.code AS parameter, s.code, s.label,
             r.value, r.unit, r.status, r.recorded_at AS "recordedAt",
             sb.lower_bound AS "boundsMin", sb.upper_bound AS "boundsMax",
             sb.display_label AS "boundsLabel"
      FROM sensor_readings r
      JOIN sensors s ON s.id = r.sensor_id
      JOIN sensor_types st ON st.code = s.sensor_type_code
      LEFT JOIN LATERAL (
        SELECT lower_bound, upper_bound, display_label
        FROM sensor_bounds
        WHERE sensor_id = s.id AND effective_from <= CURRENT_DATE
          AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        ORDER BY effective_from DESC LIMIT 1
      ) sb ON true
      ORDER BY s.id, r.recorded_at DESC`;

    const alerts = await app.sqlRead`
      SELECT id, kind, severity, message, raised_at AS "raisedAt", acknowledged
      FROM alerts
      WHERE facility_id = ${f.id}
      ORDER BY raised_at DESC LIMIT 50`;

    const platform = await app.sqlRead`
      SELECT app_version AS "appVersion", release_channel AS "releaseChannel",
             api_version AS "apiVersion", ml_model AS "mlModel", llm,
             cpu_percent AS "cpuPercent", ram_gb AS "ramGb", status
      FROM platform_status LIMIT 1`;

    return reply.send({
      facility: f,
      houses,
      cycle: cycle[0] ?? null,
      platform: platform[0] ?? null,
      readings: latestReadings,
      alerts,
    });
  });
}
