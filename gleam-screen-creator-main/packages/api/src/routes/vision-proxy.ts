import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../config.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { looksLikeRtsp } from "../camera-source.js";
import { classify, isNightAt, sustainedFlags, WINDOW_SIZE, type BehaviorVerdict } from "../behavior.js";
import { readLighting } from "../lighting.js";
import {
  VisionError,
  decideVerdict,
  fetchAnalysis,
  persistAnalysis,
  visionHeaders,
} from "../vision-pipeline.js";

/**
 * Vision proxy routes — forward camera requests to the Flask vision service.
 *
 * The browser never talks to Flask directly.  All requests pass through
 * Fastify which validates the session cookie (requireAuth), then proxies
 * to the vision service with the internal service token.
 *
 * MJPEG streaming uses Node's built-in fetch and pipes the upstream
 * response body through to the client as multipart/x-mixed-replace.
 *
 * The measuring, deciding and recording steps live in ../vision-pipeline so
 * the background sampler can run them without going through HTTP.
 */

const VISION_BASE = env.VISION_SERVICE_URL;
/** Who may start camera work (a scan, a capture, a test video). Everyone signed in may watch the feed. */
const CAN_USE_CAMERA = requireRole("OPERATOR", "FARM_MANAGER", "ADMIN");

// The test-video jobs keep the camera computer busy for minutes: one at a time.
let demoJobRunning = false;

/**
 * The signal for a request to the camera service on behalf of a browser: it stops after `ms`, and also when the
 * browser's connection closes (the tab closed, the upload cancelled, the page reloaded). Without that the job lock
 * below stayed set for up to five minutes for a result nobody was waiting for, and the next try heard "Another
 * video is being checked". Call `release` when the request is finished so the listener does not pile up on a
 * connection that is kept open for the next request.
 */
function untilTimeoutOrDisconnect(request: FastifyRequest, ms: number): { signal: AbortSignal; release: () => void } {
  const gone = new AbortController();
  const socket = request.raw.socket;
  const onClose = () => gone.abort();
  socket.once("close", onClose);
  return { signal: AbortSignal.any([gone.signal, AbortSignal.timeout(ms)]), release: () => socket.off("close", onClose) };
}

/** Largest video the "Test video" button accepts. Also enforced by the vision service. */
const DEMO_VIDEO_MAX_BYTES = 60 * 1024 * 1024;

const SCAN_SAMPLES = 3;
/** Same line the camera service draws between "Active" and "Inactive". */
const REAL_MOVEMENT = 0.02;
const SCAN_GAP_MS = 1_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Presses of the same camera's scan while one is running share its result.
const scansInFlight = new Map<string, Promise<unknown>>();

/**
 * Report a vision call that produced no answer at all.
 *
 * A timeout and a refused connection are different news. When a dead camera
 * holds the service's worker, "vision_service_unavailable" sends whoever reads
 * the error to look at a container that is running perfectly well.
 */
function noAnswer(reply: FastifyReply, err: unknown) {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return reply.code(504).send({
      error: "vision_timeout",
      detail: "The camera service did not answer in time.",
    });
  }
  return reply.code(503).send({ error: "vision_service_unavailable" });
}

/**
 * Several analysis passes a second apart, reduced to one result.
 *
 * Each pass is self-contained — the vision service grabs its own pair of
 * frames a fraction of a second apart, so it can measure motion on its own.
 * Three passes are still taken because one badly timed frame (a bird crossing
 * the lens, a flicker in the light) should not decide the answer, and the pass
 * with the middle movement is the one kept and written.
 */
