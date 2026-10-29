import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import {
  CYCLE_DEFAULT_START_DAY,
  CYCLE_END_DAY,
  currentDay,
  databaseToday,
  readCycleSetting,
} from "../cycle-day.js";

/**
 * GET /settings/cycle  — the day the flock is on: the start day, the date it
 *                        started on, today's day and the last day of the grow-out.
 * PUT /settings/cycle  — set the start day (ADMIN / FARM_MANAGER). The flock is
 *                        on that day today and counts up from there, so every
 *                        page that shows the day follows it.
 */
const cycleBody = z.object({
  startDay: z.coerce.number().int().min(CYCLE_DEFAULT_START_DAY).max(CYCLE_END_DAY),
});

export async function registerSettingsRoutes(app: FastifyInstance) {
  const describe = async () => {
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

  app.get("/cycle", { preHandler: [requireAuth] }, async (_request, reply) => reply.send(await describe()));

  app.put("/cycle", { preHandler: [requireAuth, requireRole("ADMIN", "FARM_MANAGER")] }, async (request, reply) => {
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
    return reply.send(await describe());
  });
}
