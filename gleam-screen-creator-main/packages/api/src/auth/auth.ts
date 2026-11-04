import { compare, hash } from "bcrypt";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import * as speakeasy from "speakeasy";
import { env } from "../config.js";

/**
 * Authentication primitives — bcrypt for passwords, HS256 JWT for access
 * tokens, opaque random strings for refresh tokens, and TOTP for MFA.
 *
 * The refresh token is deliberately *not* a JWT: it is stored hashed in the
 * `sessions` table, and the raw value is returned to the client exactly once.
 * This keeps the server in control of the refresh lifecycle (rotation,
 * revocation on logout) without leaking expiry semantics into the client.
 */

const BCRYPT_ROUNDS = 12;

export const PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSymbol: true,
};

export function validatePassword(plain: string): { ok: true } | { ok: false; reason: string } {
  if (plain.length < PASSWORD_POLICY.minLength) {
    return { ok: false, reason: `Password must be at least ${PASSWORD_POLICY.minLength} characters` };
  }
  if (plain.length > PASSWORD_POLICY.maxLength) {
    return { ok: false, reason: `Password must be at most ${PASSWORD_POLICY.maxLength} characters` };
  }
  if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(plain)) {
    return { ok: false, reason: "Password must contain an uppercase letter" };
  }
  if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(plain)) {
    return { ok: false, reason: "Password must contain a lowercase letter" };
  }
  if (PASSWORD_POLICY.requireDigit && !/[0-9]/.test(plain)) {
    return { ok: false, reason: "Password must contain a digit" };
  }
  if (PASSWORD_POLICY.requireSymbol && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(plain)) {
    return { ok: false, reason: "Password must contain a special character" };
  }
  return { ok: true };
}

const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);

export interface AccessTokenPayload extends JWTPayload {
  sub: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hashStr: string): Promise<boolean> {
  return compare(plain, hashStr);
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    // A fresh id for each token: two sign-ins in the same second would otherwise make the same token, which the sessions table refuses.
    .setJti(randomUUID())
    .setExpirationTime(now + env.JWT_ACCESS_TTL_SECONDS)
    // iat is only second-granular, so two logins in the same second used to
    // sign to the exact same string. sessions.access_token is UNIQUE, so the
    // second one 500'd on a duplicate key. A per-token id makes every issued
    // session distinct regardless of timing.
    .setJti(randomUUID())
    .sign(jwtSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, jwtSecret);
  return payload as AccessTokenPayload;
}

/** Opaque refresh token — the client stores this raw, the server hashes it. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashRefreshToken(raw: string): string {
  // A fast, deterministic hash is fine for refresh tokens because the raw
  // value is high-entropy (48 bytes).
  return createHash("sha256").update(raw).digest("hex");
}

/* -------------------------------------------------------------------------- */
/*  MFA / TOTP helpers                                                        */
/* -------------------------------------------------------------------------- */

export function generateMfaSecret(): { secret: string; otpauthUrl: string } {
  const result = speakeasy.generateSecret({
    name: "CereBroiler",
    length: 32,
    issuer: "CereBroiler",
  });
  return {
    secret: result.base32,
    otpauthUrl: result.otpauth_url ?? speakeasy.otpauthURL({
      secret: result.base32,
      label: "CereBroiler",
      issuer: "CereBroiler",
      encoding: "base32",
    }),
  };
}

export function verifyMfaToken(secret: string, token: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token: token.replace(/\s/g, ""),
    window: 2,
  });
}

export function generateBackupCodes(count = 8): string[] {
  return Array.from({ length: count }, () => randomBytes(5).toString("hex").toUpperCase());
}

/** A key for one purpose, derived from the server's secret (so each purpose has its own). */
function derivedKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", env.JWT_SECRET, "farmos", purpose, 32));
}

/**
 * A backup code is stored as a keyed hash tied to the account, so a copy of the database cannot be checked
 * against a list of guesses, and the same code on two accounts does not give the same value.
 */
export function hashBackupCode(raw: string, userId: string): string {
  return "h2:" + createHmac("sha256", derivedKey("backup-code")).update(`${userId}:${raw.toUpperCase()}`).digest("hex");
}

/** The position of a backup code in the stored list. Codes saved before the keyed hash (plain SHA-256) still match. */
export function findBackupCode(stored: string[], raw: string, userId: string): number {
  const keyed = hashBackupCode(raw, userId);
  const legacy = createHash("sha256").update(raw.toUpperCase()).digest("hex");
  return stored.findIndex((h) => safeEqual(h, keyed) || safeEqual(h, legacy));
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const SEALED = "enc1:";

/** Encrypt a secret (the TOTP seed) for the database. */
export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey("mfa-secret"), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return SEALED + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Decrypt a stored secret. A value saved before encryption was added is returned as it is. */
export function openSecret(stored: string): string {
  if (!stored.startsWith(SEALED)) return stored;
  const raw = Buffer.from(stored.slice(SEALED.length), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", derivedKey("mfa-secret"), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export const isSealed = (stored: string): boolean => stored.startsWith(SEALED);

/** The sessions table keeps this, not the token itself, so a copy of the table cannot be used to sign in. */
export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
