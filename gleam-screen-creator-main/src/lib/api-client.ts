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

const API_BASE =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_API_URL) ||
  // Same host that served the page, so LAN devices reach this machine's API.
  (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:4000`
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
  const send = () =>
    fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...init,
      headers: {
        "Content-Type": "application/json",
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
      typeof fields.message === "string" ? fields.message : undefined,
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

/** Change your own password. On success the API signs every session out, this one included. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiFetch("/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
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
  estimated_weight_g: number | null;
  weight_confidence: number | null;
  flag: string | null;
}

export interface VisionBehavior {
  movement_index: number;
  movement_label: string;
  movement_status: string;
  huddling_risk: number;
  huddling_label: string;
  huddling_status: string;
  aggression_events: number;
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
  box: string;
}

export interface AnalysisResult {
  camera_id: string;
  db_written: boolean;
  detections: VisionDetection[];
  detection_count: number;
  behaviour: VisionBehavior;
  weight: VisionWeight | null;
  clusters: VisionCluster[];
  cluster_count: number;
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

/** Build the MJPEG stream URL for a given camera (served via Fastify proxy). */
export function visionStreamUrl(cameraId: string): string {
  return `${API_BASE}/visual/stream/${encodeURIComponent(cameraId)}`;
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
  scan?: { samples: number; movement_min: number; movement_max: number; movement_mean: number };
}

/** Several analysis passes about a second apart, reduced to one result. Takes about 3 seconds. */
export async function scanCamera(cameraId: string): Promise<CameraScan> {
  // apiFetch sends a JSON content type, and the API rejects an empty JSON body.
  return apiFetch<CameraScan>(`/visual/scan/${encodeURIComponent(cameraId)}`, { method: "POST", body: "{}" });
}