async function runScan(app: FastifyInstance, cameraId: string) {
  const samples: any[] = [];
  for (let i = 0; i < SCAN_SAMPLES; i++) {
    if (i > 0) await sleep(SCAN_GAP_MS);
    samples.push(await fetchAnalysis(cameraId));
  }
  const movement = (a: any): number => Number(a?.metrics?.movement_index ?? 0);
  const ranked = [...samples].sort((a, b) => movement(a) - movement(b));
  const chosen = ranked[Math.floor(ranked.length / 2)];
  const values = samples.map(movement);

  let dbWritten = false;
  let behaviour: BehaviorVerdict | null = null;
  try {
    // Many small moving areas with almost no movement overall is picture
    // noise, not birds, so a scan saves the behaviour snapshot but not those
    // areas as "detections", and a cluster warning only when movement is real.
    const real = movement(chosen) > REAL_MOVEMENT;
    const saved = await persistAnalysis(app, cameraId, chosen, { detections: false, clusters: real });
    dbWritten = saved.wrote;
    behaviour = saved.behaviour;
  } catch (err) {
    app.log.error({ err, cameraId }, "vision scan: DB write failed, returning the scan unpersisted");
  }

  return {
    ...chosen,
    // The verdict is what the dashboard renders; the raw metrics travel with it.
    behaviour: behaviour ?? classify(chosen?.metrics, { night: false, warnings: chosen?.warnings }),
    db_written: dbWritten,
    scan: {
      samples: samples.length,
      movement_min: Math.min(...values),
      movement_max: Math.max(...values),
      movement_mean: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10000) / 10000,
    },
  };
}

