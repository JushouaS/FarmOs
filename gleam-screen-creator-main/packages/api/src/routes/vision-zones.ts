import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config.js";
import { requireAuth, requireRole } from "../auth/middleware.js";

/**
 * Feeder and drinker zones, drawn by hand over the camera picture.
 *
 * Why these exist: birds crowd at a feeder. Without knowing where the feeders
 * are, that crowd is indistinguishable from a huddle, and a system that cries
 * huddling every feeding time gets switched off within a week. The operator
 * draws the troughs once; birds inside them stop counting towards huddling
 * (they still count towards inactivity).
 *
 * Coordinates are normalised to 0..1 of the frame, never pixels. A camera that
 * reconnects at a different resolution would otherwise invalidate every zone
 * silently — the worst kind of failure, because the drawing still looks right.
 *
 * Saving replaces the camera's whole set. Partial updates would need zone ids
 * to survive across edits, and a stale id quietly leaving an orphan polygon
 * behind is a bug nobody would notice until the numbers stopped making sense.
 */

const point = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

const zoneInput = z.object({
  kind: z.enum(["feeder", "drinker"]).default("feeder"),
  label: z.string().trim().min(1).max(60),
  polygon: z.array(point).min(3).max(64),
  enabled: z.boolean().default(true),
});

const putBody = z.object({
  zones: z.array(zoneInput).max(40),
});

/** Shoelace area of a normalised polygon, as a share of the frame. */
function polygonArea(polygon: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i]!;
    const [x2, y2] = polygon[(i + 1) % polygon.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Above this share of the frame, the drawing is almost certainly wrong. */
const COVERAGE_WARNING = 0.6;

async function loadZones(app: FastifyInstance, cameraId: string) {
  const rows = await app.sqlRead`
    SELECT id, kind, label, polygon, enabled, updated_at
    FROM camera_zones
    WHERE camera_id = ${cameraId}
    ORDER BY created_at`;
  return rows.map((r: any) => ({
    id: r.id,
    kind: r.kind,
    label: r.label,
    polygon: r.polygon,
    enabled: Boolean(r.enabled),
    updated_at: r.updated_at,
  }));
}

/**
 * Tell the vision service to drop its copy of the zones.
 *
 * It caches them for 30 seconds because it runs its own loop and cannot be
 * handed them per request. Without this nudge an operator would redraw a zone,
 * scan immediately, see no change, and redraw it again. Best effort: a failed
 * nudge only costs half a minute of staleness.
 */
async function refreshVisionCache(cameraId: string): Promise<void> {
  try {
    await fetch(`${env.VISION_SERVICE_URL}/zones/refresh`, {
      method: "POST",
      headers: {
        "X-Vision-Token": env.VISION_SERVICE_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ camera_id: cameraId }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // Unreachable camera service is not a reason to fail the save.
  }
}

export async function registerVisionZoneRoutes(app: FastifyInstance) {
  // GET /visual/zones/:cameraId
  app.get("/zones/:cameraId", { preHandler: [requireAuth] }, async (request, reply) => {
    const { cameraId } = request.params as { cameraId: string };
    const zones = await loadZones(app, cameraId);
    return reply.send({
      camera_id: cameraId,
      zones,
      coverage: Math.round(zones.reduce((sum, z) => sum + polygonArea(z.polygon), 0) * 1000) / 1000,
    });
  });

  // PUT /visual/zones/:cameraId — replace this camera's zones
  app.put(
    "/zones/:cameraId",
    { preHandler: [requireAuth, requireRole("ADMIN", "FARM_MANAGER")] },
    async (request, reply) => {
      const { cameraId } = request.params as { cameraId: string };
      const parsed = putBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_body",
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      const { zones } = parsed.data;

      const camera = await app.sqlRead`SELECT id FROM cameras WHERE id = ${cameraId}`;
      if (camera.count === 0) return reply.code(404).send({ error: "unknown_camera" });

      // A three-point polygon with no area (three clicks on the same line)
      // would silently never match a bird, so reject it now rather than let
      // the operator wonder why exclusion does nothing.
      const degenerate = zones.find((zone) => polygonArea(zone.polygon) < 0.001);
      if (degenerate) {
        return reply.code(400).send({ error: "degenerate_polygon", label: degenerate.label });
      }

      const userId = request.authUser?.sub ?? null;

      await app.sqlWrite.begin(async (sql) => {
        await sql`DELETE FROM camera_zones WHERE camera_id = ${cameraId}`;
        for (const zone of zones) {
          await sql`
            INSERT INTO camera_zones (camera_id, kind, label, polygon, enabled, created_by)
            VALUES (
              ${cameraId}, ${zone.kind}, ${zone.label},
              ${sql.json(zone.polygon)},
              ${zone.enabled}, ${userId}
            )`;
        }
      });

      await refreshVisionCache(cameraId);

      const saved = await loadZones(app, cameraId);
      const coverage =
        Math.round(saved.reduce((sum, z) => sum + polygonArea(z.polygon), 0) * 1000) / 1000;

      return reply.send({
        camera_id: cameraId,
        zones: saved,
        coverage,
        warning: coverage > COVERAGE_WARNING ? "zones_cover_most_of_the_frame" : null,
      });
    },
  );
}
