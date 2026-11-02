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
  findBackupCode,
  hashAccessToken,
  sealSecret,
  openSecret,
  isSealed,
} from "../auth/auth.js";
import { randomBytes } from "node:crypto";
import { requireAuth, requireRole } from "../auth/middleware.js";
import type { AccessTokenPayload } from "../auth/auth.js";

/**
 * The version of the Privacy Policy people agree to. Change it whenever the policy
 * changes in a way that matters (src/routes/privacy.tsx): everyone is then asked to
 * agree again the next time they sign in.
 */
export const PRIVACY_VERSION = "2026-11-02";

const LOCKOUT_AFTER_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;

/**
 * Session + identity routes.
 *
 * POST /auth/register       (ADMIN only: creates an account, does not sign it in)
 * POST /auth/login
 * POST /auth/refresh
 * POST /auth/logout
 * POST /auth/password-reset/request
 * POST /auth/password-reset/confirm
 * GET  /auth/me             (auth required)
 */

const emailSchema = z.string().email().max(320);
const passwordSchema = z.string().min(12).max(128);

/** The roles an administrator can give a new account (the catalogue seeded in migration 0001). */
const ROLE_CODES = ["ADMIN", "FARM_MANAGER", "OPERATOR", "VIEWER"] as const;

const registerBody = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().max(160).optional(),
  roles: z.array(z.enum(ROLE_CODES)).min(1).max(ROLE_CODES.length).default(["VIEWER"]),
});

/**
 * Whether a request comes from the computer the API runs on (it reaches the API through localhost, or through
 * this computer's own network address). It looks at the socket, not at request.ip: with trustProxy on, request.ip
 * follows an X-Forwarded-For header that anyone can write.
 */
function fromThisComputer(request: { raw: { socket: { remoteAddress?: string; localAddress?: string } } }): boolean {
  const { remoteAddress, localAddress } = request.raw.socket;
  if (!remoteAddress) return false;
  const strip = (a: string) => a.replace(/^::ffff:/, "");
  const remote = strip(remoteAddress);
  return remote === "127.0.0.1" || remote === "::1" || (!!localAddress && remote === strip(localAddress));
}

/** Account the development-only "admin" / "admin" login maps to (see /login). */
const DEV_ADMIN_EMAIL = "admin@cerebroiler.dev";

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
  secure: env.cookieSecure,
  sameSite: "strict" as const,
  path: "/",
  maxAge: env.JWT_ACCESS_TTL_SECONDS,
};

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: "strict" as const,
  path: "/",
  maxAge: Number(process.env.JWT_REFRESH_TTL_SECONDS ?? 30 * 24 * 60 * 60),
};

