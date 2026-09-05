import { compare, hash } from "bcrypt";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { createHash, randomBytes } from "node:crypto";
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
    .setExpirationTime(now + env.JWT_ACCESS_TTL_SECONDS)
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

export function hashBackupCode(raw: string): string {
  return createHash("sha256").update(raw.toUpperCase()).digest("hex");
}
