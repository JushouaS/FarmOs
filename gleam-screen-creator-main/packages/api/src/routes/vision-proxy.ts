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
      const res = await fetch(`${VISION_BASE}/stream/${encodeURIComponent(cameraId)}`, {
        headers: visionHeaders(),
      });
      if (!res.ok) {
        const body = await res.text();
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
        const body = await res.text();
        return reply.code(res.status).send({ error: "capture_error", detail: body });
      }
      return reply.send(await res.json());
    } catch {
      return reply.code(503).send({ error: "vision_service_unavailable" });
    }
  });

  // -----------------------------------------------------------------------
  // POST /visual/analyze/:cameraId — full CV pipeline + DB write
  // -----------------------------------------------------------------------
  app.post("/analyze/:cameraId", { preHandler: [requireAuth] }, async (request, reply) => {
    const { cameraId } = request.params as { cameraId: string };
    try {
      const res = await fetch(`${VISION_BASE}/analyze/${encodeURIComponent(cameraId)}`, {
        method: "POST",
        headers: { ...visionHeaders(), "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const body = await res.text();
        return reply.code(res.status).send({ error: "analyze_error", detail: body });
      }
      return reply.send(await res.json());
    } catch {
      return reply.code(503).send({ error: "vision_service_unavailable" });
    }
  });
}
