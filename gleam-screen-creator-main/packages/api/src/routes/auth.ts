import type { FastifyInstance } from "fastify";
import { z } from "zod";
import QRCode from "qrcode";
import { env } from "../config.js";
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  validatePassword,
  generateMfaSecret,
  verifyMfaToken,
  generateBackupCodes,
  hashBackupCode,
} from "../auth/auth.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import type { AccessTokenPayload } from "../auth/auth.js";

const LOCKOUT_AFTER_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;

/**
 * Session + identity routes.
 *
 * POST /auth/register
 * POST /auth/login
 * POST /auth/refresh
 * POST /auth/logout
 * POST /auth/password-reset/request
 * POST /auth/password-reset/confirm
 * GET  /auth/me             (auth required)
 */

const emailSchema = z.string().email().max(320);
const passwordSchema = z.string().min(12).max(128);

const registerBody = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().max(160).optional(),
  roles: z.array(z.string()).default(["VIEWER"]),
});

const loginBody = z.object({
  email: emailSchema,
  password: passwordSchema,
});

const refreshBody = z.object({
  refreshToken: z.string().min(1),
});

const mfaTokenBody = z.object({
  token: z.string().min(6).max(9),
});

const passwordChangeBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

const ACCESS_COOKIE = "farm_access_token";
const REFRESH_COOKIE = "farm_refresh_token";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: env.JWT_ACCESS_TTL_SECONDS,
};

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: Number(process.env.JWT_REFRESH_TTL_SECONDS ?? 30 * 24 * 60 * 60),
};

const MFA_PENDING_COOKIE = "farm_mfa_pending";
const MFA_COOKIE_OPTS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/auth/mfa",
  maxAge: 5 * 60, // 5 minutes
  signed: true,
};

