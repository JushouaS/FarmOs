import type { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply } from "fastify";
import { env } from "../config.js";
import { requireAuth } from "../auth/middleware.js";
import {
  classify,
  sustainedFlags,
  type BehaviorVerdict,
  type VisionMetrics,
  type WindowSample,
} from "../behavior.js";
import { visionHeaders } from "../vision-pipeline.js";

/**
 * Clip testing — the behaviour analysis, run against a recording.
 *
 * Why this exists: the camera is not always available, and a model that has
 * just been swapped in should not have to wait for the flock to do something
 * interesting before anyone knows whether it works. Upload a clip, get numbers
 * from the same pipeline the live camera feeds.
 *
 * Two rules make the test worth trusting:
 *
 * 1. It is judged by the same policy. Every sample is mapped through
 *    `classify` and the clip as a whole through `sustainedFlags`, so a clip
 *    that would have raised something live raises it here too.
 * 2. It writes nothing. A recording is not a reading; putting its timestamps
 *    into `behavior_snapshots` would hand the trend a history the flock never
 *    lived, and the sampler would then be reading fiction.
 *
 * The upload body *is* the file — no multipart parser, no buffering. Fastify
 * hands the raw stream over and undici streams it straight to the vision
 * service, which writes it to disk under its own size cap.
 */

const VISION_BASE = env.VIDEO_SERVICE_URL ?? env.VISION_SERVICE_URL;
const MAX_BYTES = env.VIDEO_MAX_MB * 1024 * 1024;

/** A 200 MB clip over farm wifi is not quick, but it does not get forever. */
const UPLOAD_TIMEOUT_MS = 60 * 60_000; // a 2.5 GB clip over an ordinary connection takes a long time to arrive
const READ_TIMEOUT_MS = 30_000;
/** A sweep analyses up to 30 samples, each an open + detect + measure. */
const SWEEP_TIMEOUT_MS = 3 * 60_000;

/** What the vision service reports about a stored clip. */
interface VisionClip {
  id: string;
  name: string;
  duration_s: number;
  fps: number;
  width: number;
  height: number;
  bytes: number;
  max_samples: number;
}

interface VisionSample {
  t: number;
  metrics: VisionMetrics | null;
  warnings: string[];
}

export interface VideoSampleReading {
  t: number;
  behavior: BehaviorVerdict;
  warnings: string[];
}

/**
 * The clip's headline. A code, not a sentence: the wording belongs with the
 * translations, and the rule that picked the code belongs with the thresholds.
 */
export type VideoConclusion =
  | "no_samples"
  | "model_unavailable"
  | "nothing_usable"
  | "both_sustained"
  | "inactivity_sustained"
  | "huddling_sustained"
  | "inactivity_seen"
  | "huddling_seen"
  | "nothing_alarming";

/** The upload's name, kept to something safe to store and show. */
function clipName(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !value) return "clip.mp4";
  let decoded = value;
  try {
    // The browser percent-encodes it: a header cannot carry non-Latin-1, and
    // "aso't manok (final).mp4" should not arrive mangled.
    decoded = decodeURIComponent(value);
  } catch {
    // Not encoded after all — use it as it came.
  }
  const base = decoded.split(/[\\/]/).pop()?.trim().slice(0, 120) ?? "";
  if (!base) return "clip.mp4";
  return base.includes(".") ? base : `${base}.mp4`;
}

/** Pass the vision service's own refusal through, code and status intact. */
async function forwardError(reply: FastifyReply, res: Response) {
  const text = (await res.text().catch(() => "")).slice(0, 500);
  let body: unknown = { error: "vision_error", detail: text };
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON; the truncated text is the most useful thing we have.
  }
  return reply.code(res.status).send(body);
}

