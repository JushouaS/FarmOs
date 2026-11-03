import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { emailConfigured, loadPrefs, notifyUser, pushConfigured } from "../notify.js";
import { env } from "../config.js";

/**
 * User notifications + delivery preferences.
 *
 * GET    /notifications            — unread-first feed for the caller (in-app notices)
 * GET    /notifications/channels   — which delivery channels are set up on this server
 * POST   /notifications/test       — send the caller a test notice by the channels they turned on
 * GET    /notifications/push/key, POST /notifications/push/subscribe|unsubscribe — browser push
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
      WHERE user_id = ${userId} AND channel = 'in_app'
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

  // Which channels this server can send on. The Settings card shows it, so it never promises a channel that is not set up.
  app.get("/channels", { preHandler: [requireAuth] }, async (_request, reply) => {
    return reply.send({ email: { configured: emailConfigured() }, push: { configured: pushConfigured() } });
  });

  // "Send a test": a notice to the caller only, by the channels they switched on (level and quiet hours ignored).
  app.post(
    "/test",
    { preHandler: [requireAuth], config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const userId = request.authUser!.sub;
      const users = await app.sqlRead`
        SELECT id, email::text AS email, full_name AS "fullName" FROM users WHERE id = ${userId}`;
      if (users.length === 0) return reply.code(404).send({ error: "not_found" });
      const prefs = (await loadPrefs(app, userId)).get(userId) ?? [];
      const result = await notifyUser(
        app,
        users[0] as unknown as { id: string; email: string; fullName: string | null },
        {
          title: "Test notification",
          body: "This is a test from Cerebroil. If you can read it, this channel works.",
          kind: "TEST",
          severity: "warning",
        },
        prefs,
        { force: true },
      );
      return reply.send(result);
    },
  );

  // ---- browser push -------------------------------------------------------
  app.get("/push/key", { preHandler: [requireAuth] }, async (_request, reply) => {
    return reply.send({ publicKey: pushConfigured() ? env.VAPID_PUBLIC_KEY : null });
  });

  const subscribeBody = z.object({
    endpoint: z.string().url().max(2000),
    keys: z.object({ p256dh: z.string().min(10).max(400), auth: z.string().min(10).max(200) }),
  });

  app.post("/push/subscribe", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = subscribeBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const userId = request.authUser!.sub;
    const agent = String(request.headers["user-agent"] ?? "").slice(0, 200);
    // The same browser may subscribe again (after a new login); it moves to this person.
    await app.sqlWrite`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
      VALUES (${userId}, ${parsed.data.endpoint}, ${parsed.data.keys.p256dh}, ${parsed.data.keys.auth}, ${agent})
      ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`;
    return reply.send({ subscribed: true });
  });

  app.post("/push/unsubscribe", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = z.object({ endpoint: z.string().url().max(2000) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    await app.sqlWrite`
      DELETE FROM push_subscriptions WHERE endpoint = ${parsed.data.endpoint} AND user_id = ${request.authUser!.sub}`;
    return reply.send({ subscribed: false });
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

    // H-3: wrap delete + insert in a transaction so a crash between the two
    // writes never leaves the user with no preferences at all.
    await app.sqlWrite.begin(async (tx) => {
      await tx`DELETE FROM notification_preferences WHERE user_id = ${userId}`;
      if (parsed.data.length > 0) {
        const rows = parsed.data.map((p) => ({
          user_id: userId,
          channel: p.channel,
          enabled: p.enabled,
          min_severity: p.minSeverity,
          quiet_hours_start: p.quietHoursStart ?? null,
          quiet_hours_end: p.quietHoursEnd ?? null,
        }));
        await tx`
          INSERT INTO notification_preferences
            (user_id, channel, enabled, min_severity, quiet_hours_start, quiet_hours_end)
          SELECT * FROM jsonb_to_recordset(${tx.json(rows)})
            AS x(user_id uuid, channel text, enabled bool, min_severity text,
                 quiet_hours_start time, quiet_hours_end time)`;
      }
    });

    return reply.send({ updated: true, count: parsed.data.length });
  });
}
