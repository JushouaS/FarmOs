import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";

/**
 * User notifications + delivery preferences.
 *
 * GET    /notifications            — unread-first feed for the caller
 * PATCH  /notifications/:id/read   — mark a notification read
 * GET    /notifications/preferences         — delivery preferences
 * PUT    /notifications/preferences         — upsert delivery preferences
 */

const prefsBody = z.array(
  z.object({
    channel: z.enum(["in_app", "email", "push", "sms"]),
    enabled: z.boolean(),
    minSeverity: z.enum(["optimal", "nominal", "deviation", "warning", "critical"]).default("deviation"),
    quietHoursStart: z.string().optional(),
    quietHoursEnd: z.string().optional(),
  }),
);

export async function registerNotificationRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.sub;
    const rows = await app.sqlRead`
      SELECT id, title, body, channel, kind, severity,
             related_id AS "relatedId",
             read_at::text AS "readAt",
             delivered_at::text AS "deliveredAt",
             created_at::text AS "createdAt"
      FROM notifications
      WHERE user_id = ${userId}
      ORDER BY read_at IS NOT NULL, created_at DESC
      LIMIT 100`;
    return reply.send(rows);
  });

  app.patch("/:id/read", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.authUser!.sub;
    const updated = await app.sqlWrite`
      UPDATE notifications SET read_at = now()
      WHERE id = ${id}::uuid AND user_id = ${userId} AND read_at IS NULL
      RETURNING id`;
    if (updated.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.send({ updated: true, id });
  });

  app.get("/preferences", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.sub;
    const rows = await app.sqlRead`
      SELECT channel, enabled, min_severity AS "minSeverity",
             quiet_hours_start AS "quietHoursStart",
             quiet_hours_end AS "quietHoursEnd"
      FROM notification_preferences WHERE user_id = ${userId}`;
    return reply.send(rows);
  });

  app.put("/preferences", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = prefsBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    const userId = request.authUser!.sub;

    await app.sqlWrite`DELETE FROM notification_preferences WHERE user_id = ${userId}`;
    if (parsed.data.length > 0) {
      const rows = parsed.data.map((p) => ({
        user_id: userId,
        channel: p.channel,
        enabled: p.enabled,
        min_severity: p.minSeverity,
        quiet_hours_start: p.quietHoursStart ?? null,
        quiet_hours_end: p.quietHoursEnd ?? null,
      }));
      await app.sqlWrite`
        INSERT INTO notification_preferences
          (user_id, channel, enabled, min_severity, quiet_hours_start, quiet_hours_end)
        SELECT * FROM jsonb_to_recordset(${app.sqlWrite.json(rows)})
          AS x(user_id uuid, channel text, enabled bool, min_severity text,
               quiet_hours_start time, quiet_hours_end time)`;
    }
    return reply.send({ updated: true, count: parsed.data.length });
  });
}