export async function registerAuthRoutes(app: FastifyInstance) {
  /** Issue a new access/refresh pair for a validated user. */
  async function issueSession(userId: string, ip: string | null, ua: string | null) {
    const user = await app.sqlRead`
      SELECT u.id, u.email,
             COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
             COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = ${userId} AND u.is_active = true
      GROUP BY u.id, u.email
      LIMIT 1`;
    if (user.count === 0) throw new Error("user_not_found");
    const row = user[0]!;

    const accessToken = await signAccessToken({
      sub: row.id,
      email: row.email,
      roles: row.roles as string[],
      permissions: row.permissions as string[],
    });

    const rawRefresh = generateRefreshToken();
    const refreshHash = hashRefreshToken(rawRefresh);
    const ttlMs = Number(process.env.JWT_REFRESH_TTL_SECONDS ?? 30 * 24 * 60 * 60) * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);

    await app.sqlWrite`
      INSERT INTO sessions (user_id, access_token, refresh_token, refresh_expires_at, ip_address, user_agent)
      VALUES (${row.id}, ${accessToken}, ${refreshHash}, ${expiresAt.toISOString()}, ${ip}::inet, ${ua})
    `;

    await app.sqlWrite`
      UPDATE users SET last_login_at = now() WHERE id = ${row.id}
    `;

    await app.sqlWrite`
      INSERT INTO auth_audit (user_id, action, ip_address, metadata)
      VALUES (${row.id}, ${"session_issued"}, ${ip}::inet, ${app.sqlWrite.json({ userAgent: ua })})
    `;

    return {
      accessToken,
      refreshToken: rawRefresh,
      refreshExpiresAt: expiresAt.toISOString(),
      user: {
        id: row.id,
        email: row.email,
        roles: row.roles as string[],
        permissions: row.permissions as string[],
      },
    };
  }

  function setSessionCookies(reply: any, session: Awaited<ReturnType<typeof issueSession>>) {
    reply.setCookie(ACCESS_COOKIE, session.accessToken, COOKIE_OPTS);
    reply.setCookie(REFRESH_COOKIE, session.refreshToken, REFRESH_COOKIE_OPTS);
  }

  const loginRateLimit = { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } };

  app.post("/register", { ...loginRateLimit }, async (request, reply) => {
    const parsed = registerBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    const { email, password, fullName, roles } = parsed.data;

    const policy = validatePassword(password);
    if (!policy.ok) return reply.code(400).send({ error: "weak_password", message: policy.reason });

    const existing = await app.sqlRead`SELECT 1 FROM users WHERE email = ${email}`;
    if (existing.count > 0) return reply.code(409).send({ error: "email_taken" });

    const passwordHash = await hashPassword(password);
    const inserted = await app.sqlWrite`
      INSERT INTO users (email, password_hash, full_name)
      VALUES (${email}, ${passwordHash}, ${fullName ?? null})
      RETURNING id`;
    const userId = inserted[0]!.id as string;

    if (roles.length > 0) {
      await app.sqlWrite`
        INSERT INTO user_roles (user_id, role_id)
        SELECT ${userId}, r.id FROM roles r WHERE r.code = ANY(${roles})
      `;
    }

    const session = await issueSession(userId, request.ip, request.headers["user-agent"] ?? null);
    setSessionCookies(reply, session);
    return reply.code(201).send({ user: session.user });
  });

  app.post("/login", { ...loginRateLimit }, async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    const { email, password } = parsed.data;

    const user = await app.sqlRead`
      SELECT id, password_hash, is_active, failed_login_attempts, locked_until, mfa_enabled, mfa_secret
      FROM users WHERE email = ${email}`;
    if (user.count === 0) {
      await app.sqlWrite`
        INSERT INTO auth_audit (action, ip_address, metadata)
        VALUES (${"login_failed_unknown"}, ${request.ip}::inet, ${app.sqlWrite.json({ email })})
      `;
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const row = user[0]!;
    if (!row.is_active) return reply.code(403).send({ error: "user_disabled" });

    const lockedUntil = row.locked_until ? new Date(row.locked_until as string) : null;
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      await app.sqlWrite`
        INSERT INTO auth_audit (user_id, action, ip_address, metadata)
        VALUES (${row.id}, ${"login_failed_locked"}, ${request.ip}::inet, ${app.sqlWrite.json({ lockedUntil: row.locked_until })})`;
      return reply.code(403).send({
        error: "account_locked",
        lockedUntil: row.locked_until,
        message: `Account is locked until ${lockedUntil.toISOString()}.`,
      });
    }

    const ok = await verifyPassword(password, row.password_hash as string);
    if (!ok) {
      const attempts = (row.failed_login_attempts as number) + 1;
      const locked = attempts >= LOCKOUT_AFTER_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString()
        : null;
      await app.sqlWrite`
        UPDATE users
        SET failed_login_attempts = ${attempts},
            locked_until = ${locked}
        WHERE id = ${row.id}`;
      await app.sqlWrite`
        INSERT INTO auth_audit (user_id, action, ip_address, metadata)
        VALUES (${row.id}, ${"login_failed_password"}, ${request.ip}::inet, ${app.sqlWrite.json({ attempts, locked })})`;
      return reply.code(401).send({
        error: "invalid_credentials",
        attemptsRemaining: Math.max(0, LOCKOUT_AFTER_FAILED_ATTEMPTS - attempts),
      });
    }

    // Reset failed attempts on correct password.
    await app.sqlWrite`
      UPDATE users SET failed_login_attempts = 0, locked_until = null WHERE id = ${row.id}`;

    // If MFA is enabled, require a second factor before issuing a full session.
    if (row.mfa_enabled) {
      reply.setCookie(MFA_PENDING_COOKIE, row.id as string, MFA_COOKIE_OPTS);
      return reply.send({ mfaRequired: true });
    }

    const session = await issueSession(row.id as string, request.ip, request.headers["user-agent"] ?? null);
    setSessionCookies(reply, session);
    return reply.send({ user: session.user });
  });

  app.post("/refresh", async (request, reply) => {
    const refreshFromCookie = (request as any).cookies?.[REFRESH_COOKIE];
    const parsed = refreshBody.safeParse(request.body);
    const refreshToken = refreshFromCookie ?? parsed.data?.refreshToken;
    if (!refreshToken) return reply.code(401).send({ error: "missing_refresh" });
    const hash = hashRefreshToken(refreshToken);

    const session = await app.sqlRead`
      SELECT id, user_id, refresh_expires_at FROM sessions
      WHERE refresh_token = ${hash}
      LIMIT 1`;
    if (session.count === 0) return reply.code(401).send({ error: "invalid_refresh" });
    const row = session[0]!;
    if (new Date(row.refresh_expires_at as string).getTime() < Date.now()) {
      await app.sqlWrite`DELETE FROM sessions WHERE id = ${row.id}`;
      return reply.code(401).send({ error: "refresh_expired" });
    }

    // Rotate: delete the old session, issue a new one.
    await app.sqlWrite`DELETE FROM sessions WHERE id = ${row.id}`;
    const fresh = await issueSession(
      row.user_id as string,
      request.ip,
      request.headers["user-agent"] ?? null,
    );
    setSessionCookies(reply, fresh);
    return reply.send({ user: fresh.user });
  });

  app.post("/logout", { preHandler: [requireAuth] }, async (request, reply) => {
    const token = (request as any).cookies?.[ACCESS_COOKIE] ?? request.headers.authorization?.slice(7).trim();
    if (!token) return reply.code(400).send({ error: "missing_token" });
    const deleted = await app.sqlWrite`
      DELETE FROM sessions WHERE access_token = ${token} RETURNING id`;
    if (deleted.count === 0) return reply.code(404).send({ error: "session_not_found" });
    reply.clearCookie(ACCESS_COOKIE, { path: "/" });
    reply.clearCookie(REFRESH_COOKIE, { path: "/" });
    await app.sqlWrite`
      INSERT INTO auth_audit (user_id, action, ip_address)
      VALUES (${request.authUser!.sub}, ${"logout"}, ${request.ip}::inet)
    `;
    return reply.code(204).send();
  });

  app.get("/me", { preHandler: [requireAuth] }, async (request) => {
    const user = request.authUser!;
    const row = await app.sqlRead`
      SELECT id, email, full_name, avatar_url, last_login_at, created_at
      FROM users WHERE id = ${user.sub}`;
    return {
      user: row[0],
      roles: user.roles,
      permissions: user.permissions,
    };
  });

  /* -------------------------------------------------------------------------- */
  /*  MFA flow                                                                  */
  /* -------------------------------------------------------------------------- */

  /**
   * POST /auth/mfa/login-verify
   * Completes a second-factor login when mfaRequired was returned by /login.
   * The pending cookie carries the user id, signed by the cookie secret.
   */
  app.post("/mfa/login-verify", { ...loginRateLimit }, async (request, reply) => {
    const pendingCookie = (request as any).cookies?.[MFA_PENDING_COOKIE];
    if (!pendingCookie) return reply.code(401).send({ error: "mfa_not_pending" });
    const parsed = mfaTokenBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const userId = ((request as any).unsignCookie(pendingCookie) as { value: string | null }).value;
    if (!userId) return reply.code(401).send({ error: "invalid_mfa_cookie" });

    const row = await app.sqlRead`
      SELECT id, email, mfa_secret FROM users WHERE id = ${userId} AND mfa_enabled = true AND is_active = true`;
    if (row.count === 0) return reply.code(401).send({ error: "mfa_not_enabled" });

    if (!verifyMfaToken(row[0]!.mfa_secret as string, parsed.data.token)) {
      await app.sqlWrite`
        INSERT INTO auth_audit (user_id, action, ip_address, metadata)
        VALUES (${userId}, ${"mfa_failed"}, ${request.ip}::inet, ${app.sqlWrite.json({})})`;
      return reply.code(401).send({ error: "invalid_mfa_token" });
    }

    // Clear pending cookie, issue full session.
    reply.clearCookie(MFA_PENDING_COOKIE, { path: "/auth/mfa" });
    const session = await issueSession(userId, request.ip, request.headers["user-agent"] ?? null);
    setSessionCookies(reply, session);
    return reply.send({ user: session.user });
  });

  /**
   * POST /auth/mfa/setup
   * Generate a TOTP secret and QR code for the authenticated user.
   */
  app.post("/mfa/setup", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.sub;
    const existing = await app.sqlRead`
      SELECT mfa_enabled FROM users WHERE id = ${userId}`;
    if (existing.count === 0) return reply.code(404).send({ error: "user_not_found" });
    if (existing[0]!.mfa_enabled) return reply.code(409).send({ error: "mfa_already_enabled" });

    const { secret, otpauthUrl } = generateMfaSecret();
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    // Store the secret tentatively (not yet verified). MFA remains disabled
    // until the user proves ownership via /mfa/verify-setup.
    await app.sqlWrite`
      UPDATE users SET mfa_secret = ${secret} WHERE id = ${userId}`;

    return reply.send({ secret, otpauthUrl, qrDataUrl });
  });

  /**
   * POST /auth/mfa/verify-setup
   * Verify the TOTP code to enable MFA. Returns backup codes.
   */
  app.post("/mfa/verify-setup", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.sub;
    const parsed = mfaTokenBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const row = await app.sqlRead`
      SELECT mfa_secret, mfa_enabled FROM users WHERE id = ${userId}`;
    if (row.count === 0 || !row[0]!.mfa_secret) return reply.code(400).send({ error: "mfa_setup_not_started" });
    if (row[0]!.mfa_enabled) return reply.code(409).send({ error: "mfa_already_enabled" });

    if (!verifyMfaToken(row[0]!.mfa_secret as string, parsed.data.token)) {
      return reply.code(401).send({ error: "invalid_mfa_token" });
    }

    const backupCodes = generateBackupCodes();
    const hashedBackup = backupCodes.map(hashBackupCode);

    await app.sqlWrite`
      UPDATE users
      SET mfa_enabled = true,
          mfa_backup_codes = ${hashedBackup}::text[]
      WHERE id = ${userId}`;

    await app.sqlWrite`
      INSERT INTO auth_audit (user_id, action, ip_address)
      VALUES (${userId}, ${"mfa_enabled"}, ${request.ip}::inet)`;

    return reply.send({ backupCodes });
  });

  /**
   * POST /auth/mfa/disable
   * Requires the current password for security.
   */
  app.post("/mfa/disable", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.sub;
    const body = z.object({ password: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    const row = await app.sqlRead`
      SELECT password_hash FROM users WHERE id = ${userId}`;
    if (row.count === 0) return reply.code(404).send({ error: "user_not_found" });

    const ok = await verifyPassword(body.data.password, row[0]!.password_hash as string);
    if (!ok) return reply.code(401).send({ error: "invalid_password" });

    await app.sqlWrite`
      UPDATE users SET mfa_enabled = false, mfa_secret = null, mfa_backup_codes = '{}' WHERE id = ${userId}`;

    await app.sqlWrite`
      INSERT INTO auth_audit (user_id, action, ip_address)
      VALUES (${userId}, ${"mfa_disabled"}, ${request.ip}::inet)`;

    return reply.send({ disabled: true });
  });

  /**
   * POST /auth/mfa/backup-code
   * Use a backup code instead of a TOTP token for login-verify.
   */
  app.post("/mfa/backup-code", async (request, reply) => {
    const pendingCookie = (request as any).cookies?.[MFA_PENDING_COOKIE];
    if (!pendingCookie) return reply.code(401).send({ error: "mfa_not_pending" });
    const parsed = z.object({ code: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const userId = ((request as any).unsignCookie(pendingCookie) as { value: string | null }).value;
    if (!userId) return reply.code(401).send({ error: "invalid_mfa_cookie" });

    const row = await app.sqlRead`
      SELECT id, mfa_enabled, mfa_backup_codes FROM users WHERE id = ${userId} AND mfa_enabled = true`;
    if (row.count === 0) return reply.code(401).send({ error: "mfa_not_enabled" });

    const hashed = hashBackupCode(parsed.data.code);
    const codes = (row[0]!.mfa_backup_codes as string[]) ?? [];
    const idx = codes.indexOf(hashed);
    if (idx === -1) return reply.code(401).send({ error: "invalid_backup_code" });

    // Remove used backup code.
    const remaining = codes.filter((_, i) => i !== idx);
    await app.sqlWrite`
      UPDATE users SET mfa_backup_codes = ${remaining}::text[] WHERE id = ${userId}`;

    reply.clearCookie(MFA_PENDING_COOKIE, { path: "/auth/mfa" });
    const session = await issueSession(userId, request.ip, request.headers["user-agent"] ?? null);
    setSessionCookies(reply, session);
    return reply.send({ user: session.user, backupCodesRemaining: remaining.length });
  });

  /* -------------------------------------------------------------------------- */
  /*  Password change                                                           */
  /* -------------------------------------------------------------------------- */

  app.post("/password", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = passwordChangeBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });

    const userId = request.authUser!.sub;
    const row = await app.sqlRead`
      SELECT password_hash FROM users WHERE id = ${userId}`;
    if (row.count === 0) return reply.code(404).send({ error: "user_not_found" });

    const ok = await verifyPassword(parsed.data.currentPassword, row[0]!.password_hash as string);
    if (!ok) return reply.code(401).send({ error: "invalid_current_password" });

    const policy = validatePassword(parsed.data.newPassword);
    if (!policy.ok) return reply.code(400).send({ error: "weak_password", message: policy.reason });

    const newHash = await hashPassword(parsed.data.newPassword);
    await app.sqlWrite`
      UPDATE users SET password_hash = ${newHash}, updated_at = now() WHERE id = ${userId}`;

    // Revoke all sessions for this user.
    await app.sqlWrite`DELETE FROM sessions WHERE user_id = ${userId}`;

    await app.sqlWrite`
      INSERT INTO auth_audit (user_id, action, ip_address)
      VALUES (${userId}, ${"password_changed"}, ${request.ip}::inet)`;

    reply.clearCookie(ACCESS_COOKIE, { path: "/" });
    reply.clearCookie(REFRESH_COOKIE, { path: "/" });
    return reply.send({ changed: true, message: "Password updated. All sessions have been revoked. Please sign in again." });
  });

  /* -------------------------------------------------------------------------- */
  /*  Session management                                                        */
  /* -------------------------------------------------------------------------- */

  /**
   * GET /auth/sessions
   * List active sessions for the authenticated user. Does not expose tokens.
   */
  app.get("/sessions", { preHandler: [requireAuth] }, async (request) => {
    const userId = request.authUser!.sub;
    const rows = await app.sqlRead`
      SELECT id, ip_address::text AS "ipAddress",
             user_agent AS "userAgent",
             created_at::text AS "createdAt",
             refresh_expires_at::text AS "refreshExpiresAt"
      FROM sessions
      WHERE user_id = ${userId}
      ORDER BY created_at DESC`;
    return { sessions: rows };
  });

  /**
   * DELETE /auth/sessions/:id
   * Revoke a specific session owned by the authenticated user.
   */
  app.delete("/sessions/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.sub;
    const { id } = request.params as { id: string };
    const deleted = await app.sqlWrite`
      DELETE FROM sessions WHERE id = ${id}::uuid AND user_id = ${userId}
      RETURNING id`;
    if (deleted.count === 0) return reply.code(404).send({ error: "session_not_found" });

    await app.sqlWrite`
      INSERT INTO auth_audit (user_id, action, ip_address, metadata)
      VALUES (${userId}, ${"session_revoked"}, ${request.ip}::inet, ${app.sqlWrite.json({ revokedSessionId: id })})`;

    return reply.send({ revoked: true, id });
  });
}

export type { AccessTokenPayload };
