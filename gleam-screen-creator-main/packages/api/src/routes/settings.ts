import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { looksLikeRtsp, publicCameraSource, readCameraSource } from "../camera-source.js";
import {
  CYCLE_DEFAULT_START_DAY,
  CYCLE_END_DAY,
  currentDay,
  databaseToday,
  readCycleSetting,
} from "../cycle-day.js";
import { HHMM, readLighting } from "../lighting.js";

/**
 * GET /settings/cycle          the day the flock is on: the start day, the date it
 *                              started on, today's day and the last day of the grow-out.
 * PUT /settings/cycle          set the start day. The flock is on that day today and
 *                              counts up from there, so every page that shows the day follows it.
 * GET /settings/lighting       when the day starts and when the night starts.
 * PUT /settings/lighting       change them.
 * PUT /settings/flock          the number of birds in each house.
 * GET /settings/camera         the RTSP link the camera services open, without its password.
 * PUT /settings/camera         replace that link, or clear it and fall back to .env.
 *
 * Every PUT is for ADMIN and FARM_MANAGER.
 */
const manage = [requireAuth, requireRole("ADMIN", "FARM_MANAGER")];

const cycleBody = z.object({
  startDay: z.coerce.number().int().min(CYCLE_DEFAULT_START_DAY).max(CYCLE_END_DAY),
});

const lightingBody = z
  .object({ dayStart: z.string().regex(HHMM), nightStart: z.string().regex(HHMM) })
  .refine((b) => b.dayStart !== b.nightStart, { message: "same_time" });

const flockBody = z.object({
  houses: z
    .array(z.object({ id: z.string().min(1), population: z.number().int().min(1).max(1000) }))
    .min(1)
    .max(50),
});

// An empty string is a real instruction — "forget this and use .env" — so it is
// allowed here and the link is checked separately, by looksLikeRtsp.
const cameraBody = z.object({ rtspUrl: z.string().max(2048) });

export async function registerSettingsRoutes(app: FastifyInstance) {
  const describeCycle = async () => {
    const today = await databaseToday(app);
    const setting = await readCycleSetting(app, today);
    return {
      ...setting,
      day: currentDay(setting, today),
      endDay: CYCLE_END_DAY,
      minStartDay: CYCLE_DEFAULT_START_DAY,
      defaultStartDay: CYCLE_DEFAULT_START_DAY,
    };
  };

  app.get("/cycle", { preHandler: [requireAuth] }, async (_request, reply) => reply.send(await describeCycle()));

  app.put("/cycle", { preHandler: manage }, async (request, reply) => {
    const parsed = cycleBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_start_day",
        message: `The start day must be a whole number from ${CYCLE_DEFAULT_START_DAY} to ${CYCLE_END_DAY}.`,
      });
    }
    const today = await databaseToday(app);
    const value = { startDay: parsed.data.startDay, startedOn: today };
    await app.sqlWrite`
      INSERT INTO system_settings (key, value, updated_by)
      VALUES ('cycle', ${app.sqlWrite.json(value)}, ${request.authUser!.sub})
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by`;
    return reply.send(await describeCycle());
  });

  /* ---- lighting ------------------------------------------------------- */

  app.get("/lighting", { preHandler: [requireAuth] }, async (_request, reply) => reply.send(await readLighting(app)));

  app.put("/lighting", { preHandler: manage }, async (request, reply) => {
    const parsed = lightingBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_lighting",
        message: "Give the day start and the night start as times (HH:MM), and make them different.",
      });
    }
    const value = { dayStart: parsed.data.dayStart, nightStart: parsed.data.nightStart };
    await app.sqlWrite`
      INSERT INTO system_settings (key, value, updated_by)
      VALUES ('lighting', ${app.sqlWrite.json(value)}, ${request.authUser!.sub})
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by`;
    return reply.send(await readLighting(app));
  });

  /* ---- camera --------------------------------------------------------- */

  app.get("/camera", { preHandler: [requireAuth] }, async (_request, reply) =>
    reply.send(publicCameraSource(await readCameraSource(app))),
  );

  app.put("/camera", { preHandler: manage }, async (request, reply) => {
    const parsed = cameraBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_camera_url",
        message: "Paste the camera's own link, for example rtsp://user:password@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0.",
      });
    }
    const rtspUrl = parsed.data.rtspUrl.trim();
    if (rtspUrl && !looksLikeRtsp(rtspUrl)) {
      return reply.code(400).send({
        error: "invalid_camera_url",
        message:
          "That is not a link the camera services can open. It has to start with rtsp:// (or rtsps://, http://, https://) and have no spaces in it.",
      });
    }

    if (!rtspUrl) {
      // Clearing the setting is a delete, not an empty value: the camera
      // services then go back to the link in .env, which is where they started.
      await app.sqlWrite`DELETE FROM system_settings WHERE key = 'camera'`;
    } else {
      const value = { rtspUrl };
      await app.sqlWrite`
        INSERT INTO system_settings (key, value, updated_by)
        VALUES ('camera', ${app.sqlWrite.json(value)}, ${request.authUser!.sub})
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = now(),
          updated_by = EXCLUDED.updated_by`;
    }
    return reply.send(publicCameraSource(await readCameraSource(app)));
  });

  /* ---- flock size ----------------------------------------------------- */

  app.put("/flock", { preHandler: manage }, async (request, reply) => {
    const parsed = flockBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_flock",
        message: "The number of broiler chickens must be a whole number from 1 to 1,000.",
      });
    }
    const known = await app.sqlRead`SELECT id FROM houses WHERE is_active = true`;
    const ids = new Set(known.map((h) => String(h.id)));
    if (parsed.data.houses.some((h) => !ids.has(h.id))) {
      return reply.code(400).send({ error: "unknown_house", message: "One of those houses does not exist." });
    }
    await app.sqlWrite.begin(async (tx) => {
      for (const h of parsed.data.houses) {
        await tx`UPDATE houses SET population = ${h.population}, updated_at = now() WHERE id = ${h.id}`;
      }
    });
    const rows = await app.sqlRead`
      SELECT id, label, section, population FROM houses WHERE is_active = true ORDER BY sort_order`;
    return reply.send({ houses: rows });
  });
}
