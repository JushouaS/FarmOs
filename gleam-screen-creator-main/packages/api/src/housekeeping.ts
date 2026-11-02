import type { FastifyInstance } from "fastify";

/**
 * Clears out what is no longer needed: sessions whose 30 days have passed (they are otherwise only
 * removed when someone tries to use them) and old records of wrong passwords. Runs once at start-up
 * and then every hour.
 */
export function startHousekeeping(app: FastifyInstance): void {
  const sweep = async () => {
    try {
      const sessions = await app.sqlWrite`DELETE FROM sessions WHERE refresh_expires_at < now()`;
      const failures = await app.sqlWrite`DELETE FROM login_failures WHERE failed_at < now() - interval '2 days'`;
      if (sessions.count > 0 || failures.count > 0) {
        app.log.info({ sessions: sessions.count, loginFailures: failures.count }, "housekeeping: old rows removed");
      }
    } catch (err) {
      app.log.warn({ err }, "housekeeping failed; it will try again in an hour");
    }
  };
  void sweep();
  const timer = setInterval(() => void sweep(), 60 * 60 * 1000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
}
