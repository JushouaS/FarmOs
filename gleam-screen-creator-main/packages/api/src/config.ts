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
    .default("")
    .transform((raw) =>
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: z.string().min(10, "DATABASE_URL is required"),
  DATABASE_WRITE_URL: z.string().optional(),

  JWT_SECRET: z.string().min(16, "JWT_SECRET must be >= 16 bytes"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(30 * 24 * 60 * 60),

  // Vision service (Flask)
  VISION_SERVICE_URL: z.string().url().default("http://127.0.0.1:5000"),
  VISION_SERVICE_TOKEN: z.string().default("dev-vision-token-change-in-production"),
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
