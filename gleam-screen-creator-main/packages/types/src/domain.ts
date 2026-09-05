/**
 * Shared domain model for FARM_OS.
 *
 * A single source of truth for every value shape exchanged between the API,
 * the frontend repository handlers, and any future client. Fields hold raw
 * values (numbers, ISO timestamps, enum codes) — never pre-formatted strings.
 *
 * These types mirror the `src/lib/farm/types.ts` in the frontend; during the
 * runtime swap from the in-memory dataset to the API, both sides import from
 * this package so that compiler errors surface any drift immediately.
 */

/** Qualitative state shared by sensors, cohorts and the flock as a whole. */
export type StatusLevel =
  | "optimal"
  | "nominal"
  | "deviation"
  | "warning"
  | "critical";

export type TrendDirection = "up" | "down" | "flat";

export type SensorParameter =
  | "temperature"
  | "humidity"
  | "co2"
  | "nh3"
  | "light"
  | "airflow";

export type IncidentStatus = "open" | "resolved_monitoring" | "closed";

export type AlertKind =
  | "CRITICAL_EVENT"
  | "DEVIATION_LOG"
  | "ENV_REPORT"
  | "FEED_CYCLE"
  | "SENSOR_FAULT"
  | "SYSTEM";

export type NotificationChannel = "in_app" | "email" | "push" | "sms";

export interface House {
  id: string;
  label: string;
  section: string;
  population: number;
}

export interface Facility {
  id: string;
  name: string;
  houseRange: string;
  breed: string;
  houses: House[];
}

export interface FlockCycle {
  id: string;
  label: string;
  startDate: string;
  day: number;
  projectedYieldDate: string;
  windowStart: string;
  windowEnd: string;
  asOf: string;
}

export interface PlatformStatus {
  appVersion: string;
  releaseChannel: string;
  apiVersion: string;
  mlModel: string;
  llm: string;
  inferenceLatencyMs: number;
  cpuPercent: number;
  ramGb: number;
  status: StatusLevel;
}

export interface ActivityIndex {
  value: number;
  unit: string;
  baseline: number;
  trend: TrendDirection;
  series: number[];
  axisLabels: string[];
}

export interface WeightAnalytics {
  actualAvgG: number;
  standardG: number;
  variancePercent: number;
  modelConfidence: number;
  estimationConfidencePercent: number;
  sampleSize: number;
  status: StatusLevel;
  curve: { day: number; actualG: number; standardG: number }[];
}

export interface Cohort {
  id: string;
  houseId: string;
  minG: number;
  maxG: number;
  standardDeviationG: number;
  medianG: number;
  status: StatusLevel;
}

export interface FeedMetrics {
  fcr: number;
  fcrTarget: number;
  fcrDelta: number;
  adgG: number;
  cycleNumber: number;
  cycleConsumedKg: number;
  series: number[];
}

export interface WaterMetrics {
  intakeLitresPerHour: number;
  status: StatusLevel;
  series: number[];
}

export interface VolumetricSample {
  sensorId: string;
  cohortId: string;
  breastWidthMm: number;
  totalLengthMm: number;
  depthZMm: number;
  calculatedMassG: number;
  morphologicalIndex: number;
  densityRatio: number;
  precisionPercent: number;
}

export interface SensorReading {
  sensorId: string;
  houseId: string;
  parameter: SensorParameter;
  code: string;
  label: string;
  value: number;
  unit: string;
  bounds: { min?: number; max?: number; label: string };
  status: StatusLevel;
  recordedAt: string;
}

export interface CameraUnit {
  id: string;
  houseId: string;
  fps: number;
  resolution: string;
  online: boolean;
  depthPointsPerFrame: number;
  birdsScanned: number;
  planViewLabel: string;
  stillUrl: string;
  location: { x: number; y: number };
}

export interface Detection {
  id: string;
  box: { x: number; y: number; width: number; height: number };
  behavior: string;
  estimatedWeightG: number;
  weightConfidence: number;
  flag?: string;
}

export interface ClusterWarning {
  label: string;
  risk: number;
  box: { x: number; y: number; width: number; height: number };
}

export interface BehaviorMetrics {
  movementIndex: number;
  movementLabel: string;
  movementStatus: StatusLevel;
  huddlingRisk: number;
  huddlingLabel: string;
  huddlingStatus: StatusLevel;
  aggressionEvents: number;
}

export interface Incident {
  id: string;
  houseId: string;
  title: string;
  startedAt: string;
  endedAt: string;
  exceedanceMinutes: number;
  activityDropPercent: number;
  cause: string;
  resolution: string;
  status: IncidentStatus;
  peak: {
    sensorId: string;
    parameter: SensorParameter;
    value: number;
    unit: string;
    threshold: number;
    baseline: number;
    series: number[];
  };
  evidence: {
    cameraId: string;
    clipId: string;
    capturedAt: string;
    detectionLabel: string;
    detectionConfidence: number;
    imageUrl: string;
  };
}

export interface SystemAlert {
  id: string;
  kind: AlertKind | string;
  severity: StatusLevel;
  raisedAt: string;
  message: string;
  acknowledged: boolean;
  actions?: string[];
}

export interface AnomalyEvent {
  id: string;
  at: string;
  severity: StatusLevel;
  label: string;
}

export interface AnomalyTimeline {
  windowStart: string;
  windowEnd: string;
  cursorAt: string;
  events: AnomalyEvent[];
}

export interface ReferenceDoc {
  id: string;
  quote: string;
  citedThreshold: number;
  unit: string;
}

export interface ReportFinding {
  id: string;
  parameter: string;
  source: string;
  value: number;
  unit: string;
  boundsLabel: string;
  status: StatusLevel;
}

export interface ReportMeta {
  id: string;
  groundingId: string;
  generatedAt: string;
  lastScanAt: string;
}

export interface ArchivedReport {
  id: string;
  icon: string;
  format: string;
  title: string;
  generatedAt: string;
  sizeMb: number;
  featured?: boolean;
  note?: string;
}

export interface FlockSummary {
  status: StatusLevel;
  confidence: number;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  channel: NotificationChannel;
  kind: string;
  severity: StatusLevel;
  relatedId?: string;
  readAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface UserIdentity {
  id: string;
  email: string;
  fullName: string | null;
  roles: string[];
  permissions: string[];
}
