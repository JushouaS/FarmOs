import "fastify";
import "@fastify/cookie";
import type { Sql } from "postgres";

/**
 * Augment Fastify's type surface so route handlers can reach `sqlRead`,
 * `sqlWrite` and the authenticated user via `request.authUser` without
 * sprinkling type assertions everywhere.
 */

declare module "fastify" {
  interface FastifyInstance {
    sqlRead: Sql;
    sqlWrite: Sql;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the `authenticate` pre-handler when a valid JWT is present. */
    authUser?: {
      sub: string;
      email: string;
      roles: string[];
      permissions: string[];
    };
  }
}

export {};
