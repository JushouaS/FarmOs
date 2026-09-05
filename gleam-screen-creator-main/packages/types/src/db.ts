/**
 * Database row types.
 *
 * These describe the column shape of each table as returned by `postgres.js`.
 * They are intentionally "snake_case" mirrors of the domain interfaces in
 * `domain.ts`; the service layer maps row -> domain.
 *
 * Keeping them separate from the domain types lets us:
 *   - change a column name without breaking API responses;
 *   - store denormalised display labels without leaking them upstream;
 *   - keep the JSON/JSONB columns typed narrowly (`Record<string, unknown>`).
 */

import type { StatusLevel } from "./domain.js";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  last_login_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
}

export interface UserRoleRow {
  user_id: string;
  role_id: string;
}

export interface PermissionRow {
  id: string;
  code: string;
  resource: string;
  action: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  refresh_expires_at: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface FacilityRow {
  id: string;
  name: string;
  breed: string;
  house_range_label: string;
  timezone: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  metadata: Record<string, unknown> | null;
}

export interface HouseRow {
  id: string;
  facility_id: string;
  label: string;
  section: string;
  population: number;
  sort_order: number;
  is_active: boolean;
}

export interface FlockCycleRow {
  id: string;
  facility_id: string;
  label: string;
  breed: string | null;
  start_date: string;
  projected_yield_date: string | null;
  ended_at: string | null;
  status: "active" | "completed" | "abandoned";
}

export interface CycleWeightRow {
  cycle_id: string;
  day: number;
  actual_g: number;
  standard_g: number;
  sample_size: number | null;
  estimation_confidence: number | null;
  recorded_at: string;
}

export interface CohortRow {
  id: string;
  cycle_id: string;
  house_id: string;
  min_g: number;
  max_g: number;
  standard_deviation_g: number;
  median_g: number;
  status: StatusLevel;
}

export interface SensorTypeRow {
  code: string;
  label: string;
  unit: string;
  display_format: string | null;
}

export interface SensorRow {
  id: string;
  house_id: string;
  sensor_type_code: string;
  code: string;
  label: string | null;
  location_x: number | null;
  location_y: number | null;
  serial: string | null;
  installed_at: string | null;
  decommissioned_at: string | null;
}

export interface SensorBoundRow {
  sensor_id: string;
  lower_bound: number | null;
  upper_bound: number | null;
  display_label: string;
  effective_from: string;
  effective_to: string | null;
}

export interface SensorReadingRow {
  id: string;
  sensor_id: string;
  value: number;
  unit: string;
  status: StatusLevel;
  recorded_at: string;
  ingested_at: string;
}

export interface CameraRow {
  id: string;
  house_id: string;
  mount_x: number | null;
  mount_y: number | null;
  fps: number | null;
  resolution: string | null;
  depth_points_per_frame: number | null;
  plan_view_label: string | null;
  still_url: string | null;
  online: boolean;
  last_heartbeat_at: string | null;
}

export interface DetectionRow {
  id: string;
  camera_id: string;
  frame_at: string;
  box_x: number;
  box_y: number;
  box_w: number;
  box_h: number;
  behavior: string;
  estimated_weight_g: number | null;
  weight_confidence: number | null;
  flag: string | null;
}

export interface IncidentRow {
  id: string;
  house_id: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  exceedance_minutes: number | null;
  activity_drop_percent: number | null;
  cause: string | null;
  resolution: string | null;
  status: "open" | "resolved_monitoring" | "closed";
}

export interface IncidentPeakRow {
  id: string;
  incident_id: string;
  sensor_id: string;
  parameter: string;
  value: number;
  unit: string;
  threshold: number;
  baseline: number;
}

export interface IncidentEvidenceRow {
  id: string;
  incident_id: string;
  camera_id: string;
  clip_id: string | null;
  captured_at: string;
  detection_label: string | null;
  detection_confidence: number | null;
  image_url: string | null;
}

export interface AlertRow {
  id: string;
  facility_id: string;
  kind: string;
  severity: StatusLevel;
  message: string;
  raised_at: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  source_incident_id: string | null;
}

export interface AnomalyEventRow {
  id: string;
  facility_id: string;
  at: string;
  severity: StatusLevel;
  label: string;
  source_incident_id: string | null;
}

export interface MonitoringReportRow {
  id: string;
  facility_id: string;
  grounding_id: string;
  generated_at: string;
  last_scan_at: string;
  generated_by: string | null;
}

export interface ReportFindingRow {
  id: string;
  report_id: string;
  parameter: string;
  source_label: string;
  value: number;
  unit: string;
  bounds_label: string;
  status: StatusLevel;
  sort_order: number;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  title: string;
  body: string;
  channel: "in_app" | "email" | "push" | "sms";
  kind: string | null;
  severity: StatusLevel | null;
  related_id: string | null;
  read_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  at: string;
}
