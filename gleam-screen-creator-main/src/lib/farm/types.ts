/**
 * Domain model for the FARM_OS console.
 *
 * Every figure rendered by the UI is described here once. Fields hold raw
 * values (numbers, ISO timestamps, enum codes) — never pre-formatted display
 * strings — so the same shapes can later be produced by a database driver
 * instead of the in-memory dataset. See `dataset.ts` for the current source of
 * truth and `repository.ts` for the swap-in seam.
 */

/** Qualitative state shared by sensors, cohorts and the flock as a whole. */
export type StatusLevel = "optimal" | "nominal" | "deviation" | "warning" | "critical";

export type TrendDirection = "up" | "down" | "flat";

export type SensorParameter =
  | "temperature"
  | "humidity"
  | "co2"
  | "nh3"
  | "light"
  | "airflow";

export interface House {
  /** Stable key used by every other record (`houseId`). */
  id: string;
  /** Human label, e.g. "House 02". */
  label: string;
  /** Analytics section code the house maps to, e.g. "SEC_B". */
  section: string;
  population: number;
}

export interface Facility {
  id: string;
  name: string;
  /** Display range covering all houses, e.g. "Houses 01-04". */
  houseRange: string;
  breed: string;
  houses: House[];
}

export interface FlockCycle {
  id: string;
  label: string;
  /** ISO date the grow-out started. */
  startDate: string;
  /** Grow-out day at `asOf`. */
  day: number;
  /** ISO date the flock is projected to reach target weight. */
  projectedYieldDate: string;
  /** Reporting window used by the analytics page. */
  windowStart: string;
  windowEnd: string;
  /** ISO timestamp every reading in the dataset is current as of. */
  asOf: string;
}

export interface PlatformStatus {
  appVersion: string;
  releaseChannel: string;
  apiVersion: string;
  mlModel: string;
  /** Label of the language model backing the intelligence engine. */
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
  /** Hourly index samples over the trailing 24h, oldest first. */
  series: number[];
  /** Axis captions rendered under the series. */
  axisLabels: string[];
}

export interface WeightAnalytics {
  actualAvgG: number;
  standardG: number;
  /** Signed percentage against `standardG`. */
  variancePercent: number;
  /** Confidence of the weight model itself. */
  modelConfidence: number;
  /** Confidence of the flock-wide estimation pipeline, 0-100. */
  estimationConfidencePercent: number;
  /** Number of birds contributing to the flock average. */
  sampleSize: number;
  status: StatusLevel;
  /** Growth curve, one point per sampled grow-out day. */
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
  /** Feed conversion ratio. */
  fcr: number;
  fcrTarget: number;
  /** Change in FCR versus the previous cycle day. */
  fcrDelta: number;
  /** Average daily gain in grams. */
  adgG: number;
  cycleNumber: number;
  cycleConsumedKg: number;
  /** Trailing FCR samples, oldest first. */
  series: number[];
}

export interface WaterMetrics {
  intakeLitresPerHour: number;
  status: StatusLevel;
  /** Trailing intake samples, oldest first. */
  series: number[];
}

export interface VolumetricSample {
  /** Depth sensor that produced the sample. */
  sensorId: string;
  /** Cohort the sampled bird belongs to. */
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
  /** Physical sensor identifier, format `SN-<serial>-<house>`. */
  sensorId: string;
  houseId: string;
  parameter: SensorParameter;
  /** Short console code, e.g. "AMMONIA_NH3". */
  code: string;
  /** Display label, e.g. "NH3". */
  label: string;
  value: number;
  unit: string;
  /** Acceptable operating range; `label` is the caption shown in reports. */
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
  /** Caption for the plan-view heatmap. */
  planViewLabel: string;
  /** Still frame used as the feed backdrop and social preview. */
  stillUrl: string;
  /** Mount coordinates within the house, printed on the feed overlay. */
  location: { x: number; y: number };
}

/** Bird tracked by the vision model in the live feed. */
export interface Detection {
  id: string;
  /** Overlay geometry in the feed's 1000x600 viewBox. */
  box: { x: number; y: number; width: number; height: number };
  behavior: string;
  /** Grams, like every other weight in the dataset. */
  estimatedWeightG: number;
  weightConfidence: number;
  /** Set when the bird trips a rule, e.g. "LOW_WEIGHT". */
  flag?: string;
}

export interface ClusterWarning {
  label: string;
  /** Risk score, 0-1. */
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
  /** Minutes the reading stayed above `peak.threshold`. */
  exceedanceMinutes: number;
  activityDropPercent: number;
  cause: string;
  resolution: string;
  status: "open" | "resolved_monitoring" | "closed";
  peak: {
    sensorId: string;
    parameter: SensorParameter;
    value: number;
    unit: string;
    threshold: number;
    baseline: number;
    /** Sensor samples around the excursion, oldest first. */
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
  /** Console category, e.g. "CRITICAL_EVENT". */
  kind: string;
  severity: StatusLevel;
  raisedAt: string;
  message: string;
  acknowledged: boolean;
  acknowledgedAt?: string | null;
  sourceIncidentId?: string | null;
  /** Actions offered on the alert card. */
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
  /** ISO timestamp of the playhead. */
  cursorAt: string;
  events: AnomalyEvent[];
}

export interface ReferenceDoc {
  id: string;
  quote: string;
  /** Threshold cited by the passage, in the sensor's unit. */
  citedThreshold: number;
  unit: string;
}

/** One row of the monitoring report's sensor findings table. */
export interface ReportFinding {
  id: string;
  parameter: string;
  /** Sensor and house the reading came from. */
  source: string;
  value: number;
  unit: string;
  /** Caption describing the acceptable range. */
  boundsLabel: string;
  status: StatusLevel;
}

export interface ReportMeta {
  id: string;
  groundingId: string;
  generatedAt: string;
  /** Timestamp of the most recent telemetry sweep. */
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

/** Executive summary inputs — the prose is composed in the UI from these. */
export interface FlockSummary {
  status: StatusLevel;
  confidence: number;
}

export interface FarmDataset {
  facility: Facility;
  cycle: FlockCycle;
  platform: PlatformStatus;
  summary: FlockSummary;
  activity: ActivityIndex;
  weight: WeightAnalytics;
  cohorts: Cohort[];
  feed: FeedMetrics;
  water: WaterMetrics;
  volumetric: VolumetricSample;
  environment: SensorReading[];
  cameras: CameraUnit[];
  detections: Detection[];
  clusterWarning: ClusterWarning;
  behavior: BehaviorMetrics;
  incidents: Incident[];
  alerts: SystemAlert[];
  timeline: AnomalyTimeline;
  references: ReferenceDoc[];
  report: ReportMeta;
  archive: ArchivedReport[];
}
