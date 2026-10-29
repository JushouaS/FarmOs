import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { env } from "../config.js";
import { requireAuth } from "../auth/middleware.js";

/**
 * Vision proxy routes — forward camera requests to the Flask vision service.
 *
 * The browser never talks to Flask directly.  All requests pass through
 * Fastify which validates the session cookie (requireAuth), then proxies
 * to the vision service with the internal service token.
 *
 * MJPEG streaming uses Node's built-in fetch and pipes the upstream
 * response body through to the client as multipart/x-mixed-replace.
 */

const VISION_BASE = env.VISION_SERVICE_URL;
const VISION_TOKEN = env.VISION_SERVICE_TOKEN;

/** Helper: build headers forwarded to the Flask service. */
function visionHeaders(): Record<string, string> {
  return { "X-Vision-Token": VISION_TOKEN };
}

/** The vision service answered, but with an error; carries its status and body. */
class VisionError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super("vision_error");
  }
}

/** One CV pass on the camera's latest frame. Throws VisionError when the
 *  service answers with an error, and a plain Error when it can't be reached. */
async function fetchAnalysis(cameraId: string): Promise<any> {
  const res = await fetch(`${VISION_BASE}/analyze/${encodeURIComponent(cameraId)}`, {
    method: "POST",
    headers: { ...visionHeaders(), "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    // M-7: truncate body to prevent internal Flask stack traces leaking to the client
    const body = (await res.text().catch(() => "")).slice(0, 500);
    throw new VisionError(res.status, { error: "analyze_error", detail: body });
  }
  return res.json();
}

const SCAN_SAMPLES = 4;
const SCAN_GAP_MS = 1_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Presses of the same camera's scan while one is running share its result.
const scansInFlight = new Map<string, Promise<unknown>>();

/**
 * Several analysis passes a second apart, reduced to one result.
 *
 * The vision service measures motion against the frame of its previous
 * analysis, so a lone call compares against an old frame (or none at all) and
 * reports a still flock. The first pass only sets that reference; the rest
 * measure real motion over about a second each. The pass with the middle
 * movement is kept, so one camera glitch or one burst of movement does not
 * decide the answer, and only that pass is written to the database.
 */
async function runScan(app: FastifyInstance, cameraId: string) {
  const samples: any[] = [];
  for (let i = 0; i < SCAN_SAMPLES; i++) {
    if (i > 0) await sleep(SCAN_GAP_MS);
    samples.push(await fetchAnalysis(cameraId));
  }
  const usable = samples.slice(1);
  const movement = (a: any): number => Number(a?.behaviour?.movement_index ?? 0);
  const ranked = [...usable].sort((a, b) => movement(a) - movement(b));
  const chosen = ranked[Math.floor(ranked.length / 2)];
  const values = usable.map(movement);

  let dbWritten = false;
  try {
    dbWritten = await persistAnalysis(app, cameraId, chosen);
  } catch (err) {
    app.log.error({ err, cameraId }, "vision scan: DB write failed, returning the scan unpersisted");
  }

  return {
    ...chosen,
    db_written: dbWritten,
    scan: {
      samples: usable.length,
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
  app.post("/capture/:cameraId", { preHandler: [requireAuth] }, async (request, reply) => {
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
  app.post("/analyze/:cameraId", { preHandler: [requireAuth] }, async (request, reply) => {
    const { cameraId } = request.params as { cameraId: string };
    let analysis: any;
    try {
      analysis = await fetchAnalysis(cameraId);
    } catch (err) {
      if (err instanceof VisionError) return reply.code(err.status).send(err.body);
      return reply.code(503).send({ error: "vision_service_unavailable" });
    }

    let dbWritten = false;
    try {
      dbWritten = await persistAnalysis(app, cameraId, analysis);
    } catch (err) {
      app.log.error({ err, cameraId }, "vision analyze: DB write failed, returning analysis unpersisted");
    }

    return reply.send({ ...analysis, db_written: dbWritten });
  });

  // -----------------------------------------------------------------------
  // POST /visual/scan/:cameraId — what the Live Camera "Analysis" button
  // calls: a few analysis passes a second apart, reduced to one result (see
  // runScan). Takes about three seconds.
  // -----------------------------------------------------------------------
  app.post(
    "/scan/:cameraId",
    { preHandler: [requireAuth], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
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
        return reply.code(503).send({ error: "vision_service_unavailable" });
      }
    },
  );
}

/**
 * Writes an /analyze result into Postgres. Returns true only if at least one
 * row was actually written. Looks the camera up by id; if it has no matching
 * `cameras` row (or the row has no sensor/cohort to attach a weight sample
 * to) the corresponding piece is skipped rather than thrown.
 */
async function persistAnalysis(app: FastifyInstance, cameraId: string, analysis: any): Promise<boolean> {
  const cameraRows = await app.sqlRead`
    SELECT id, house_id AS "houseId" FROM cameras WHERE id = ${cameraId}`;
  if (cameraRows.count === 0) return false;
  const camera = cameraRows[0]!;

  let wrote = false;

  const detections: any[] = Array.isArray(analysis?.detections) ? analysis.detections : [];
  for (const d of detections) {
    const id = `D-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await app.sqlWrite`
      INSERT INTO detections (id, camera_id, frame_at, box_x, box_y, box_w, box_h, behavior, estimated_weight_g, weight_confidence, flag)
      VALUES (${id}, ${camera.id}, now(), ${d.box_x}, ${d.box_y}, ${d.box_w}, ${d.box_h}, ${d.behavior ?? "UNKNOWN"}, ${d.estimated_weight_g ?? null}, ${d.weight_confidence ?? null}, ${d.flag ?? null})`;
    wrote = true;
  }

  const behaviour = analysis?.behaviour;
  if (behaviour) {
    await app.sqlWrite`
      INSERT INTO behavior_snapshots (camera_id, at, movement_index, movement_label, movement_status, huddling_risk, huddling_label, huddling_status, aggression_events)
      VALUES (${camera.id}, now(), ${behaviour.movement_index ?? null}, ${behaviour.movement_label ?? null}, ${behaviour.movement_status ?? null}, ${behaviour.huddling_risk ?? null}, ${behaviour.huddling_label ?? null}, ${behaviour.huddling_status ?? null}, ${behaviour.aggression_events ?? 0})`;
    wrote = true;
  }

  const clusters: any[] = Array.isArray(analysis?.clusters) ? analysis.clusters : [];
  for (const cl of clusters) {
    await app.sqlWrite`
      INSERT INTO cluster_warnings (camera_id, raised_at, label, risk, box)
      VALUES (${camera.id}, now(), ${cl.label ?? "Cluster warning"}, ${cl.risk ?? 0}, ${JSON.stringify(cl.box ?? {})}::jsonb)`;
    wrote = true;
  }

  const weight = analysis?.weight;
  if (weight) {
    // volumetric_samples wants a sensor_id and (optionally) a cohort_id.
    // Best-effort lookup: any sensor on this camera's house; any cohort tied
    // to the same house. Skip the insert if neither resolves rather than
    // writing a row with a dangling/guessed foreign key.
    const sensorRows = await app.sqlRead`
      SELECT id FROM sensors WHERE house_id = ${camera.houseId} ORDER BY id LIMIT 1`;
    if (sensorRows.count > 0) {
      const cohortRows = await app.sqlRead`
        SELECT id FROM cohorts WHERE house_id = ${camera.houseId} ORDER BY updated_at DESC LIMIT 1`;
      await app.sqlWrite`
        INSERT INTO volumetric_samples (sensor_id, cohort_id, calculated_mass_g, density_ratio, precision_percent, sampled_at)
        VALUES (${sensorRows[0]!.id}, ${cohortRows[0]?.id ?? null}, ${weight.median_g ?? null}, ${null}, ${weight.confidence != null ? weight.confidence * 100 : null}, now())`;
      wrote = true;
    }
  }

  return wrote;
}
