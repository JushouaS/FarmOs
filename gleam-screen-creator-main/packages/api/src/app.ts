/**
 * Fastify application factory.
 *
 * Registers the DB plugin, CORS, cookie support and the route modules, then
 * exports the configured instance for the bootstrap in `server.ts`.
 *
 * The factory is intentionally separated from the bootstrap so tests can
 * `await buildApp()` without binding a socket.
 */

import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config.js";
import { dbPlugin } from "./db/index.js";
import "./db/types.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerOperationsRoutes } from "./routes/operations.js";
import { registerGrowthRoutes } from "./routes/growth.js";
import { registerVisualRoutes } from "./routes/visual.js";
import { registerIntelligenceRoutes } from "./routes/intelligence.js";
import { registerAlertRoutes } from "./routes/alerts.js";
import { registerIncidentRoutes } from "./routes/incidents.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerVisionProxyRoutes } from "./routes/vision-proxy.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    trustProxy: true,
  });

  await app.register(cors, {
    origin: env.API_CORS_ORIGINS,
    credentials: true,
  });
  await app.register(cookie, { secret: env.JWT_SECRET });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (request) =>
      (request.authUser?.sub ?? request.ip?.toString() ?? "anonymous"),
    errorResponseBuilder: (request, context) => ({
      error: "rate_limit_exceeded",
      retryAfter: context.after,
    }),
  });
  await app.register(dbPlugin);

  // Health + meta.
  app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));
  app.get("/", async () => ({ service: "farm-os-api", version: "0.1.0" }));

  await app.register(registerAuthRoutes, { prefix: "/auth" });
  await app.register(registerOperationsRoutes, { prefix: "/operations" });
  await app.register(registerGrowthRoutes, { prefix: "/growth" });
  await app.register(registerVisualRoutes, { prefix: "/visual" });
  await app.register(registerVisionProxyRoutes, { prefix: "/visual" });
  await app.register(registerIntelligenceRoutes, { prefix: "/intelligence" });
  await app.register(registerAlertRoutes, { prefix: "/alerts" });
  await app.register(registerIncidentRoutes, { prefix: "/incidents" });
  await app.register(registerReportRoutes, { prefix: "/reports" });
  await app.register(registerNotificationRoutes, { prefix: "/notifications" });

  return app;
}