export async function registerVisionProxyRoutes(app: FastifyInstance) {
  // -----------------------------------------------------------------------
  // GET /visual/health — Flask service health check
  // -----------------------------------------------------------------------
  app.get("/health", { preHandler: [requireAuth] }, async (_request, reply) => {
    try {
      const res = await fetch(`${VISION_BASE}/health`, {
        headers: visionHeaders(),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        return reply.code(res.status).send({ error: "vision_unreachable" });
      }
      return reply.send(await res.json());
    } catch {
      return reply.code(503).send({ error: "vision_service_unavailable" });
    }
  });

  // -----------------------------------------------------------------------
  // POST /visual/source-test — can the service open this RTSP link at all?
  //
  // The "Test link" button in Settings asks before saving, because a wrong
  // character in an RTSP link is invisible on screen and the failure only
  // shows up as a black frame minutes later. Only the camera services can
  // answer it: the browser has no way to speak RTSP.
  // -----------------------------------------------------------------------
  app.post(
    "/source-test",
    { preHandler: [requireAuth, requireRole("ADMIN", "FARM_MANAGER")] },
    async (request, reply) => {
      const parsed = z.object({ rtspUrl: z.string().max(2048) }).safeParse(request.body);
      if (!parsed.success || !looksLikeRtsp(parsed.data.rtspUrl)) {
        return reply.code(400).send({
          error: "invalid_camera_url",
          detail: "That is not a link the camera service can open.",
        });
      }
      try {
        const res = await fetch(`${VISION_BASE}/source/test`, {
          method: "POST",
          headers: { ...visionHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ rtspUrl: parsed.data.rtspUrl.trim() }),
          // Opening a dead RTSP source waits for its own 5s open timeout.
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          return reply.code(res.status).send({ error: "vision_error" });
        }
        return reply.send(await res.json());
      } catch (err) {
        return noAnswer(reply, err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // GET /visual/behavior — what the live behavior monitor on the camera
  // computer sees right now. Always answers 200: a monitor that is off, stale
  // or unreachable comes back as `running: false`, so the page can say so.
  // -----------------------------------------------------------------------
  app.get("/behavior", { preHandler: [requireAuth] }, async (request, reply) => {
    const night = (request.query as { night?: string }).night === "1" ? 1 : 0;
    try {
      const res = await fetch(`${VISION_BASE}/behavior/status?night=${night}`, {
        headers: visionHeaders(),
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) return reply.send({ running: false, reason: "unreachable" });
      const status = (await res.json()) as { running?: boolean; age_seconds?: number | null };
      // A monitor that has not looked at a frame for a minute is not telling us about now.
      if (status.running && (status.age_seconds ?? 0) > 60) return reply.send({ running: false, reason: "stale" });
      return reply.send(status);
    } catch {
      return reply.send({ running: false, reason: "unreachable" });
    }
  });

  // -----------------------------------------------------------------------
  // GET /visual/cameras — list configured camera sources
  // -----------------------------------------------------------------------
  app.get("/cameras", { preHandler: [requireAuth] }, async (_request, reply) => {
    try {
      const res = await fetch(`${VISION_BASE}/cameras`, {
        headers: visionHeaders(),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        return reply.code(res.status).send({ error: "vision_error" });
      }
      return reply.send(await res.json());
    } catch {
      return reply.code(503).send({ error: "vision_service_unavailable" });
    }
  });

  // -----------------------------------------------------------------------
  // GET /visual/kinect-ticket — lets a signed-in viewer open the Kinect depth
  // stream. The bridge checks the ticket against the same key; without a key
  // configured there is no ticket and the bridge asks for none.
  // -----------------------------------------------------------------------
  app.get("/kinect-ticket", { preHandler: [requireAuth] }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const key = env.KINECT_BRIDGE_KEY;
    if (!key) return reply.send({ ticket: null });
    const expiry = String(Math.floor(Date.now() / 1000) + 120);
    return reply.send({ ticket: `${expiry}.${createHmac("sha256", key).update(expiry).digest("hex")}` });
  });

  // -----------------------------------------------------------------------
  // GET /visual/kinect-chickens — the newest outlines of the chickens on the
  // Kinect picture, from kinect_seg.py. Asking keeps that program working for
  // another 15 seconds, so the page asks every second or two while it is open.
  // -----------------------------------------------------------------------
  app.get("/kinect-chickens", { preHandler: [requireAuth], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const res = await fetch(`${env.KINECT_SEG_URL}/latest`, { signal: AbortSignal.timeout(4_000) });
      return reply.code(res.ok ? 200 : 502).send(await res.json());
    } catch {
      return reply.code(503).send({ ok: false, status: "not_running", message: "The chicken finder (kinect_seg.py) is not running." });
    }
  });

  // -----------------------------------------------------------------------
  // GET /visual/stream/:cameraId — MJPEG multipart stream (proxied)
  // -----------------------------------------------------------------------
  app.get("/stream/:cameraId", { preHandler: [requireAuth] }, async (request, reply) => {
    const { cameraId } = request.params as { cameraId: string };
    try {
      // C-4: 15s connect timeout prevents stalled cameras from holding a
      // server connection open indefinitely. The stream itself is piped
      // directly so it does not time out after connect.
      const res = await fetch(`${VISION_BASE}/stream/${encodeURIComponent(cameraId)}`, {
        headers: visionHeaders(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 500);
        return reply.code(res.status).send({ error: "stream_error", detail: body });
      }

      // Pipe the upstream multipart stream to the client
      const contentType = res.headers.get("content-type") ?? "multipart/x-mixed-replace; boundary=frame";
      reply.header("Content-Type", contentType);
      reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
      reply.header("X-Accel-Buffering", "no");

      // Use ReadableStream for piping
      if (res.body) {
        const nodeStream = Readable.fromWeb(res.body as any);
        return reply.send(nodeStream);
      }

      return reply.code(502).send({ error: "empty_stream" });
    } catch (err) {
      return reply.code(503).send({
        error: "vision_service_unavailable",
        message: err instanceof Error ? err.message : "stream failed",
      });
    }
  });

  // -----------------------------------------------------------------------
  // POST /visual/capture/:cameraId — single JPEG frame + metadata
  // -----------------------------------------------------------------------
  app.post("/capture/:cameraId", { preHandler: [requireAuth, CAN_USE_CAMERA] }, async (request, reply) => {
    const { cameraId } = request.params as { cameraId: string };
    try {
      const res = await fetch(`${VISION_BASE}/capture/${encodeURIComponent(cameraId)}`, {
        method: "POST",
        headers: { ...visionHeaders(), "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        // M-7: truncate body to prevent internal Flask stack traces leaking to the client
        const body = (await res.text().catch(() => "")).slice(0, 500);
        return reply.code(res.status).send({ error: "capture_error", detail: body });
      }
      return reply.send(await res.json());
    } catch {
      return reply.code(503).send({ error: "vision_service_unavailable" });
    }
  });

  // -----------------------------------------------------------------------
  // POST /visual/analyze/:cameraId — proxy the CV pass to Flask, then
  // persist what it found.
  //
  // cerebroil-stream (Flask) has no database connection by design — it
  // always reports db_written: false. Previously nothing downstream ever
  // wrote the result anywhere despite the route's own comment claiming a
  // "DB write" happened, so every analyze call was silently thrown away.
  // This now does that write here, against the tables the rest of the API
  // already reads from (detections, behavior_snapshots, volumetric_samples),
  // and is tolerant of a camera with no matching house/sensor row rather
  // than failing the whole request.
  // -----------------------------------------------------------------------
  app.post("/analyze/:cameraId", { preHandler: [requireAuth, CAN_USE_CAMERA] }, async (request, reply) => {
    const { cameraId } = request.params as { cameraId: string };
    let analysis: any;
    try {
      analysis = await fetchAnalysis(cameraId);
    } catch (err) {
      if (err instanceof VisionError) return reply.code(err.status).send(err.body);
      return noAnswer(reply, err);
    }

    let dbWritten = false;
    let behaviour: BehaviorVerdict;
    try {
      const saved = await persistAnalysis(app, cameraId, analysis);
      dbWritten = saved.wrote;
      behaviour = saved.behaviour;
    } catch (err) {
      app.log.error({ err, cameraId }, "vision analyze: DB write failed, returning analysis unpersisted");
      // Still answer with a verdict — the reading is useful even when the row
      // that would have recorded it was not written.
      behaviour = await decideVerdict(app, analysis);
    }

    return reply.send({ ...analysis, behaviour, db_written: dbWritten });
  });

  // -----------------------------------------------------------------------
  // GET /visual/behavior/:cameraId — the latest verdict for a camera plus the
  // rolling window behind it.
  //
  // The dashboard asks for this instead of scanning on every render: the
  // sampler writes a snapshot every few minutes, and a welfare finding is a
  // trend across those snapshots, not a single frame.
  // -----------------------------------------------------------------------
  app.get("/behavior/:cameraId", { preHandler: [requireAuth] }, async (request, reply) => {
    const { cameraId } = request.params as { cameraId: string };
    const lighting = await readLighting(app);

    const rows = await app.sqlRead`
      SELECT at, movement_index, movement_label, movement_status,
             huddling_risk, huddling_label, huddling_status,
             bird_count, zone_count, evaluable_count, inactive_count, huddled_count,
             night, suppressed, reliable
      FROM behavior_snapshots
      WHERE camera_id = ${cameraId}
      ORDER BY at DESC
      LIMIT ${WINDOW_SIZE}`;

    const recent = rows.map((r: any) => ({
      at: r.at,
      movement_index: Number(r.movement_index ?? 0),
      movement_label: r.movement_label,
      movement_status: r.movement_status,
      huddling_risk: Number(r.huddling_risk ?? 0),
      huddling_label: r.huddling_label,
      huddling_status: r.huddling_status,
      bird_count: r.bird_count,
      zone_count: r.zone_count,
      evaluable_count: r.evaluable_count,
      inactive_count: r.inactive_count,
      huddled_count: r.huddled_count,
      night: Boolean(r.night),
      suppressed: Boolean(r.suppressed),
      reliable: Boolean(r.reliable),
    }));

    return reply.send({
      camera_id: cameraId,
      night: isNightAt(new Date(), lighting),
      timezone: env.FARM_TZ,
      lighting,
      latest: recent[0] ?? null,
      recent,
      sustained: sustainedFlags(recent),
    });
  });

  // -----------------------------------------------------------------------
  // POST /visual/scan/:cameraId — what the Live Camera "Analysis" button
  // calls: a few analysis passes a second apart, reduced to one result (see
  // runScan). Takes about three seconds.
  // -----------------------------------------------------------------------
  app.post(
    "/scan/:cameraId",
    { preHandler: [requireAuth, CAN_USE_CAMERA], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { cameraId } = request.params as { cameraId: string };
      let pending = scansInFlight.get(cameraId);
      if (!pending) {
        pending = runScan(app, cameraId).finally(() => scansInFlight.delete(cameraId));
        scansInFlight.set(cameraId, pending);
      }
      try {
        return reply.send(await pending);
      } catch (err) {
        if (err instanceof VisionError) return reply.code(err.status).send(err.body);
        return noAnswer(reply, err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // POST /visual/demo-detect — the "Test video" button on Live Camera.
  // The browser sends the video file as the raw body; it goes on to the vision
  // service, which runs the trained detector over it and answers with the boxes
  // for each sampled frame. Nothing is stored.
  // -----------------------------------------------------------------------
  app.addContentTypeParser(
    /^(video\/.+|application\/octet-stream)$/,
    { parseAs: "buffer", bodyLimit: DEMO_VIDEO_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.post(
    "/demo-detect",
    {
      preHandler: [requireAuth, CAN_USE_CAMERA],
      bodyLimit: DEMO_VIDEO_MAX_BYTES,
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const video = request.body;
      if (!Buffer.isBuffer(video) || video.length === 0) {
        return reply.code(400).send({ error: "empty_video" });
      }
      if (demoJobRunning) return reply.code(429).send({ error: "busy", message: "Another video is being checked. Try again in a minute." });
      demoJobRunning = true;
      const watch = untilTimeoutOrDisconnect(request, 5 * 60_000);
      try {
        // ?night=1 tells the detector the clip was filmed with the lights off.
        const night = (request.query as { night?: string }).night === "1";
        const res = await fetch(`${VISION_BASE}/demo/detect${night ? "?night=1" : ""}`, {
          method: "POST",
          headers: { ...visionHeaders(), "Content-Type": "application/octet-stream" },
          body: new Uint8Array(video),
          // A small computer takes a while to go through a clip.
          signal: watch.signal,
        });
        const body = await res.json().catch(() => ({ error: "demo_detect_error" }));
        return reply.code(res.status).send(body);
      } catch {
        return reply.code(503).send({ error: "vision_service_unavailable" });
      } finally {
        demoJobRunning = false;
        watch.release();
      }
    },
  );

  // -----------------------------------------------------------------------
  // POST /visual/demo-convert — re-encodes an uploaded video (MKV, AVI, a clip
  // cut short) as a small MP4 that browsers can play. The "Test video" button
  // calls it first for files a browser cannot play as they are.
  // -----------------------------------------------------------------------
  app.post(
    "/demo-convert",
    {
      preHandler: [requireAuth, CAN_USE_CAMERA],
      bodyLimit: DEMO_VIDEO_MAX_BYTES,
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const video = request.body;
      if (!Buffer.isBuffer(video) || video.length === 0) {
        return reply.code(400).send({ error: "empty_video" });
      }
      if (demoJobRunning) return reply.code(429).send({ error: "busy", message: "Another video is being checked. Try again in a minute." });
      demoJobRunning = true;
      const watch = untilTimeoutOrDisconnect(request, 5 * 60_000);
      try {
        const res = await fetch(`${VISION_BASE}/demo/convert`, {
          method: "POST",
          headers: { ...visionHeaders(), "Content-Type": "application/octet-stream" },
          body: new Uint8Array(video),
          signal: watch.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "demo_convert_error" }));
          return reply.code(res.status).send(body);
        }
        return reply.header("Content-Type", "video/mp4").send(Buffer.from(await res.arrayBuffer()));
      } catch {
        return reply.code(503).send({ error: "vision_service_unavailable" });
      } finally {
        demoJobRunning = false;
        watch.release();
      }
    },
  );
}
