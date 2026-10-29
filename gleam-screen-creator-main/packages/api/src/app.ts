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
import { registerFeedbackRoutes } from "./routes/feedback.js";
import { registerVisionProxyRoutes } from "./routes/vision-proxy.js";

/** localhost and the private IPv4 ranges (10.x, 172.16-31.x, 192.168.x), with any port. */
const PRIVATE_NETWORK_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    trustProxy: true,
  });

  await app.register(cors, {
    // In development, a phone or laptop on the same network opens the app at
    // this machine's LAN address, which changes whenever the router hands out
    // a new one. So development also accepts any private-network origin; the
    // explicit list is the only thing allowed in production.
    origin:
      env.NODE_ENV === "development"
        ? (origin, callback) => callback(null, !origin || env.API_CORS_ORIGINS.includes(origin) || PRIVATE_NETWORK_ORIGIN.test(origin))
        : env.API_CORS_ORIGINS,
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
  await app.register(registerFeedbackRoutes, { prefix: "/feedback" });

  return app;
}