export async function registerVisionVideoRoutes(app: FastifyInstance) {
  // The clip arrives as a video body, not as form fields. Handing the raw
  // stream to the handler is what keeps a 200 MB upload off the heap.
  //
  // A regex rather than a list of media types on purpose: a file picker labels
  // .avi as video/x-msvideo, video/avi or video/msvideo depending on the
  // browser, and a list that misses one rejects the upload before the handler
  // ever sees it. Every video type is the same thing here — bytes to forward.
  app.addContentTypeParser(
    // Matching a prefix, not the whole header: a browser may append a charset
    // parameter, and that must not turn a valid upload into a 415.
    /^(video\/|application\/octet-stream)/,
    (_request, payload, done) => done(null, payload),
  );

  // An empty body advertised as JSON is an empty object here.
  //
  // None of these routes reads a body — the clip id is in the path and the
  // moment is in the query — but a client that always labels its POSTs
  // `application/json` (the dashboard used to) sends nothing with them, and
  // Fastify refuses that before the handler runs. "Nothing to read" is not a
  // client error on a route that reads nothing.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      const text = String(body ?? "").trim();
      if (!text) return done(null, {});
      try {
        done(null, JSON.parse(text));
      } catch {
        const err = new Error("Invalid JSON body") as Error & {
          statusCode?: number;
          code?: string;
        };
        err.statusCode = 400;
        err.code = "FST_ERR_CTP_INVALID_JSON_BODY";
        done(err);
      }
    },
  );

  // POST /visual/video — store a clip for testing
  app.post(
    "/video",
    {
      preHandler: [requireAuth],
      bodyLimit: MAX_BYTES,
      // Both Test clip boxes share this, and a refused or abandoned upload counts too: 6 an hour ran out after a few tries.
      config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const body = request.body as Readable | undefined;
      if (!body || typeof body.pipe !== "function") {
        return reply.code(400).send({
          error: "empty_upload",
          detail: "Send the video file as the request body.",
        });
      }

      const declared = Number(request.headers["content-length"] ?? 0);
      if (Number.isFinite(declared) && declared > MAX_BYTES) {
        return reply.code(413).send({
          error: "too_large",
          detail: `The clip is larger than the ${env.VIDEO_MAX_MB} MB limit.`,
        });
      }

      const init: RequestInit & { duplex?: "half" } = {
        method: "POST",
        headers: {
          ...visionHeaders(),
          "Content-Type": String(request.headers["content-type"] ?? "application/octet-stream"),
          "X-Filename": encodeURIComponent(clipName(request.headers["x-filename"])),
        },
        // A Node stream, which undici accepts even though the DOM's BodyInit
        // type does not say so.
        body: body as unknown as RequestInit["body"],
        // Required by undici before it will stream a request body.
        duplex: "half",
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      };

      let res: Response;
      try {
        res = await fetch(`${VISION_BASE}/video`, init);
      } catch {
        return reply.code(503).send({ error: "vision_service_unavailable" });
      }
      if (!res.ok) return forwardError(reply, res);

      const clip = (await res.json()) as VisionClip;
      app.log.info({ clipId: clip.id, bytes: clip.bytes, duration: clip.duration_s }, "stored test clip");
      return reply.send(clip);
    },
  );

  // GET /visual/video/:clipId — what the clip is
  app.get("/video/:clipId", { preHandler: [requireAuth] }, async (request, reply) => {
    const { clipId } = request.params as { clipId: string };
    try {
      const res = await fetch(`${VISION_BASE}/video/${encodeURIComponent(clipId)}`, {
        headers: visionHeaders(),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      if (!res.ok) return forwardError(reply, res);
      return reply.send(await res.json());
    } catch {
      return reply.code(503).send({ error: "vision_service_unavailable" });
    }
  });

  // DELETE /visual/video/:clipId — forget it now rather than at the TTL
  app.delete("/video/:clipId", { preHandler: [requireAuth] }, async (request, reply) => {
    const { clipId } = request.params as { clipId: string };
    try {
      const res = await fetch(`${VISION_BASE}/video/${encodeURIComponent(clipId)}`, {
        method: "DELETE",
        headers: visionHeaders(),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      if (!res.ok) return forwardError(reply, res);
      return reply.send(await res.json());
    } catch {
      return reply.code(503).send({ error: "vision_service_unavailable" });
    }
  });

  // GET /visual/video/:clipId/frame?t=&annotate= — one frame, as base64 JPEG
  //
  // Base64 rather than raw image bytes, to match how /visual/capture already
  // answers: the dashboard turns it straight into a data URL and there is no
  // object URL to revoke.
  app.get("/video/:clipId/frame", { preHandler: [requireAuth] }, async (request, reply) => {
    const { clipId } = request.params as { clipId: string };
    const query = request.query as { t?: string; annotate?: string };
    const t = Number(query.t ?? 0);
    if (!Number.isFinite(t) || t < 0) return reply.code(400).send({ error: "invalid_time" });
    const annotate = query.annotate === "1" || query.annotate === "true";

    try {
      const res = await fetch(
        `${VISION_BASE}/video/${encodeURIComponent(clipId)}/frame?t=${t}${annotate ? "&annotate=1" : ""}`,
        { headers: visionHeaders(), signal: AbortSignal.timeout(READ_TIMEOUT_MS) },
      );
      if (!res.ok) return forwardError(reply, res);
      const buffer = Buffer.from(await res.arrayBuffer());
      return reply.send({
        t,
        content_type: "image/jpeg",
        size_bytes: buffer.length,
        image: buffer.toString("base64"),
      });
    } catch {
      return reply.code(503).send({ error: "vision_service_unavailable" });
    }
  });

  // POST /visual/video/:clipId/analyze?t= — one measurement, one verdict
  app.post("/video/:clipId/analyze", { preHandler: [requireAuth] }, async (request, reply) => {
    const { clipId } = request.params as { clipId: string };
    const t = Number((request.query as { t?: string }).t ?? 0);
    if (!Number.isFinite(t) || t < 0) return reply.code(400).send({ error: "invalid_time" });

    try {
      const res = await fetch(
        `${VISION_BASE}/video/${encodeURIComponent(clipId)}/analyze?t=${t}`,
        {
          method: "POST",
          headers: { ...visionHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        },
      );
      if (!res.ok) return forwardError(reply, res);

      const body = (await res.json()) as {
        clip: VisionClip;
        t: number;
        zone_camera: string;
        metrics: VisionMetrics;
        warnings?: string[];
        clusters?: unknown[];
        detection_count?: number;
      };
      const warnings = body.warnings ?? [];
      return reply.send({
        ...body,
        behaviour: classify(body.metrics, { night: false, warnings }),
        // A clip has no clock, so the night rule cannot apply to it. Said out
        // loud rather than silently assumed, because "daytime rules" is the
        // one thing about a recording a reader has to know.
        night: false,
      });
    } catch {
      return reply.code(503).send({ error: "vision_service_unavailable" });
    }
  });

  // POST /visual/video/:clipId/sweep — the whole clip, judged as a run
  app.post(
    "/video/:clipId/sweep",
    { preHandler: [requireAuth], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { clipId } = request.params as { clipId: string };
      const requested = Number((request.query as { count?: string }).count ?? env.VIDEO_SWEEP_SAMPLES);
      const count = Number.isFinite(requested) ? Math.max(1, Math.min(Math.round(requested), 120)) : env.VIDEO_SWEEP_SAMPLES;

      try {
        const res = await fetch(
          `${VISION_BASE}/video/${encodeURIComponent(clipId)}/sweep?count=${count}`,
          {
            method: "POST",
            headers: { ...visionHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(SWEEP_TIMEOUT_MS),
          },
        );
        if (!res.ok) return forwardError(reply, res);

        const body = (await res.json()) as {
          clip: VisionClip;
          zone_camera: string;
          sampling: { requested: number; taken: number; truncated: boolean; delta_ms: number };
          samples: VisionSample[];
        };

        const samples: VideoSampleReading[] = body.samples.map((sample) => {
          const warnings = sample.warnings ?? [];
          return {
            t: sample.t,
            warnings,
            behavior: classify(sample.metrics, { night: false, warnings }),
          };
        });

        // The rolling window, applied to the clip as if it were a run of live
        // samples. An unreadable sample is not evidence of a healthy flock, so
        // it is marked suppressed and skipped — the same treatment a night
        // sample gets on the live path.
        const windowRows: WindowSample[] = samples.map((sample) => ({
          movement_status: sample.behavior.movement_status,
          huddling_status: sample.behavior.huddling_status,
          suppressed: sample.behavior.suppressed || !sample.behavior.reliable,
        }));
        const sustained = sustainedFlags(windowRows);
        const usable = samples.filter((s) => s.behavior.reliable && !s.behavior.suppressed);
        const modelLoaded = body.samples.some((s) => s.metrics?.model_loaded === true);

        let conclusion: VideoConclusion;
        if (samples.length === 0) {
          conclusion = "no_samples";
        } else if (usable.length === 0) {
          conclusion = samples.some((s) => s.warnings.includes("model_unavailable"))
            ? "model_unavailable"
            : "nothing_usable";
        } else if (sustained.inactivity && sustained.huddling) {
          conclusion = "both_sustained";
        } else if (sustained.inactivity) {
          conclusion = "inactivity_sustained";
        } else if (sustained.huddling) {
          conclusion = "huddling_sustained";
        } else if (usable.some((s) => s.behavior.movement_status === "warning")) {
          conclusion = "inactivity_seen";
        } else if (usable.some((s) => s.behavior.huddling_status !== "nominal")) {
          conclusion = "huddling_seen";
        } else {
          conclusion = "nothing_alarming";
        }

        app.log.info(
          { clipId, sampled: samples.length, usable: usable.length, conclusion },
          "test clip swept",
        );

        return reply.send({
          clip: body.clip,
          zone_camera: body.zone_camera,
          sampling: body.sampling,
          model_loaded: modelLoaded,
          night: false,
          samples,
          summary: {
            samples: samples.length,
            usable: usable.length,
            sustained,
            conclusion,
          },
        });
      } catch {
        return reply.code(503).send({ error: "vision_service_unavailable" });
      }
    },
  );

  // POST /visual/video/:clipId/bird-weights — per-bird weights from an ordinary colour picture at one moment: the size
  // of each bird's box, calibrated to the flock's average weight given as `mean_g`. A rough guide, not a measurement;
  // like every other clip test it writes nothing.
  app.post(
    "/video/:clipId/bird-weights",
    { preHandler: [requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { clipId } = request.params as { clipId: string };
      const query = request.query as { t?: string; mean_g?: string };
      const t = Number(query.t ?? 0);
      if (!Number.isFinite(t) || t < 0) return reply.code(400).send({ error: "invalid_time" });
      // The scale normally comes from the camera position (the vision service works it out); `mean_g` is only given when it
      // could not, and then calibrates the weights to the flock's average instead.
      let meanQuery = "";
      if (query.mean_g !== undefined && query.mean_g !== "") {
        const meanG = Number(query.mean_g);
        if (!Number.isFinite(meanG)) return reply.code(400).send({ error: "invalid_mean_weight", detail: "Give the flock's average weight in grams." });
        meanQuery = `&mean_g=${meanG}`;
      }

      try {
        const res = await fetch(
          `${VISION_BASE}/video/${encodeURIComponent(clipId)}/bird-weights?t=${t}${meanQuery}`,
          { method: "POST", headers: visionHeaders(), signal: AbortSignal.timeout(READ_TIMEOUT_MS) },
        );
        if (!res.ok) return forwardError(reply, res);
        return reply.send(await res.json());
      } catch {
        return reply.code(503).send({ error: "vision_service_unavailable" });
      }
    },
  );

  // POST /visual/video/:clipId/weights — the 3D weight estimation, run over a
  // recorded Kinect depth clip. The vision service samples frames and runs the
  // same depth-to-mass line the live station uses; this side only forwards the
  // result. Like every other clip test it writes nothing — a recording is not
  // a reading, and its timestamps belong to no grow-out day the flock lived
  // through.
  app.post(
    "/video/:clipId/weights",
    { preHandler: [requireAuth], config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { clipId } = request.params as { clipId: string };
      const requested = Number((request.query as { count?: string }).count ?? 12);
      const count = Number.isFinite(requested) ? Math.max(1, Math.min(Math.round(requested), 60)) : 12;

      try {
        const res = await fetch(
          `${VISION_BASE}/video/${encodeURIComponent(clipId)}/weights?count=${count}`,
          {
            method: "POST",
            headers: { ...visionHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({}),
            // The vision service has its own time budget for a pass; give it
            // the same room a sweep gets rather than cutting it off early.
            signal: AbortSignal.timeout(SWEEP_TIMEOUT_MS),
          },
        );
        if (!res.ok) return forwardError(reply, res);
        return reply.send(await res.json());
      } catch {
        return reply.code(503).send({ error: "vision_service_unavailable" });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Tracked scan: every bird followed through the whole clip (packages/vision/clip_scan.py).
  // It runs in the vision service's background; these routes start it, report
  // progress, stop it and hand back what it found. Like every clip test it
  // writes nothing to the database.
  // ---------------------------------------------------------------------------

  // POST /visual/video/:clipId/track — start. Body (optional): { interval?: seconds, exclude?: ["HH:MM:SS-HH:MM:SS"] }
  app.post(
    "/video/:clipId/track",
    { preHandler: [requireAuth], config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { clipId } = request.params as { clipId: string };
      const body = (request.body ?? {}) as { interval?: unknown; exclude?: unknown };
      const forward: { interval?: number; exclude?: string[] } = {};
      if (body.interval !== undefined && body.interval !== null && body.interval !== "") {
        const interval = Number(body.interval);
        if (!Number.isFinite(interval)) return reply.code(400).send({ error: "invalid_settings", detail: "interval must be a number of seconds" });
        forward.interval = interval;
      }
      if (body.exclude !== undefined) {
        if (!Array.isArray(body.exclude) || body.exclude.length > 50 || !body.exclude.every((x) => typeof x === "string" && x.length <= 40)) {
          return reply.code(400).send({ error: "invalid_exclude", detail: "exclude must be a list of 'HH:MM:SS-HH:MM:SS'" });
        }
        forward.exclude = body.exclude as string[];
      }
      try {
        const res = await fetch(`${VISION_BASE}/video/${encodeURIComponent(clipId)}/track`, {
          method: "POST",
          headers: { ...visionHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(forward),
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        });
        if (!res.ok) return forwardError(reply, res);
        return reply.code(202).send(await res.json());
      } catch {
        return reply.code(503).send({ error: "vision_service_unavailable" });
      }
    },
  );

  // GET /visual/video/:clipId/track?samples=1&from=&limit= — progress and summary, optionally the frames
  app.get("/video/:clipId/track", { preHandler: [requireAuth] }, async (request, reply) => {
    const { clipId } = request.params as { clipId: string };
    const query = request.query as { samples?: string; from?: string; limit?: string };
    const params = new URLSearchParams();
    if (query.samples === "1" || query.samples === "true") {
      params.set("samples", "1");
      const from = Number(query.from ?? 0);
      const limit = Number(query.limit ?? 2000);
      if (!Number.isInteger(from) || from < 0 || !Number.isInteger(limit) || limit < 1) {
        return reply.code(400).send({ error: "invalid_paging" });
      }
      params.set("from", String(from));
      params.set("limit", String(Math.min(limit, 5000)));
    }
    try {
      const res = await fetch(`${VISION_BASE}/video/${encodeURIComponent(clipId)}/track?${params}`, {
        headers: visionHeaders(),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      if (!res.ok) return forwardError(reply, res);
      return reply.send(await res.json());
    } catch {
      return reply.code(503).send({ error: "vision_service_unavailable" });
    }
  });

  // DELETE /visual/video/:clipId/track — stop a running scan (what it found so far is kept)
  app.delete("/video/:clipId/track", { preHandler: [requireAuth] }, async (request, reply) => {
    const { clipId } = request.params as { clipId: string };
    try {
      const res = await fetch(`${VISION_BASE}/video/${encodeURIComponent(clipId)}/track`, {
        method: "DELETE",
        headers: visionHeaders(),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      if (!res.ok) return forwardError(reply, res);
      return reply.send(await res.json());
    } catch {
      return reply.code(503).send({ error: "vision_service_unavailable" });
    }
  });

  // GET /visual/video/:clipId/track.csv?kind=mot — download: per-frame CSV, or MOTChallenge rows for scoring
  app.get("/video/:clipId/track.csv", { preHandler: [requireAuth] }, async (request, reply) => {
    const { clipId } = request.params as { clipId: string };
    const kind = (request.query as { kind?: string }).kind === "mot" ? "mot" : "samples";
    try {
      const res = await fetch(`${VISION_BASE}/video/${encodeURIComponent(clipId)}/track.csv?kind=${kind}`, {
        headers: visionHeaders(),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      if (!res.ok) return forwardError(reply, res);
      const disposition = res.headers.get("content-disposition");
      if (disposition) reply.header("Content-Disposition", disposition);
      reply.header("Cache-Control", "no-store");
      reply.type(kind === "mot" ? "text/plain; charset=utf-8" : "text/csv; charset=utf-8");
      return reply.send(await res.text());
    } catch {
      return reply.code(503).send({ error: "vision_service_unavailable" });
    }
  });

  // GET /visual/video/:clipId/track/frame?t= — the sampled frame nearest t, bird numbers drawn, as base64 JPEG
  app.get("/video/:clipId/track/frame", { preHandler: [requireAuth] }, async (request, reply) => {
    const { clipId } = request.params as { clipId: string };
    const t = Number((request.query as { t?: string }).t ?? 0);
    if (!Number.isFinite(t) || t < 0) return reply.code(400).send({ error: "invalid_time" });
    try {
      const res = await fetch(`${VISION_BASE}/video/${encodeURIComponent(clipId)}/track/frame?t=${t}`, {
        headers: visionHeaders(),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      if (!res.ok) return forwardError(reply, res);
      const buffer = Buffer.from(await res.arrayBuffer());
      return reply.send({
        t: Number(res.headers.get("x-sample-time") ?? t),
        status: res.headers.get("x-sample-status"),
        content_type: "image/jpeg",
        size_bytes: buffer.length,
        image: buffer.toString("base64"),
      });
    } catch {
      return reply.code(503).send({ error: "vision_service_unavailable" });
    }
  });
}
