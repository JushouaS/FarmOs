import type { FastifyInstance } from "fastify";
import { env } from "./config.js";
import { readLighting, type Lighting } from "./lighting.js";
import { raiseAlert } from "./notify.js";

/**
 * The live behavior monitor: turns what the camera's detector sees into alerts.
 *
 * The camera service (cerebroil-stream) follows the birds on the live camera and
 * works out which ones are inactive or huddling (live_behavior.py). Every
 * BEHAVIOR_POLL_SECONDS this asks it for the current picture and raises an alert
 * for each problem, which raiseAlert() then sends to people by their Settings:
 *
 *   Inactive Bird      birds that have not moved for a long time while the rest of the flock moves (by day)
 *   Flock Inactivity   most of the flock still for a long time (by day)
 *   Huddling Detected  a large share of the birds huddled together for a long time
 *
 * At night, still birds are sleeping, so no inactivity alert is raised then.
 * The same kind is not raised again for COOLDOWN_MINUTES, even if the last one was
 * acknowledged and the problem is still there.
 */

const COOLDOWN_MINUTES = 60;

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

/** True when `now` (this computer's local time) is in the lights-off hours. */
export function isNight(now: Date, lighting: Lighting): boolean {
  const minute = now.getHours() * 60 + now.getMinutes();
  const dayStart = toMinutes(lighting.dayStart);
  const nightStart = toMinutes(lighting.nightStart);
  const day = dayStart < nightStart ? minute >= dayStart && minute < nightStart : minute >= dayStart || minute < nightStart;
  return !day;
}

/** What the camera service reports at /behavior/status. */
export interface BehaviorStatus {
  running: boolean;
  /** Seconds since the camera service last looked at a frame. */
  age_seconds: number | null;
  birds: number;
  night: boolean;
  /** Birds still for longer than the inactive time while the flock moves (by day). */
  inactive: { id: number; still_seconds: number }[];
  /** Most of the flock still for longer than the inactive time (by day). */
  flock_inactive: { still_seconds: number } | null;
  huddle: { birds: number; fdi: number; seconds: number; warning: boolean } | null;
}

const minutesOf = (seconds: number): number => Math.max(1, Math.round(seconds / 60));

/** Turns one status report into alerts. Exported so it can be tested without the camera. */
export async function applyStatus(
  app: FastifyInstance,
  status: BehaviorStatus,
  lastRaised: Map<string, number>,
  now = Date.now(),
): Promise<string[]> {
  const raised: string[] = [];
  const raise = async (kind: string, message: string) => {
    const last = lastRaised.get(kind) ?? 0;
    if (now - last < COOLDOWN_MINUTES * 60_000) return;
    const made = await raiseAlert(app, { kind, severity: "warning", message, dedupeMinutes: COOLDOWN_MINUTES });
    lastRaised.set(kind, now);
    if (made) raised.push(kind);
  };

  if (!status.night) {
    if (status.inactive.length > 0) {
      const longest = Math.max(...status.inactive.map((b) => b.still_seconds));
      await raise(
        "Inactive Bird",
        `Inactive birds: ${status.inactive.length}. They have not moved for ${minutesOf(longest)} minutes while the rest of the flock is active.`,
      );
    }
    if (status.flock_inactive) {
      await raise(
        "Flock Inactivity",
        `Most of the flock has been still for ${minutesOf(status.flock_inactive.still_seconds)} minutes during the day. Check the temperature, lights and water.`,
      );
    }
  }
  if (status.huddle?.warning) {
    await raise(
      "Huddling Detected",
      `Huddling: ${Math.round(status.huddle.fdi * 100)}% of the birds (${status.huddle.birds}) have stayed together for ${minutesOf(status.huddle.seconds)} minutes. Check the temperature.`,
    );
  }
  return raised;
}

export function startBehaviorMonitor(app: FastifyInstance): void {
  if (env.BEHAVIOR_MONITOR === "off") return;
  const lastRaised = new Map<string, number>();
  let warned = false;

  const tick = async () => {
    const night = isNight(new Date(), await readLighting(app));
    let status: BehaviorStatus;
    try {
      const res = await fetch(`${env.VISION_SERVICE_URL}/behavior/status?night=${night ? 1 : 0}`, {
        headers: { "X-Vision-Token": env.VISION_SERVICE_TOKEN },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      status = (await res.json()) as BehaviorStatus;
    } catch (err) {
      // The camera service being off or older is normal; say so once, not every half minute.
      if (!warned) {
        app.log.info({ err: err instanceof Error ? err.message : err }, "behavior monitor: camera service not answering");
        warned = true;
      }
      return;
    }
    warned = false;
    if (!status.running) return;
    const raised = await applyStatus(app, status, lastRaised);
    if (raised.length > 0) app.log.info({ raised }, "behavior monitor: alerts raised");
  };

  const timer = setInterval(() => void tick().catch((err) => app.log.error({ err }, "behavior monitor failed")), env.BEHAVIOR_POLL_SECONDS * 1000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
  app.log.info({ everySeconds: env.BEHAVIOR_POLL_SECONDS }, "behavior monitor started");
}
