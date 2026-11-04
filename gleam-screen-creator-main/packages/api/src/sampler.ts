import type { FastifyInstance } from "fastify";
import { env } from "./config.js";
import { VisionError, analyseAndPersist } from "./vision-pipeline.js";

/**
 * Periodic behaviour sampling.
 *
 * Sits in the API rather than in the vision service on purpose. The vision
 * service measures and stops there; the thresholds, the night rule and the
 * database write all live on this side. A timer in Flask would have to post its
 * numbers back over HTTP with its own credential and its own second copy of the
 * policies — two places to drift apart. Here the timer calls exactly the path a
 * manual scan does.
 *
 * Interval is BEHAVIOR_INTERVAL_MINUTES; 0 disables it for a deployment that
 * would rather only analyse on request.
 */

/** Let the database, migrations and camera connections settle before the first pass. */
const STARTUP_DELAY_MS = 20_000;

export function startBehaviorSampler(app: FastifyInstance): void {
  const minutes = env.BEHAVIOR_INTERVAL_MINUTES;

  if (!Number.isFinite(minutes) || minutes <= 0) {
    app.log.info("Behaviour sampler disabled (BEHAVIOR_INTERVAL_MINUTES=0)");
    return;
  }

  let running = false;
  // Cameras with no RTSP source configured in the vision service answer 404.
  // That is a setup gap, not a fault, so it is reported once instead of every
  // interval for the life of the process.
  const reportedMissing = new Set<string>();

  const tick = async () => {
    if (running) {
      // A slow camera must not let work queue up behind it.
      return;
    }
    running = true;
    try {
      const cameras = await app.sqlRead`SELECT id FROM cameras ORDER BY id`;
      for (const row of cameras) {
        const cameraId = String(row.id);
        try {
          const { behaviour } = await analyseAndPersist(app, cameraId);
          app.log.debug(
            {
              cameraId,
              birdCount: behaviour.bird_count,
              inactive: behaviour.inactive_count,
              label: behaviour.movement_label,
              huddling: behaviour.huddling_label,
              night: behaviour.night,
              reason: behaviour.reason,
            },
            "behaviour sample",
          );
        } catch (err) {
          if (err instanceof VisionError && err.status === 404) {
            if (!reportedMissing.has(cameraId)) {
              reportedMissing.add(cameraId);
              app.log.info(
                { cameraId },
                "camera has no RTSP source in the vision service; skipping its samples",
              );
            }
            continue;
          }
          // One bad sample is not an outage; log and wait for the next tick.
          app.log.warn({ err, cameraId }, "behaviour sample failed");
        }
      }
    } catch (err) {
      app.log.warn({ err }, "behaviour sampler could not list cameras");
    } finally {
      running = false;
    }
  };

  const interval = setInterval(tick, minutes * 60_000);
  // Do not hold the process open on account of the timer alone.
  interval.unref?.();

  const first = setTimeout(tick, STARTUP_DELAY_MS);
  first.unref?.();

  app.addHook("onClose", async () => {
    clearInterval(interval);
    clearTimeout(first);
  });

  app.log.info({ minutes }, "Behaviour sampler started");
}
