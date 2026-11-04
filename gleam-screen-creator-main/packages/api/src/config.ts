import dotenv from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from packages/api/ regardless of CWD.
const __here = fileURLToPath(new URL(".", import.meta.url));
dotenv.config({ path: resolve(__here, "..", ".env") });

import { z } from "zod";

/**
 * Loads, validates and freezes process.env into a typed config object.
 *
 * `DATABASE_WRITE_URL` falls back to `DATABASE_URL` when absent — Supabase's
 * Session pooler runs on 5432 and works for both reads and writes, so it is a
 * valid default in single-pooler setups.
 */

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_CORS_ORIGINS: z
    .string()
    // H-6: default to localhost dev origins so an empty string never becomes
    // an open wildcard. In production set this explicitly.
    .default("http://localhost:5173,http://localhost:8080")
    .transform((raw) =>
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: z.string().min(10, "DATABASE_URL is required"),
  DATABASE_WRITE_URL: z.string().optional(),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be >= 32 bytes"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(30 * 24 * 60 * 60),
  // "true" only when the app is served over TLS. Left unset, it follows
  // NODE_ENV — which breaks plain-HTTP deployments (a Secure cookie is never
  // sent back over http), so container setups pin it explicitly.
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  // The sign-in page advertises "admin / admin", but POST /auth/login only
  // accepts it under NODE_ENV=development — which a container deployment is
  // not. Setting this to "true" opts in explicitly; left unset, the shortcut
  // stays bound to NODE_ENV and production is never let in by accident.
  DEMO_LOGIN_ENABLED: z.enum(["true", "false"]).optional(),

  // Vision service (Flask)
  VISION_SERVICE_URL: z.string().url().default("http://127.0.0.1:5000"),
  // H-4: no insecure default — server will refuse to start without a real token.
  VISION_SERVICE_TOKEN: z.string().min(8, "VISION_SERVICE_TOKEN is required (min 8 chars)"),
  // The camera's RTSP link, as the fallback for the one Settings stores
  // (Settings > Camera, key 'camera'). Its password stays on the server: the
  // pages only ever get the link with "***" in place of it. Empty means no
  // fallback, so a deployment that has never opened Settings has no camera.
  DAHUA_RTSP_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  // The flock's clock, not the server's. Containers run in UTC, so without
  // this the day/night rule would be eight hours out in the Philippines and
  // a sleeping flock at 21:00 would be reported as huddling at 13:00.
  // Any IANA zone name works: Asia/Manila, Asia/Singapore, UTC.
  FARM_TZ: z.string().default("Asia/Manila"),
  // Minutes between automatic behaviour samples. 0 turns the sampler off, for
  // a deployment that would rather only analyse when someone asks.
  BEHAVIOR_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(5),

  // Uploaded clips, for testing the analysis against footage instead of a live
  // camera. The body is streamed to the vision service and never buffered here,
  // but the cap is enforced on this side too so an oversized upload is refused
  // before it has travelled anywhere.
  VIDEO_MAX_MB: z.coerce.number().int().positive().default(200),
  VIDEO_MAX_SECONDS: z.coerce.number().positive().default(600),
  VIDEO_SWEEP_SAMPLES: z.coerce.number().int().positive().max(120).default(30),

  // SUS questionnaire / "Report a problem" form (routes/feedback.ts).
  // Every response is written to a local CSV. When BOTH script settings are
  // set, each response is also sent to the owner's Google Apps Script, which
  // appends it to a .csv in their Drive (packages/api/google-apps-script/).
  // Empty values in .env count as "not set".
  SUS_CSV_PATH: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  REPORT_CSV_PATH: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  SUS_GOOGLE_SCRIPT_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  SUS_GOOGLE_SCRIPT_TOKEN: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(16).optional()),

  // Email alerts (notify.ts). Without SMTP_HOST and SMTP_FROM email is "not set up":
  // nothing is sent and the Settings card says so. Empty values count as "not set".
  SMTP_HOST: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  SMTP_PORT: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().default(587)),
  SMTP_SECURE: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["true", "false"]).default("false")),
  SMTP_USER: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  SMTP_PASS: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  SMTP_FROM: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  // Browser push (notify.ts). Make a key pair with `npm run vapid` and paste it here.
  VAPID_PUBLIC_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  VAPID_PRIVATE_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  VAPID_SUBJECT: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("mailto:admin@cerebroiler.dev")),
  // Where people open the app, for the link in an email.
  APP_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().default("http://localhost:8080")),

  // Live behavior monitor (behavior-monitor.ts): every BEHAVIOR_POLL_SECONDS the API asks the
  // camera service which birds are inactive or huddling and raises alerts. "off" disables it.
  BEHAVIOR_MONITOR: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["on", "off"]).default("on")),
  BEHAVIOR_POLL_SECONDS: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(5).default(30)),

  // Groq AI (Intelligence engine) — https://console.groq.com/keys
  // Optional at startup; required only when intelligence routes are hit.
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.format());
  process.exit(1);
}

export const env = Object.freeze({
  ...parsed.data,
  databaseWriteUrl: parsed.data.DATABASE_WRITE_URL ?? parsed.data.DATABASE_URL,
} as const);
