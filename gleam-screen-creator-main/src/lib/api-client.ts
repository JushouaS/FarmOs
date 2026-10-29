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
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as Record<string, string>).error ?? res.statusText);
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

export async function acknowledgeAlert(id: string): Promise<{ updated: boolean; reason?: string }> {
  return apiFetch(`/alerts/${id}/acknowledge`, { method: "POST" });
}

export async function dismissAlert(id: string): Promise<{ updated: boolean; reason?: string }> {
  return apiFetch(`/alerts/${id}/dismiss`, { method: "POST" });
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
  return apiFetch("/notifications/preferences", {
    method: "PUT",
    body: JSON.stringify(prefs),
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
