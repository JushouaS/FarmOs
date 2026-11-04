/**
 * Thin typed wrapper around the FARM_OS REST API.
 *
 * Every call sends credentials so the httpOnly session cookie is forwarded,
 * and prefixes the base URL (defaults to `http://localhost:4000`).
 *
 * This module is intentionally a plain client-side helper — no server functions.
 * Mutations (acknowledge, dismiss, mark-read) go through here so the UI can
 * optimistically update without a full page reload.
 */

import { NO_SPREAD, type WeightSpread } from "@/lib/farm/weights";

const API_BASE =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_API_URL) ||
  (typeof window !== "undefined"
    ? window.location.protocol === "https:"
      ? // A public https address (see scripts/public-gateway.mjs): the API is behind the same address, under /api.
        `${window.location.origin}/api`
      : // Same host that served the page, so LAN devices reach this machine's API.
        `${window.location.protocol}//${window.location.hostname}:4000`
    : "http://localhost:4000");

export class ApiError extends Error {
  /** `detail` is the API's own sentence about what was wrong, when it gave one. */
  constructor(public status: number, message: string, public detail?: string) {
    super(message);
    this.name = "ApiError";
  }
}

// The access cookie lasts 15 minutes and the refresh cookie 30 days, and a
// refresh token works only once. So every call that meets a 401 shares ONE
// renewal (kept for a few seconds for calls that arrive just after), then
// retries once with the new cookies.
let renewing: Promise<boolean> | null = null;

