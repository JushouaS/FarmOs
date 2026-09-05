import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/middleware.js";

/**
 * GET /visual/telemetry — live feed metadata, detections, behaviour metrics,
 * and the 24h anomaly timeline for the primary camera.
 */
export async function registerVisualRoutes(app: FastifyInstance) {
  app.get("/telemetry", { preHandler: [requireAuth] }, async (request, reply) => {
    const camera = await app.sqlRead`
      SELECT c.id, c.house_id AS "houseId", h.label AS "houseLabel",
             c.mount_x AS "mountX", c.mount_y AS "mountY",
             c.fps, c.resolution, c.depth_points_per_frame AS "depthPointsPerFrame",
             c.plan_view_label AS "planViewLabel", c.still_url AS "stillUrl", c.online
      FROM cameras c
      JOIN houses h ON h.id = c.house_id
      WHERE c.online = true
      ORDER BY c.id
      LIMIT 1`;
    if (camera.count === 0) return reply.code(404).send({ error: "no_online_camera" });
    const cam = camera[0]!;

    const detections = await app.sqlRead`
      SELECT id, box_x AS "boxX", box_y AS "boxY", box_w AS "boxW", box_h AS "boxH",
             behavior, estimated_weight_g AS "estimatedWeightG",
             weight_confidence AS "weightConfidence", flag
      FROM detections
      WHERE camera_id = ${cam.id}
      ORDER BY frame_at DESC
      LIMIT 50`;

    const latestWarning = await app.sqlRead`
      SELECT id, label, risk, box, raised_at AS "raisedAt"
      FROM cluster_warnings
      WHERE camera_id = ${cam.id}
      ORDER BY raised_at DESC
      LIMIT 1`;

    const behavior = await app.sqlRead`
      SELECT movement_index AS "movementIndex", movement_label AS "movementLabel",
             movement_status AS "movementStatus",
             huddling_risk AS "huddlingRisk", huddling_label AS "huddlingLabel",
             huddling_status AS "huddlingStatus",
             aggression_events AS "aggressionEvents"
      FROM behavior_snapshots
      WHERE camera_id = ${cam.id}
      ORDER BY at DESC
      LIMIT 1`;

    const hud = await app.sqlRead`
      SELECT s.code AS parameter, r.value, r.unit, r.status
      FROM sensor_readings r
      JOIN sensors s ON s.id = r.sensor_id
      WHERE s.house_id = ${cam.houseId}
        AND s.sensor_type_code IN ('temperature', 'humidity')
        AND r.recorded_at = (
          SELECT MAX(rr.recorded_at)
          FROM sensor_readings rr WHERE rr.sensor_id = s.id
        )
      ORDER BY s.sensor_type_code`;

    const timeline = await app.sqlRead`
      SELECT id, at::text AS at, severity, label
      FROM anomaly_events
      WHERE facility_id = (SELECT facility_id FROM houses WHERE id = ${cam.houseId} LIMIT 1)
        AND at >= (now() - interval '24 hours')
      ORDER BY at ASC`;

    return reply.send({
      camera: cam,
      detections,
      clusterWarning: latestWarning[0] ?? null,
      behavior: behavior[0] ?? null,
      hud,
      timeline,
    });
  });
}
