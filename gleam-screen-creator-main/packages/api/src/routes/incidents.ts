import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";

/**
 * Incident lifecycle.
 *
 * GET    /incidents            — list (status filter)
 * GET    /incidents/:id        — single with peak + evidence + series
 * PATCH  /incidents/:id        — update status/resolution (ADMIN/FARM_MANAGER)
 */

const patchBody = z.object({
  status: z.enum(["open", "resolved_monitoring", "closed"]).optional(),
  resolution: z.string().max(2000).optional(),
  endedAt: z.string().datetime().optional(),
});

export async function registerIncidentRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: [requireAuth] }, async (request, reply) => {
    const { status } = request.query as Record<string, string>;
    const rows = status
      ? await app.sqlRead`
          SELECT id, house_id AS "houseId", title, started_at::text AS "startedAt",
                 ended_at::text AS "endedAt", status
          FROM incidents WHERE status = ${status}
          ORDER BY started_at DESC`
      : await app.sqlRead`
          SELECT id, house_id AS "houseId", title, started_at::text AS "startedAt",
                 ended_at::text AS "endedAt", status
          FROM incidents ORDER BY started_at DESC LIMIT 100`;
    return reply.send(rows);
  });

  app.get("/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const incident = await app.sqlRead`
      SELECT i.id, i.house_id AS "houseId", h.label AS "houseLabel",
             i.title, i.started_at::text AS "startedAt", i.ended_at::text AS "endedAt",
             i.exceedance_minutes AS "exceedanceMinutes",
             i.activity_drop_percent AS "activityDropPercent",
             i.cause, i.resolution, i.status
      FROM incidents i
      JOIN houses h ON h.id = i.house_id
      WHERE i.id = ${id}`;
    if (incident.count === 0) return reply.code(404).send({ error: "not_found" });

    const peak = await app.sqlRead`
      SELECT sensor_id AS "sensorId", parameter, value, unit, threshold, baseline
      FROM incident_peaks WHERE incident_id = ${id}`;

    const series = await app.sqlRead`
      SELECT value FROM incident_peak_series
      WHERE incident_id = ${id}
      ORDER BY sample_index ASC`;

    const evidence = await app.sqlRead`
      SELECT camera_id AS "cameraId", clip_id AS "clipId",
             captured_at::text AS "capturedAt",
             detection_label AS "detectionLabel",
             detection_confidence AS "detectionConfidence",
             image_url AS "imageUrl"
      FROM incident_evidence WHERE incident_id = ${id}`;

    return reply.send({
      incident: incident[0],
      peak: peak[0] ? { ...peak[0], series: series.map((s) => s.value) } : null,
      evidence: evidence[0] ?? null,
    });
  });

  app.patch("/:id", { preHandler: [requireAuth, requireRole("ADMIN", "FARM_MANAGER")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = patchBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });

    const before = await app.sqlRead`
      SELECT status, resolution, ended_at FROM incidents WHERE id = ${id}`;
    if (before.count === 0) return reply.code(404).send({ error: "not_found" });

    const patch = parsed.data;
    await app.sqlWrite`
      UPDATE incidents
      SET status = COALESCE(${patch.status ?? null}, status),
          resolution = COALESCE(${patch.resolution ?? null}, resolution),
          ended_at = COALESCE(${patch.endedAt ?? null}::timestamptz, ended_at),
          updated_at = now()
      WHERE id = ${id}`;

    await app.sqlWrite`
      INSERT INTO audit_log (user_id, action, resource_type, resource_id, before_value, after_value)
      VALUES (
        ${request.authUser!.sub}, ${"incident.update"}, ${"incident"}, ${id},
        ${app.sqlWrite.json(before[0]!)}, ${app.sqlWrite.json(patch)}
      )`;

    return reply.send({ updated: true, id });
  });
}