function renewSession(): Promise<boolean> {
  if (!renewing) {
    renewing = fetch(`${API_BASE}/auth/refresh`, { method: "POST", credentials: "include" })
      .then((res) => res.ok)
      .catch(() => false);
    setTimeout(() => {
      renewing = null;
    }, 5_000);
  }
  return renewing;
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const hasBody = init?.body !== undefined && init?.body !== null;
  const send = () =>
    fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...init,
      headers: {
        // Only when there is something to describe: a request with no body and
        // `application/json` is refused by the server before the handler runs,
        // which made every empty POST/DELETE look like a client error.
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  let res = await send();
  if (res.status === 401 && !path.startsWith("/auth/")) {
    // Retried even when this renewal failed: another request may have renewed
    // the cookies a moment earlier, which is why this one was refused.
    await renewSession();
    res = await send();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const fields = body as Record<string, unknown>;
    throw new ApiError(
      res.status,
      typeof fields.error === "string" ? fields.error : res.statusText,
      // `message` is the form-validation style answer; `detail` is the vision
      // service's own sentence, e.g. why a clip would not open.
      typeof fields.detail === "string"
        ? fields.detail
        : typeof fields.message === "string"
          ? fields.message
          : undefined,
    );
  }
  return res.json() as Promise<T>;
}

/* -------------------------------------------------------------------------- */
/*  Alerts                                                                    */
/* -------------------------------------------------------------------------- */

export interface ApiAlert {
  id: string;
  kind: string;
  severity: string;
  message: string;
  raisedAt: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  sourceIncidentId: string | null;
}

export interface ApiAlertDetail extends ApiAlert {
  /* returned from GET /alerts/:id alongside history */
}

export interface AlertHistoryEntry {
  action: string;
  at: string;
  byUserId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AlertDetailResponse {
  alert: ApiAlert;
  history: AlertHistoryEntry[];
}

export type AlertFilter = {
  severity?: string;
  acknowledged?: boolean;
  limit?: number;
};

export async function fetchAlerts(filters?: AlertFilter): Promise<ApiAlert[]> {
  const params = new URLSearchParams();
  if (filters?.severity) params.set("severity", filters.severity);
  if (filters?.acknowledged !== undefined)
    params.set("acknowledged", String(filters.acknowledged));
  if (filters?.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return apiFetch<ApiAlert[]>(`/alerts${qs ? `?${qs}` : ""}`);
}

export async function fetchAlertDetail(id: string): Promise<AlertDetailResponse> {
  return apiFetch<AlertDetailResponse>(`/alerts/${id}`);
}

// apiFetch sends a JSON content type, and the API rejects an empty JSON body, so
// these two post "{}".
export async function acknowledgeAlert(id: string): Promise<{ updated: boolean; reason?: string }> {
  return apiFetch(`/alerts/${encodeURIComponent(id)}/acknowledge`, { method: "POST", body: "{}" });
}

export async function dismissAlert(id: string): Promise<{ updated: boolean; reason?: string }> {
  return apiFetch(`/alerts/${encodeURIComponent(id)}/dismiss`, { method: "POST", body: "{}" });
}

/* -------------------------------------------------------------------------- */
/*  Grow-out cycle (Settings)                                                 */
/* -------------------------------------------------------------------------- */

export interface CycleSettingInfo {
  /** The day the flock was on when the setting was last applied. */
  startDay: number;
  /** The calendar date that was. */
  startedOn: string;
  /** Today's grow-out day. */
  day: number;
  endDay: number;
  minStartDay: number;
  defaultStartDay: number;
}

/** Set the day the flock is on today; it counts up from there. ADMIN and FARM_MANAGER only. */
export async function saveCycleStartDay(startDay: number): Promise<CycleSettingInfo> {
  return apiFetch("/settings/cycle", { method: "PUT", body: JSON.stringify({ startDay }) });
}

/* -------------------------------------------------------------------------- */
/*  Farm settings (Settings page)                                             */
/*  Every write below is ADMIN or FARM_MANAGER only; others get a 403.        */
/* -------------------------------------------------------------------------- */

export interface Lighting {
  /** When the day starts, local time, "HH:MM". */
  dayStart: string;
  /** When the night starts, local time, "HH:MM". */
  nightStart: string;
}

export async function saveLighting(lighting: Lighting): Promise<Lighting> {
  return apiFetch("/settings/lighting", { method: "PUT", body: JSON.stringify(lighting) });
}

/** The number of birds in each house. */
export async function saveFlockSize(houses: { id: string; population: number }[]): Promise<void> {
  await apiFetch("/settings/flock", { method: "PUT", body: JSON.stringify({ houses }) });
}

/**
 * The camera's RTSP link, as a page is allowed to see it: the login's password
 * is replaced by "***" before it ever leaves the server.
 */
export interface CameraSource {
  cameraId: string;
  /** e.g. rtsp://admin:***@192.168.1.108:554/cam/realmonitor?... */
  rtspUrl: string | null;
  /** "settings" when saved here, "environment" when it came from .env, "none". */
  source: "settings" | "environment" | "none";
  updatedAt: string | null;
}

/** What opening a candidate link produced. Only the camera service can answer this. */
export interface CameraSourceTest {
  ok: boolean;
  width?: number;
  height?: number;
  ms?: number;
  error?: string;
}

export async function fetchCameraSource(): Promise<CameraSource> {
  return apiFetch("/settings/camera");
}

/** Replace the link. An empty string clears it, which returns to the .env fallback. */
export async function saveCameraSource(rtspUrl: string): Promise<CameraSource> {
  return apiFetch("/settings/camera", { method: "PUT", body: JSON.stringify({ rtspUrl }) });
}

/** Ask the camera service to open the link once and report what came back. */
export async function testCameraSource(rtspUrl: string): Promise<CameraSourceTest> {
  return apiFetch("/visual/source-test", { method: "POST", body: JSON.stringify({ rtspUrl }) });
}

/** Change your own password. On success the API signs every session out, this one included. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiFetch("/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
}

/* -------------------------------------------------------------------------- */
/*  Accounts (administrator)                                                  */
/* -------------------------------------------------------------------------- */

export interface AccountRow {
  id: string;
  email: string;
  fullName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  passwordExpiresAt: string | null;
  role: string;
  roles: string[];
}

/** What came back after an account was made or its password reset: when the password stops working and whether the email went out. */
export interface AccountMail {
  expiresAt: string;
  email_sent: boolean;
  email_problem: string | null;
}

export async function listAccounts(): Promise<AccountRow[]> {
  const res = await apiFetch<{ users: AccountRow[] }>("/auth/users?limit=100");
  return res.users;
}

export async function createAccount(email: string, password: string, role: string): Promise<AccountMail> {
  return apiFetch<AccountMail>("/auth/register", { method: "POST", body: JSON.stringify({ email, password, roles: [role] }) });
}

export async function setAccountActive(id: string, isActive: boolean): Promise<void> {
  await apiFetch(`/auth/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ isActive }) });
}

export async function resetAccountPassword(id: string, newPassword: string): Promise<AccountMail> {
  return apiFetch<AccountMail>(`/auth/users/${encodeURIComponent(id)}/password`, { method: "POST", body: JSON.stringify({ newPassword }) });
}

/* -------------------------------------------------------------------------- */
/*  Notifications                                                             */
/* -------------------------------------------------------------------------- */

export interface ApiNotification {
  id: string;
  title: string;
  body: string;
  channel: string;
  kind: string;
  severity: string;
  relatedId: string | null;
  readAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface NotificationPreference {
  channel: string;
  enabled: boolean;
  minSeverity: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

export async function fetchNotifications(): Promise<ApiNotification[]> {
  return apiFetch<ApiNotification[]>("/notifications");
}

export async function markNotificationRead(
  id: string,
): Promise<{ updated: boolean }> {
  return apiFetch(`/notifications/${id}/read`, { method: "PATCH" });
}

export async function fetchNotificationPreferences(): Promise<NotificationPreference[]> {
  return apiFetch<NotificationPreference[]>("/notifications/preferences");
}

/** Which delivery channels this server can send on (email needs mail settings, push needs keys). */
export interface NotificationChannels {
  email: { configured: boolean };
  push: { configured: boolean };
}

export async function fetchNotificationChannels(): Promise<NotificationChannels> {
  return apiFetch<NotificationChannels>("/notifications/channels");
}

/** What happened to a test notice, per channel. */
export interface TestNotificationResult {
  in_app: { status: "sent" | "skipped" | "failed"; reason?: string };
  email: { status: "sent" | "skipped" | "failed"; reason?: string };
  push: { status: "sent" | "skipped" | "failed"; reason?: string };
}

/** Sends the signed-in person a test notice by the channels they turned on. */
export async function sendTestNotification(): Promise<TestNotificationResult> {
  return apiFetch<TestNotificationResult>("/notifications/test", { method: "POST", body: "{}" });
}

export async function fetchPushKey(): Promise<{ publicKey: string | null }> {
  return apiFetch<{ publicKey: string | null }>("/notifications/push/key");
}

export async function subscribePush(subscription: PushSubscriptionJSON): Promise<{ subscribed: boolean }> {
  return apiFetch("/notifications/push/subscribe", { method: "POST", body: JSON.stringify(subscription) });
}

export async function unsubscribePush(endpoint: string): Promise<{ subscribed: boolean }> {
  return apiFetch("/notifications/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) });
}

export async function saveNotificationPreferences(
  prefs: NotificationPreference[],
): Promise<{ updated: boolean; count: number }> {
  // The API replaces the whole list, and rejects null quiet hours (a missing field means none).
  const body = prefs.map(({ quietHoursStart, quietHoursEnd, ...rest }) => ({
    ...rest,
    ...(quietHoursStart ? { quietHoursStart } : {}),
    ...(quietHoursEnd ? { quietHoursEnd } : {}),
  }));
  return apiFetch("/notifications/preferences", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/* -------------------------------------------------------------------------- */
/*  Vision (proxied to Flask)                                                 */
/* -------------------------------------------------------------------------- */

export interface VisionHealth {
  status: string;
  cameras_configured: number;
  cameras_connected: number;
}

export interface VisionCameraStatus {
  camera_id: string;
  rtsp_url: string;
  connected: boolean;
}

export interface VisionDetection {
  box_x: number;
  box_y: number;
  box_w: number;
  box_h: number;
  behavior: string;
  confidence?: number;
  motion?: number;
  /** Set when the bird is standing inside a marked feeder/drinker zone. */
  zone?: string | null;
  estimated_weight_g: number | null;
  weight_confidence: number | null;
  flag: string | null;
}

/** The raw counts the verdict was derived from. */
export interface VisionMetrics {
  bird_count: number;
  zone_count: number;
  evaluable_count: number;
  inactive_count: number;
  huddled_count: number;
  movement_index: number;
  huddling_risk: number;
  huddling_coverage?: number;
  huddling_compactness?: number;
  huddle_radius_px?: number;
  confidence?: number;
  resolution?: [number, number];
  mean_luma?: number;
  global_shift?: number;
  zones?: number;
  model_loaded?: boolean;
}

export interface VisionBehavior {
  movement_index: number;
  movement_label: string;
  movement_status: string;
  huddling_risk: number;
  huddling_label: string;
  huddling_status: string;
  aggression_events: number;
  bird_count?: number;
  zone_count?: number;
  evaluable_count?: number;
  inactive_count?: number;
  huddled_count?: number;
  confidence?: number | null;
  /** True when the night rule suppressed the judgement. */
  night?: boolean;
  suppressed?: boolean;
  /** False when the picture or the model could not support a verdict. */
  reliable?: boolean;
  reason?: string | null;
}

export interface VisionWeight {
  median_g: number;
  std_dev_g: number;
  sample_size: number;
  confidence: number;
}

export interface VisionCluster {
  label: string;
  risk: number;
  /** "roi" from a motion-only scan, or the group's rectangle when the trained detector ran. */
  box: string | { x: number; y: number; width: number; height: number };
  /** How many birds are in this group (detector scans only). */
  birds?: number;
}

export interface AnalysisResult {
  camera_id: string;
  db_written: boolean;
  detections: VisionDetection[];
  detection_count: number;
  behaviour: VisionBehavior;
  metrics?: VisionMetrics;
  /** Guard results from the vision service, e.g. "camera_moved", "too_dark". */
  warnings?: string[];
  weight: VisionWeight | null;
  clusters: VisionCluster[];
  cluster_count: number;
}

/* -------------------------------------------------------------------------- */
/*  Feeder / drinker zones                                                    */
/* -------------------------------------------------------------------------- */

/** A polygon drawn over the camera picture, in normalised 0..1 coordinates. */
export interface CameraZone {
  id?: string;
  kind: "feeder" | "drinker";
  label: string;
  polygon: [number, number][];
  enabled: boolean;
}

export interface ZonesResponse {
  camera_id: string;
  zones: CameraZone[];
  /** Share of the frame the zones cover, 0..1. */
  coverage: number;
  /** Set when the drawing covers so much of the frame it is probably wrong. */
  warning?: string | null;
}

export async function getZones(cameraId: string): Promise<ZonesResponse> {
  return apiFetch<ZonesResponse>(`/visual/zones/${encodeURIComponent(cameraId)}`);
}

/** Replaces the camera's whole zone set — see the API route for why. */
export async function saveZones(
  cameraId: string,
  zones: Array<Omit<CameraZone, "id">>,
): Promise<ZonesResponse> {
  return apiFetch<ZonesResponse>(`/visual/zones/${encodeURIComponent(cameraId)}`, {
    method: "PUT",
    body: JSON.stringify({ zones }),
  });
}

/* -------------------------------------------------------------------------- */
/*  Behaviour over time                                                       */
/* -------------------------------------------------------------------------- */

export interface BehaviorSampleRow {
  at: string;
  movement_index: number;
  movement_label: string;
  movement_status: string;
  huddling_risk: number;
  huddling_label: string;
  huddling_status: string;
  bird_count: number | null;
  zone_count: number | null;
  evaluable_count: number | null;
  inactive_count: number | null;
  huddled_count: number | null;
  night: boolean;
  suppressed: boolean;
  reliable: boolean;
}

export interface BehaviorReport {
  camera_id: string;
  night: boolean;
  timezone: string;
  lighting: { dayStart: string; nightStart: string };
  latest: BehaviorSampleRow | null;
  recent: BehaviorSampleRow[];
  sustained: { inactivity: boolean; huddling: boolean; samples: number };
}

/** The stored verdicts for a camera, newest first, plus the rolling window. */
export async function getBehavior(cameraId: string): Promise<BehaviorReport> {
  return apiFetch<BehaviorReport>(`/visual/behavior/${encodeURIComponent(cameraId)}`);
}

export interface CaptureResult {
  camera_id: string;
  connected: boolean;
  image: string; // base64 JPEG
  content_type: string;
  size_bytes: number;
}

export async function checkVisionHealth(): Promise<VisionHealth> {
  return apiFetch<VisionHealth>("/visual/health");
}

export async function fetchVisionCameras(): Promise<VisionCameraStatus[]> {
  return apiFetch<VisionCameraStatus[]>("/visual/cameras");
}

export async function captureImage(cameraId: string): Promise<CaptureResult> {
  return apiFetch<CaptureResult>(`/visual/capture/${encodeURIComponent(cameraId)}`, {
    method: "POST",
  });
}

export async function analyzeFrame(cameraId: string): Promise<AnalysisResult> {
  return apiFetch<AnalysisResult>(`/visual/analyze/${encodeURIComponent(cameraId)}`, {
    method: "POST",
  });
}

/** A short-lived ticket for the Kinect depth stream, or null when the bridge asks for none. */
export async function fetchKinectTicket(): Promise<string | null> {
  const res = await apiFetch<{ ticket: string | null }>("/visual/kinect-ticket");
  return res.ticket;
}

/** One chicken the Kinect picture shows: where it is, as shares (0 to 1) of the picture's width and height. */
export interface KinectChicken {
  confidence: number;
  box: [number, number, number, number];
  polygon: [number, number][];
  /** Grams, estimated from the bird's size on the depth picture (about 18 % off for one bird), or null when it cannot be estimated. */
  weightG: number | null;
}

export interface KinectChickens {
  ok: boolean;
  /** Why there is no answer: "starting", "waiting_for_picture", "bridge_unreachable", "model_not_installed", "not_running", "error". */
  status?: string;
  message?: string;
  at?: number;
  width?: number;
  height?: number;
  count?: number;
  birds?: KinectChicken[];
  /** "ok", "no_depth" (no depth picture came), "model_not_installed" or "no_birds". */
  weightStatus?: string;
  /** The flock's average from the birds that have an estimate. It is much closer than one bird's estimate. */
  weight?: { n: number; meanG: number; medianG: number; errorPercent: number } | null;
}

/** The newest chicken outlines on the Kinect picture. Never throws: a program that is not running comes back as `ok: false`. */
export async function fetchKinectChickens(): Promise<KinectChickens> {
  try {
    return await apiFetch<KinectChickens>("/visual/kinect-chickens");
  } catch (err) {
    return { ok: false, status: err instanceof ApiError && err.status === 503 ? "not_running" : "error" };
  }
}

/** What the live behavior monitor on the camera computer sees right now (it is off unless LIVE_BEHAVIOR=1 there). */
export interface LiveBehavior {
  running: boolean;
  reason?: string;
  birds?: number;
  night?: boolean;
  inactive?: { id: number; still_seconds: number }[];
  flock_inactive?: { still_seconds: number } | null;
  huddle?: { birds: number; fdi: number; seconds: number; warning: boolean } | null;
}

/** The live monitor's picture. Never throws: a camera computer that is off or has the monitor off comes back as `running: false`. */
export async function fetchLiveBehavior(night: boolean): Promise<LiveBehavior> {
  try {
    return await apiFetch<LiveBehavior>(`/visual/behavior?night=${night ? 1 : 0}`);
  } catch {
    return { running: false, reason: "unreachable" };
  }
}

export interface SensorDay {
  /** YYYY-MM-DD, the database's day. */
  day: string;
  avg: number;
  min: number;
  max: number;
  n: number;
}

export interface SensorHistory {
  days: number;
  temperature: SensorDay[];
  humidity: SensorDay[];
}

/** The DHT22's stored readings, one point per day that has any. Empty lists when there are none or the API is away. */
export async function fetchSensorHistory(days = 7): Promise<SensorHistory> {
  try {
    return await apiFetch<SensorHistory>(`/operations/sensor-history?days=${days}`);
  } catch {
    return { days, temperature: [], humidity: [] };
  }
}

/** Build the MJPEG stream URL for a given camera (served via Fastify proxy). */
export function visionStreamUrl(cameraId: string): string {
  return `${API_BASE}/visual/stream/${encodeURIComponent(cameraId)}`;
}

/* -------------------------------------------------------------------------- */
/*  Clip testing                                                              */
/* -------------------------------------------------------------------------- */

/** What the vision service reports about a stored clip. */
export interface VisionClip {
  id: string;
  name: string;
  duration_s: number;
  fps: number;
  width: number;
  height: number;
  bytes: number;
  /** The most samples one sweep will take from this clip. */
  max_samples: number;
}

export interface VideoFrameResult {
  t: number;
  content_type: string;
  size_bytes: number;
  /** base64 JPEG, the same shape /visual/capture returns. */
  image: string;
}

export interface VideoAnalysisResult {
  clip: VisionClip;
  t: number;
  zone_camera: string;
  db_written: false;
  detections: VisionDetection[];
  detection_count: number;
  metrics: VisionMetrics;
  clusters: VisionCluster[];
  cluster_count: number;
  warnings?: string[];
  behaviour: VisionBehavior;
  /** Always false: a recording has no clock, so the night rule cannot apply. */
  night: false;
}

export interface VideoSampleReading {
  t: number;
  warnings: string[];
  behavior: VisionBehavior;
}

/** The clip's headline. A code, so the wording can be translated. */
export type VideoConclusion =
  | "no_samples"
  | "model_unavailable"
  | "nothing_usable"
  | "both_sustained"
  | "inactivity_sustained"
  | "huddling_sustained"
  | "inactivity_seen"
  | "huddling_seen"
  | "nothing_alarming";

export interface VideoSweepResult {
  clip: VisionClip;
  zone_camera: string;
  sampling: { requested: number; taken: number; truncated: boolean; delta_ms: number };
  /** False when no model is loaded — every sample then says so instead of counting. */
  model_loaded: boolean;
  night: false;
  samples: VideoSampleReading[];
  summary: {
    samples: number;
    usable: number;
    sustained: { inactivity: boolean; huddling: boolean; samples: number };
    conclusion: VideoConclusion;
  };
}

/**
 * Store a clip for testing.
 *
 * The file *is* the request body — the name travels in a header — which is
 * what keeps a 200 MB recording out of memory on both the browser and the
 * server. `apiFetch` retries a 401 by re-sending the whole request, and a
 * File can be read again, so a lapsed session costs one retry and no data.
 */
export async function uploadClip(file: File): Promise<VisionClip> {
  return apiFetch<VisionClip>("/visual/video", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      // A header cannot carry non-Latin-1, and "aso't manok (final).mp4"
      // should not arrive mangled at the other end.
      "X-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });
}

export async function getClip(clipId: string): Promise<VisionClip> {
  return apiFetch<VisionClip>(`/visual/video/${encodeURIComponent(clipId)}`);
}

/** Forget a clip now, rather than when its TTL runs out. */
export async function deleteClip(clipId: string): Promise<{ ok: boolean; clip_id: string }> {
  return apiFetch<{ ok: boolean; clip_id: string }>(
    `/visual/video/${encodeURIComponent(clipId)}`,
    { method: "DELETE" },
  );
}

/** One frame at `t`. Annotated, the detector's boxes are drawn on it. */
export async function clipFrame(
  clipId: string,
  t: number,
  annotate = true,
): Promise<VideoFrameResult> {
  const query = `t=${t}${annotate ? "&annotate=1" : ""}`;
  return apiFetch<VideoFrameResult>(
    `/visual/video/${encodeURIComponent(clipId)}/frame?${query}`,
  );
}

/** One measurement at `t`, judged by the same policy the camera uses. */
export async function analyzeClipAt(clipId: string, t: number): Promise<VideoAnalysisResult> {
  return apiFetch<VideoAnalysisResult>(
    `/visual/video/${encodeURIComponent(clipId)}/analyze?t=${t}`,
    { method: "POST" },
  );
}

/** The whole clip, sampled evenly and judged as a run. Writes nothing. */
export async function sweepClip(
  clipId: string,
  count?: number,
): Promise<VideoSweepResult> {
  const query = count ? `?count=${count}` : "";
  return apiFetch<VideoSweepResult>(
    `/visual/video/${encodeURIComponent(clipId)}/sweep${query}`,
    { method: "POST" },
  );
}

/** One sampled frame of a depth recording. `null` mass means the frame could not be read. */
export interface VideoWeightSample {
  t: number;
  mass_g: number | null;
  confidence: number | null;
  warnings?: string[];
}

/** The 3D weight estimation over a recorded Kinect depth clip. Writes nothing. */
export interface VideoWeightResult {
  clip: VisionClip;
  sampling: { requested: number; taken: number; truncated: boolean };
  per_frame: VideoWeightSample[];
  /** Real statistics across the sampled frames; `samples` is how many were usable. */
  summary: {
    median_g: number | null;
    std_dev_g: number | null;
    min_g: number | null;
    max_g: number | null;
    samples: number;
    confidence: number | null;
  };
}

/**
 * The clip's depth frames, sampled evenly and turned into one mass estimate
 * by the same line the live Kinect station uses. Writes nothing.
 */
export async function weighClip(
  clipId: string,
  count?: number,
): Promise<VideoWeightResult> {
  const query = count ? `?count=${count}` : "";
  return apiFetch<VideoWeightResult>(
    `/visual/video/${encodeURIComponent(clipId)}/weights${query}`,
    { method: "POST" },
  );
}

/* -------------------------------------------------------------------------- */
/*  Feedback (problem reports and the SUS questionnaire)                      */
/* -------------------------------------------------------------------------- */

export interface SusSubmission {
  respondent?: string;
  role?: string;
  /** Ten answers, 1 (strongly disagree) to 5 (strongly agree), in statement order. */
  answers: number[];
}

/** The score is worked out and stored on the server; respondents are not shown it. */
export async function submitSus(body: SusSubmission): Promise<void> {
  await apiFetch<{ ok: true }>("/feedback/sus", { method: "POST", body: JSON.stringify(body) });
}

export interface ReportSubmission {
  respondent?: string;
  role?: string;
  /** Route the person was on, so the report can be traced. */
  page?: string;
  problem: string;
}

export async function submitReport(body: ReportSubmission): Promise<void> {
  await apiFetch<{ ok: true }>("/feedback/report", { method: "POST", body: JSON.stringify(body) });
}

/* -------------------------------------------------------------------------- */
/*  Camera scan (Live Camera "Analysis")                                      */
/* -------------------------------------------------------------------------- */

export interface CameraScan extends AnalysisResult {
  /** What found the birds: the trained detector (`model`) or motion only, when the model is not installed. */
  detector?: { source: "model" | "motion"; model?: string };
  scan?: { samples: number; movement_min: number; movement_max: number; movement_mean: number };
}

/** Several analysis passes about a second apart, reduced to one result. Takes about 3 seconds. */
/** A bird's state in one frame: 0 moving, 1 resting (night), 2 inactive (alone, by day), 3 huddling, 4 inactivity (the whole flock, by day). */
export type BirdState = 0 | 1 | 2 | 3 | 4;

/** What the trained detector found in an uploaded video, frame by frame.
 *  Boxes are [x, y, w, h, confidence, class, bird number, state] in video pixels
 *  (the last two are missing when the camera computer is an older version). */
export interface VideoDetection {
  model: string;
  names: Record<string, string>;
  width: number;
  height: number;
  duration: number | null;
  analyzed_seconds: number;
  sample_fps: number;
  frames: { t: number; boxes: number[][]; fdi?: number }[];
  behavior?: {
    birds_followed: number;
    inactive_birds: { id: number; from: number; to: number }[];
    huddles: { start: number; end: number; birds: number; fdi: number }[];
    fdi_peak: number;
    fdi_warning: boolean;
    /** Average share of the flock that was moving, or null when the clip was too short to tell. */
    flock_moving: number | null;
    /** Share of the clip in which most of the flock was still, or null when it was too short to tell. */
    flock_still_share: number | null;
    params: { inactive_seconds: number; huddle_seconds: number; huddle_min_birds: number; fdi_warning: number; night?: boolean };
  };
  summary: { frames: number; frames_with_detections: number; max_per_frame: number; mean_per_frame: number };
}

/** Largest video the "Test video" button accepts (the API and the camera service enforce it too). */
export const DEMO_VIDEO_MAX_MB = 60;

/** Sends a video file to be checked by the trained detector. Nothing is stored.
 *  `night`: the clip was filmed with the lights off, so still birds count as resting. */
export async function detectVideo(file: File, night = false): Promise<VideoDetection> {
  return apiFetch<VideoDetection>(`/visual/demo-detect${night ? "?night=1" : ""}`, {
    method: "POST",
    body: file,
    headers: { "Content-Type": file.type.startsWith("video/") ? file.type : "application/octet-stream" },
  });
}

/** A weight a person measured for one bird on one grow-out day (Flock Tracking). */
export interface ActualWeight {
  birdId: string;
  day: number;
  actualG: number;
  /**
   * What the page used to estimate for the bird when the weight was entered. Only rows
   * written before the per-bird estimate was removed carry this; nothing reads it now.
   */
  estimatedG: number | null;
  recordedAt: string;
}

export async function fetchActualWeights(day: number): Promise<ActualWeight[]> {
  return apiFetch<ActualWeight[]>(`/growth/actual-weights?day=${encodeURIComponent(day)}`);
}

/** Each bird's latest weight from before a day (for the gain since then). */
export async function fetchPreviousWeights(day: number): Promise<{ birdId: string; day: number; actualG: number }[]> {
  return apiFetch(`/growth/actual-weights/previous?day=${encodeURIComponent(day)}`);
}

export async function saveActualWeight(input: { birdId: string; day: number; actualG: number; estimatedG?: number }): Promise<unknown> {
  return apiFetch("/growth/actual-weights", { method: "PUT", body: JSON.stringify(input) });
}

/** The weights typed in for the newest grow-out day that has any (NO_SPREAD-shaped when none, or when the API is away). */
export async function fetchWeightSpread(): Promise<WeightSpread> {
  try {
    return await apiFetch<WeightSpread>("/growth/weight-spread");
  } catch {
    return NO_SPREAD;
  }
}

export async function deleteActualWeight(birdId: string, day: number): Promise<unknown> {
  // The API rejects an empty JSON body, so one is sent.
  return apiFetch(`/growth/actual-weights?birdId=${encodeURIComponent(birdId)}&day=${encodeURIComponent(day)}`, { method: "DELETE", body: "{}" });
}

/** Re-encodes a video the browser cannot play as it is (MKV, AVI, a clip cut short) as a small MP4. */
export async function convertVideo(file: File): Promise<File> {
  const send = () =>
    fetch(`${API_BASE}/visual/demo-convert`, {
      method: "POST",
      credentials: "include",
      body: file,
      headers: { "Content-Type": file.type.startsWith("video/") ? file.type : "application/octet-stream" },
    });
  let res = await send();
  if (res.status === 401) {
    await renewSession();
    res = await send();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(res.status, typeof body.error === "string" ? body.error : res.statusText);
  }
  return new File([await res.blob()], file.name.replace(/\.[^.]+$/, "") + ".mp4", { type: "video/mp4" });
}

export async function scanCamera(cameraId: string): Promise<CameraScan> {
  // apiFetch sends a JSON content type, and the API rejects an empty JSON body.
  return apiFetch<CameraScan>(`/visual/scan/${encodeURIComponent(cameraId)}`, { method: "POST", body: "{}" });
}
