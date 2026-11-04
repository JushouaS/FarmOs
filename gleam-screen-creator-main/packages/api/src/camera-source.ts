import type { FastifyInstance } from "fastify";
import { env } from "./config.js";

/**
 * The camera the dashboard watches (CAM-01) and where its RTSP link comes from.
 *
 * The link carries the camera's login, so the full URL never leaves the server:
 * pages receive `rtspUrl` with the password replaced by "***" (see
 * `redactRtspUrl`). The two camera services — cerebroil-stream and
 * packages/vision — read the same `system_settings` row directly; that is what
 * makes a save in Settings apply without a restart.
 *
 * `.env`'s DAHUA_RTSP_URL stays as the fallback, so an installation that has
 * never opened Settings keeps working, and clearing the setting returns to it.
 */

export const CAMERA_ID = "CAM-01";

/** Where the link in force came from. */
export type CameraSourceOrigin = "settings" | "environment" | "none";

export interface CameraSource {
  cameraId: string;
  /** The full URL, login included. Never send this to a page. */
  rtspUrl: string | null;
  source: CameraSourceOrigin;
  /** When the setting was last written; null for the .env fallback. */
  updatedAt: string | null;
}

/** A URL with the login still on the server. */
export type PublicCameraSource = CameraSource;

const SCHEMES = new Set(["rtsp:", "rtsps:", "http:", "https:"]);

/**
 * An RTSP link — or an HTTP MJPEG source — that `URL` can actually parse.
 *
 * Whitespace is refused rather than trimmed away silently: a link pasted from
 * an email usually arrives with a newline in the middle, and "it worked until
 * the camera reopened" is a worse failure than being told to paste it again.
 */
export function looksLikeRtsp(value: string): boolean {
  const url = value.trim();
  if (!url || url.length > 2048 || /\s/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return SCHEMES.has(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/** The link with its password replaced by "***", so a page never holds the login. */
export function redactRtspUrl(value: string): string {
  const raw = value.trim();
  try {
    const url = new URL(raw);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    // Not parseable, but still not something to echo: scrape the userinfo out.
    return raw.replace(/(:\/\/[^:/@]*:)[^@]*@/, "$1***@");
  }
}

/** The link in force right now: the setting when it holds one, else .env, else none. */
export async function readCameraSource(app: FastifyInstance): Promise<CameraSource> {
  const rows = await app.sqlRead<{ value: unknown; updatedAt: string | null }[]>`
    SELECT value, updated_at::text AS "updatedAt"
    FROM system_settings WHERE key = 'camera'`;
  const row = rows[0];
  const stored =
    row && typeof row.value === "object" && row.value !== null && "rtspUrl" in row.value
      ? (row.value as { rtspUrl?: unknown }).rtspUrl
      : null;

  if (typeof stored === "string" && stored.trim() && looksLikeRtsp(stored)) {
    return { cameraId: CAMERA_ID, rtspUrl: stored.trim(), source: "settings", updatedAt: row?.updatedAt ?? null };
  }

  const fromEnv = (env.DAHUA_RTSP_URL ?? "").trim();
  if (fromEnv) {
    return { cameraId: CAMERA_ID, rtspUrl: fromEnv, source: "environment", updatedAt: null };
  }
  return { cameraId: CAMERA_ID, rtspUrl: null, source: "none", updatedAt: null };
}

/** What a page is allowed to see: the same shape, without the password. */
export function publicCameraSource(source: CameraSource): PublicCameraSource {
  return { ...source, rtspUrl: source.rtspUrl ? redactRtspUrl(source.rtspUrl) : null };
}
