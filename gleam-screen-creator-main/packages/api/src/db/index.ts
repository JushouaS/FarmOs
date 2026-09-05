import postgres, { type Sql } from "postgres";
import fastifyPlugin from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { env } from "../config.js";

/**
 * Two connection pools: one read-only for render-time queries, one read-write
 * for mutations. They share the same connection string when
 * `DATABASE_WRITE_URL` is not configured — Supabase's session pooler on 5432
 * accepts both reads and writes.
 *
 * Both pools attach to the Fastify instance via the `fastify-plugin` wrapper
 * below so they are shared across the whole application instead of being
 * scoped to a route prefix.
 */

export function createReadPool(): Sql {
  return postgres(env.DATABASE_URL, {
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
    types: {},
  });
}

export function createWritePool(): Sql {
  return postgres(env.databaseWriteUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    types: {},
  });
}

/**
 * Fastify decorator that exposes `sqlRead` and `sqlWrite` on the Fastify
 * instance and closes both pools when the server shuts down.
 */
export const dbPlugin = fastifyPlugin(async function dbPlugin(fastify: FastifyInstance) {
  const sqlRead = createReadPool();
  const sqlWrite = createWritePool();

  fastify.decorate("sqlRead", sqlRead);
  fastify.decorate("sqlWrite", sqlWrite);

  fastify.addHook("onClose", async () => {
    await sqlRead.end({ timeout: 5 });
    await sqlWrite.end({ timeout: 5 });
  });
});