const MFA_PENDING_COOKIE = "farm_mfa_pending";
const MFA_COOKIE_OPTS = {
  httpOnly: true,
  secure: env.cookieSecure,
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
      VALUES (${row.id}, ${hashAccessToken(accessToken)}, ${refreshHash}, ${expiresAt.toISOString()}, ${ip}::inet, ${ua})
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

  /* ---- too many wrong tries ------------------------------------------------------------
   * Five wrong tries in 30 minutes lock the sign-in for that email from that network address
   * (the second step: for that account, from anywhere). It is kept per address so someone
   * guessing cannot lock the real person out from their own place, and it counts emails
   * with no account the same way, so the answers give nothing away about who has one. */
  const FAIL_LIMIT = 5;
  const FAIL_WINDOW_MS = 30 * 60 * 1000;

  async function failureState(subject: string, ip: string | null) {
    const rows = ip
      ? await app.sqlRead`
          SELECT failed_at FROM login_failures
          WHERE subject = ${subject} AND ip_address = ${ip}::inet AND failed_at > now() - interval '30 minutes'
          ORDER BY failed_at DESC LIMIT ${FAIL_LIMIT}`
      : await app.sqlRead`
          SELECT failed_at FROM login_failures
          WHERE subject = ${subject} AND failed_at > now() - interval '30 minutes'
          ORDER BY failed_at DESC LIMIT ${FAIL_LIMIT}`;
    const locked = rows.length >= FAIL_LIMIT;
    const lockedUntil = locked ? new Date(new Date(rows[FAIL_LIMIT - 1]!.failed_at as string).getTime() + FAIL_WINDOW_MS).toISOString() : null;
    return { count: rows.length, locked, lockedUntil };
  }

  async function recordFailure(subject: string, ip: string | null) {
    await app.sqlWrite`INSERT INTO login_failures (subject, ip_address) VALUES (${subject}, ${ip}::inet)`;
  }

  async function clearFailures(subject: string, ip: string | null) {
    if (ip) await app.sqlWrite`DELETE FROM login_failures WHERE subject = ${subject} AND ip_address = ${ip}::inet`;
    else await app.sqlWrite`DELETE FROM login_failures WHERE subject = ${subject}`;
  }

  // Checked against when an email has no account, so a wrong email takes as long to refuse as a wrong password.
  const decoyHash = hashPassword(randomBytes(16).toString("hex"));

  // Only an administrator creates accounts. It used to be open to anyone, with the roles taken from the
  // request, so anyone could make themselves an ADMIN. The new account is not signed in: the caller keeps their own session.
  app.post("/register", { ...loginRateLimit, preHandler: [requireAuth, requireRole("ADMIN")] }, async (request, reply) => {
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

    await app.sqlWrite`
      INSERT INTO auth_audit (user_id, action, ip_address, metadata)
      VALUES (${request.authUser!.sub}, ${"user_created"}, ${request.ip}::inet, ${app.sqlWrite.json({ createdUserId: userId, roles })})`;
    return reply.code(201).send({ user: { id: userId, email, roles } });
  });

  app.post("/login", { ...loginRateLimit }, async (request, reply) => {
    // Development-only shortcut matching the "admin / admin" demo hint on the
    // sign-in page: signs in as the seeded admin without touching its real
    // password. Never active outside NODE_ENV=development, and only for a request
    // made from this computer: another device on the network cannot use it.
    const body = request.body as { email?: unknown; password?: unknown } | undefined;
    if (env.NODE_ENV === "development" && body?.email === "admin" && body?.password === "admin" && fromThisComputer(request)) {
      const admin = await app.sqlRead`
        SELECT id FROM users WHERE email = ${DEV_ADMIN_EMAIL} AND is_active`;
      if (admin.count === 0) return reply.code(401).send({ error: "invalid_credentials" });
      await app.sqlWrite`
        INSERT INTO auth_audit (user_id, action, ip_address, metadata)
        VALUES (${admin[0]!.id}, ${"login_dev_admin"}, ${request.ip}::inet, ${app.sqlWrite.json({})})`;
      const session = await issueSession(admin[0]!.id as string, request.ip, request.headers["user-agent"] ?? null);
      setSessionCookies(reply, session);
      return reply.send({ user: session.user });
    }

    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    const { email, password } = parsed.data;
    const subject = email.toLowerCase();

    const state = await failureState(subject, request.ip);
    if (state.locked) {
      await app.sqlWrite`
        INSERT INTO auth_audit (action, ip_address, metadata)
        VALUES (${"login_refused_locked"}, ${request.ip}::inet, ${app.sqlWrite.json({ email: subject })})`;
      return reply.code(403).send({
        error: "account_locked",
        lockedUntil: state.lockedUntil,
        message: `Too many failed attempts. Try again after ${state.lockedUntil}.`,
      });
    }

    const found = await app.sqlRead`
      SELECT id, password_hash, is_active, mfa_enabled, mfa_secret
      FROM users WHERE email = ${email}`;
    const row = found.count > 0 ? found[0]! : null;
    // The password is always checked (against a decoy when there is no such account), and a missing account, a
    // wrong password and a disabled account all get the same answer.
    const ok = await verifyPassword(password, row ? (row.password_hash as string) : await decoyHash);
    if (!row || !ok || !row.is_active) {
      await recordFailure(subject, request.ip);
      await app.sqlWrite`
        INSERT INTO auth_audit (user_id, action, ip_address, metadata)
        VALUES (${row ? (row.id as string) : null}, ${!row ? "login_failed_unknown" : !row.is_active ? "login_failed_disabled" : "login_failed_password"},
                ${request.ip}::inet, ${app.sqlWrite.json({ email: subject, attempts: state.count + 1 })})`;
      return reply.code(401).send({
        error: "invalid_credentials",
        attemptsRemaining: Math.max(0, FAIL_LIMIT - (state.count + 1)),
      });
    }

    // Correct password: forget the wrong tries from this address.
    await clearFailures(subject, request.ip);

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
      DELETE FROM sessions WHERE access_token IN (${hashAccessToken(token)}, ${token}) RETURNING id`;
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
      SELECT id, email, full_name, avatar_url, analysis_language, last_login_at, created_at,
             EXISTS (
               SELECT 1 FROM privacy_consents c
               WHERE c.user_id = users.id AND c.version = ${PRIVACY_VERSION}
             ) AS privacy_accepted
      FROM users WHERE id = ${user.sub}`;
    return {
      user: row[0],
      roles: user.roles,
      permissions: user.permissions,
    };
  });

  /**
   * POST /auth/privacy
   * The signed-in person agrees to the current Privacy Policy. Saved once per person and
   * version (agreeing again changes nothing), with the time, and noted in the sign-in log.
   */
  app.post("/privacy", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.sub;
    const saved = await app.sqlWrite`
      INSERT INTO privacy_consents (user_id, version, ip_address)
      VALUES (${userId}, ${PRIVACY_VERSION}, ${request.ip}::inet)
      ON CONFLICT (user_id, version) DO NOTHING
      RETURNING version`;
    if (saved.count > 0) {
      await app.sqlWrite`
        INSERT INTO auth_audit (user_id, action, ip_address, metadata)
        VALUES (${userId}, ${"privacy_accepted"}, ${request.ip}::inet, ${app.sqlWrite.json({ version: PRIVACY_VERSION })})`;
    }
    return reply.send({ accepted: true, version: PRIVACY_VERSION });
  });

  /**
   * PATCH /auth/me
   * The signed-in person's own profile: their name and the language the Live
   * Camera analysis shows in. Either field can be sent alone.
   */
  const profileBody = z
    .object({
      fullName: z.string().trim().min(1).max(160).optional(),
      analysisLanguage: z.enum(["en", "tl", "ceb"]).optional(),
    })
    .refine((b) => b.fullName !== undefined || b.analysisLanguage !== undefined, { message: "nothing_to_change" });

  app.patch("/me", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = profileBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_profile", message: "Give a name (1 to 160 characters) or a language (en, tl or ceb)." });
    }
    const row = await app.sqlWrite`
      UPDATE users
      SET full_name = COALESCE(${parsed.data.fullName ?? null}, full_name),
          analysis_language = COALESCE(${parsed.data.analysisLanguage ?? null}, analysis_language),
          updated_at = now()
      WHERE id = ${request.authUser!.sub}
      RETURNING id, email, full_name, avatar_url, analysis_language`;
    if (row.count === 0) return reply.code(404).send({ error: "user_not_found" });
    return reply.send({ user: row[0] });
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

    // Wrong codes are counted per account, from any address: six digits can be guessed otherwise.
    const mfaSubject = `mfa:${userId}`;
    const mfaState = await failureState(mfaSubject, null);
    if (mfaState.locked) return reply.code(429).send({ error: "too_many_attempts", lockedUntil: mfaState.lockedUntil });

    const secret = row[0]!.mfa_secret as string;
    if (!verifyMfaToken(openSecret(secret), parsed.data.token)) {
      await recordFailure(mfaSubject, request.ip);
      await app.sqlWrite`
        INSERT INTO auth_audit (user_id, action, ip_address, metadata)
        VALUES (${userId}, ${"mfa_failed"}, ${request.ip}::inet, ${app.sqlWrite.json({})})`;
      return reply.code(401).send({ error: "invalid_mfa_token" });
    }
    await clearFailures(mfaSubject, null);
    // A secret saved before secrets were encrypted is encrypted now.
    if (!isSealed(secret)) await app.sqlWrite`UPDATE users SET mfa_secret = ${sealSecret(secret)} WHERE id = ${userId}`;

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
      UPDATE users SET mfa_secret = ${sealSecret(secret)} WHERE id = ${userId}`;

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

    if (!verifyMfaToken(openSecret(row[0]!.mfa_secret as string), parsed.data.token)) {
      return reply.code(401).send({ error: "invalid_mfa_token" });
    }

    const backupCodes = generateBackupCodes();
    const hashedBackup = backupCodes.map((code) => hashBackupCode(code, userId));

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
  app.post("/mfa/backup-code", { ...loginRateLimit }, async (request, reply) => {
    const pendingCookie = (request as any).cookies?.[MFA_PENDING_COOKIE];
    if (!pendingCookie) return reply.code(401).send({ error: "mfa_not_pending" });
    const parsed = z.object({ code: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const userId = ((request as any).unsignCookie(pendingCookie) as { value: string | null }).value;
    if (!userId) return reply.code(401).send({ error: "invalid_mfa_cookie" });

    const row = await app.sqlRead`
      SELECT id, mfa_enabled, mfa_backup_codes FROM users WHERE id = ${userId} AND mfa_enabled = true`;
    if (row.count === 0) return reply.code(401).send({ error: "mfa_not_enabled" });

    // Backup codes share the wrong-code count of the second step.
    const mfaSubject = `mfa:${userId}`;
    const mfaState = await failureState(mfaSubject, null);
    if (mfaState.locked) return reply.code(429).send({ error: "too_many_attempts", lockedUntil: mfaState.lockedUntil });

    const codes = (row[0]!.mfa_backup_codes as string[]) ?? [];
    const idx = findBackupCode(codes, parsed.data.code, userId);
    if (idx === -1) {
      await recordFailure(mfaSubject, request.ip);
      return reply.code(401).send({ error: "invalid_backup_code" });
    }
    await clearFailures(mfaSubject, null);

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
   * GET /auth/users
   * Paginated user list (id, email, role). Restricted to ADMIN role.
   *
   * Query params:
   *   limit  — number of rows per page (1-100, default 50)
   *   offset — row offset for pagination (default 0)
   */
  const usersQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });

  app.get("/users", { preHandler: [requireAuth, requireRole("ADMIN")] }, async (request, reply) => {
    const parsed = usersQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query", issues: parsed.error.issues });
    const { limit, offset } = parsed.data;

    const rows = await app.sqlRead`
      SELECT u.id, u.email,
             COALESCE(
               (SELECT r.code FROM roles r
                INNER JOIN user_roles ur ON ur.role_id = r.id
                WHERE ur.user_id = u.id
                ORDER BY r.code
                LIMIT 1),
               'VIEWER'
             ) AS role
      FROM users u
      ORDER BY u.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`;

    const total = await app.sqlRead`SELECT COUNT(*)::int AS count FROM users`;
    return { users: rows, total: total[0]!.count as number, limit, offset };
  });

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
