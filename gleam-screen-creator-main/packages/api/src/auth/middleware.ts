import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { hashAccessToken, verifyAccessToken } from "./auth.js";

const ACCESS_COOKIE = "farm_access_token";

function getAccessToken(request: any): string | undefined {
  // Prefer the httpOnly cookie; fall back to the Authorization header for
  // non-browser clients and legacy callers.
  const fromCookie = request.cookies?.[ACCESS_COOKIE];
  if (fromCookie) return fromCookie;
  const header = request.headers.authorization;
  if (header && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return undefined;
}

/**
 * Pre-handler that requires a valid session. Reads the access token from the
 * httpOnly cookie first, then the Authorization header, verifies the JWT, and
 * validates that the session still exists server-side. Sets `request.authUser`
 * for downstream handlers.
 *
 * Wire it per-route or per-prefix:
 *   fastify.get("/protected", { preHandler: [requireAuth] }, handler)
 */
export const requireAuth: preHandlerHookHandler = async (request, reply) => {
  const token = getAccessToken(request);
  if (!token) {
    return reply.code(401).send({ error: "missing_token" });
  }
  try {
    const payload = await verifyAccessToken(token);
    if (!payload.sub || !payload.email || !Array.isArray(payload.roles)) {
      throw new Error("malformed_payload");
    }

    // Server-side session validation: ensure the token was issued by us, has not
    // been revoked (logout clears the sessions row) and its account is still active.
    // The table keeps a hash of the token; a session saved before that is matched by the token itself.
    // The roles come from the database, not from the token, so a change of role (or of what a role
    // may do) applies on the very next request instead of when the token runs out.
    const session = await request.server.sqlRead`
      SELECT s.id, u.must_change_password,
             COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
             COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE s.access_token = ANY(${[hashAccessToken(token), token]}) AND u.is_active
      GROUP BY s.id, u.must_change_password
      LIMIT 1`;
    if (session.count === 0) {
      return reply.code(401).send({ error: "session_revoked" });
    }

    // Someone on a temporary password may only see who they are, change the password, and sign out.
    if (session[0]!.must_change_password) {
      const path = request.url.split("?")[0];
      const allowed =
        (request.method === "GET" && path === "/auth/me") ||
        (request.method === "POST" && (path === "/auth/password" || path === "/auth/logout"));
      if (!allowed) return reply.code(403).send({ error: "password_change_required" });
    }

    request.authUser = {
      sub: payload.sub,
      email: payload.email,
      roles: session[0]!.roles as string[],
      permissions: session[0]!.permissions as string[],
    };
  } catch (err) {
    return reply.code(401).send({
      error: "invalid_token",
      message: err instanceof Error ? err.message : "verification failed",
    });
  }
};

/**
 * Optional auth: populates `request.authUser` when a valid session is present
 * but allows the request through without one.
 */
export const optionalAuth: preHandlerHookHandler = async (request) => {
  const token = getAccessToken(request);
  if (!token) return;
  try {
    const payload = await verifyAccessToken(token);
    if (payload.sub && payload.email && Array.isArray(payload.roles)) {
      request.authUser = {
        sub: payload.sub,
        email: payload.email,
        roles: payload.roles as string[],
        permissions: (payload.permissions ?? []) as string[],
      };
    }
  } catch {
    // Anonymous requests are fine under optional auth.
  }
};

/**
 * Returns a pre-handler that enforces at least one of the given roles. Must be
 * applied *after* `requireAuth` so `request.authUser` is populated.
 */
export function requireRole(...roles: string[]): preHandlerHookHandler {
  const set = new Set(roles);
  return async (request, reply) => {
    const user = request.authUser as
      | { sub: string; email: string; roles: string[]; permissions: string[] }
      | undefined;
    if (!user) return reply.code(401).send({ error: "missing_bearer" });
    if (!user.roles.some((r: string) => set.has(r))) {
      return reply.code(403).send({ error: "insufficient_role" });
    }
  };
}

/**
 * Returns a pre-handler that enforces at least one of the given permissions.
 * Permission codes are stored in lowercase (e.g. `facilities.read`).
 */
export function requirePermission(...codes: string[]): preHandlerHookHandler {
  const set = new Set(codes.map((c) => c.toLowerCase()));
  return async (request, reply) => {
    const user = request.authUser as
      | { sub: string; email: string; roles: string[]; permissions: string[] }
      | undefined;
    if (!user) return reply.code(401).send({ error: "missing_bearer" });
    const hasAdmin = user.roles.includes("ADMIN");
    const hasPermission = user.permissions.some((p: string) => set.has(p.toLowerCase()));
    if (!hasAdmin && !hasPermission) {
      return reply.code(403).send({ error: "insufficient_permission" });
    }
  };
}

// The import below only exists so `FastifyInstance` is referenced — it is
// used by type augmentation in `db/types.ts` and keeps the module graph live.
export type _F = FastifyInstance;
