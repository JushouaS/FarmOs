import type { FarmDataset, SensorReading, StatusLevel } from "./types";

/**
 * Cerebroil seed dataset — 28 Ross 308 broilers, Pen 1.
 * Hardware: Dahua IR CCTV (YOLOv8 + ODBO) + Microsoft Kinect (depth-to-weight CNN).
 *
 * Behavioral classification (3-state model per system architecture):
 *   "Inactivity" — low motion score during daytime
 *   "Huddling"   — high bounding-box cluster density
 *   "Sleeping"   — time-based override: 17:00–04:59 local time
 *
 * Weight categories (Kinect depth-volume regression):
 *   "Underweight" — < 1.20 kg   (#F59E0B amber)
 *   "Optimal"     — 1.20–1.90 kg (#10B981 emerald)
 *   "Overweight"  — > 1.90 kg   (#8B5CF6 violet)
 */

const AS_OF = "2024-05-24T21:10:00.000Z";

const FEED_STILL =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuCopPRa-XNdwo1f1TabwijSaLDroEN5UcUNFyqBxoDaoD7HlhDF31VnUxCcaHYvsmfoOnod-eYWNzRS9gu_YwwofE4fWx_b3U4UkQDptdvhXYFtSDbppGIPUqg1jrCNZGVz9bnAfI6WcOtg63ag0XjICfOZ_fXhdu-VU9Yi1FZfcxcRYHJkq4JLRJbPY1V2FkvDFg5tqr3PWKSKROY8pmCx9Xcd2tujDrN8qDnhKp7okRgiqYRgg5o_";

export const DAHUA_FEED_STREAM = "http://localhost:5000/video_feed/dahua";
export const KINECT_FEED_STREAM = "http://localhost:5000/video_feed/kinect";

// Fallback stills
export const KINECT_STILL = KINECT_FEED_STREAM;

const INCIDENT_STILL =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuAABtUdsRNWeVnOQQB2eAHQ35S-QIhSVyxsOimgAmCc5ZGENE3aaquoZdsSlLwpqmm3lkucrtSv_T1Gefy13GUaEiewbOM0CF70C6h5Oavh88ttUST7n4EPBg69gyu9nG5vTucK7Wfk94AJUbuBz_ogbzaoB-cje9ScHmyirVT9LPGu8bKNn66CEUGEHJ3dBEkrZ5Mg10sxAW-cyV446s9kSufVx675k0kJU-oRoJV8QerT4tOIsTnL";

/* ─── Night cycle ─────────────────────────────────────────────────────────── */

/** When the day starts and when the night starts, local time as "HH:MM" (Settings > Light and night hours). */
export interface LightingHours {
  dayStart: string;
  nightStart: string;
}

/** Day 05:00 to 16:59, night the rest, until Settings says otherwise. */
export const DEFAULT_LIGHTING: LightingHours = { dayStart: "05:00", nightStart: "17:00" };

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** "17:00" -> "5:00 PM". */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = (h ?? 0) % 12 || 12;
  return `${hour}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`;
}

/**
 * Between the day start and the night start (05:00 and 17:00 unless Settings
 * says otherwise) it is day; the rest is night, and the night may run past
 * midnight. During the night all birds are classified "Sleeping" and
 * inactivity/huddling alert triggers are suppressed.
 */
export function isNightCycle(date: Date = new Date(), lighting: LightingHours = DEFAULT_LIGHTING): boolean {
  const now = date.getHours() * 60 + date.getMinutes();
  const day = minutesOf(lighting.dayStart);
  const night = minutesOf(lighting.nightStart);
  const isDay = day < night ? now >= day && now < night : now >= day || now < night;
  return !isDay;
}

/* ─── Behavior states ─────────────────────────────────────────────────────── */

/**
 * Three-state behavioral model:
 * - "Inactivity" : minimal pixel movement, daytime only
 * - "Huddling"   : high bounding-box cluster density, daytime only
 * - "Sleeping"   : time-based override active 17:00–04:59
 */
export type BehaviorState = "Active" | "Inactive" | "Inactivity" | "Huddling" | "Sleeping";

/* ─── Weight categories ───────────────────────────────────────────────────── */

export type WeightCategory = "Underweight" | "Optimal" | "Overweight";

/** Assign a weight category from grams. */
export function weightCategory(weightG: number): WeightCategory {
  const kg = weightG / 1000;
  if (kg < 1.20) return "Underweight";
  if (kg <= 1.90) return "Optimal";
  return "Overweight";
}

/** Hex color for a weight category. */
export const WEIGHT_COLOR: Record<WeightCategory, string> = {
  Underweight: "#F59E0B",  // amber-400
  Optimal:     "#10B981",  // emerald-500
  Overweight:  "#8B5CF6",  // violet-500
};

/** Hex color for a behavior state. */
export const BEHAVIOR_COLOR: Record<BehaviorState, string> = {
  Active:     "#10B981",  // emerald-500
  Inactive:   "#ef4444",  // red-500
  Inactivity: "#ef4444",  // red-500
  Huddling:   "#f97316",  // orange-500
  Sleeping:   "#60a5fa",  // blue-400
};

/* ─── Model telemetry ─────────────────────────────────────────────────────── */

export interface ModelTelemetry {
  detectionModel: string;
  weightModel: string;
  fps: number;
  inferenceMs: number;
  pipelineStatus: "ACTIVE" | "IDLE" | "ERROR";
  gpuUtilPct: number;
  ramGb: number;
  apiEndpoint: string;
  lastFrameAt: string;
}

export const modelTelemetry: ModelTelemetry = {
  detectionModel: "Vision Detection",
  weightModel: "Depth Scale",
  fps: 15,
  inferenceMs: 24,
  pipelineStatus: "ACTIVE",
  gpuUtilPct: 34,
  ramGb: 2.1,
  apiEndpoint: "http://localhost:8000",
  lastFrameAt: AS_OF,
};

/* ─── Individual broiler records ──────────────────────────────────────────── */

export interface BroilerBird {
  id: string;
  weightG: number;
  weightConfidence: number;
  behavior: BehaviorState;
  yoloConfidence: number;
  activeMinutes: number;
  flag?: "LOW_WEIGHT" | "INACTIVE" | "HUDDLING" | "HIGH_TEMP_ZONE";
  lastSeenAt: string;
  breastWidthMm: number;
  totalLengthMm: number;
  depthZMm: number;
}

// [weightG, daytimeBehavior, yoloConf, flag?]
// Night-cycle behavior is resolved at render time via isNightCycle()
const RAW_BIRDS: Array<[number, BehaviorState, number, BroilerBird["flag"]?]> = [
  [1420, "Inactivity", 0.96],
  [1310, "Inactivity", 0.94],
  [1380, "Inactivity", 0.97],
  [1290, "Inactivity", 0.95],
  [1350, "Inactivity", 0.93],
  [1460, "Inactivity", 0.98],
  [1270, "Inactivity", 0.91],
  [1330, "Inactivity", 0.96],
  [1180, "Inactivity", 0.89],
  [1390, "Inactivity", 0.97],
  [1250, "Inactivity", 0.92],
  [1410, "Inactivity", 0.95],
  [1090, "Huddling",   0.88, "HUDDLING"],    // B-013
  [1300, "Inactivity", 0.94],
  [1370, "Huddling",   0.93, "HUDDLING"],    // B-015
  [1440, "Inactivity", 0.96],
  [1210, "Inactivity", 0.90],
  [1480, "Inactivity", 0.97],
  [1160, "Inactivity", 0.87, "INACTIVE"],    // B-019 — low motion
  [1320, "Inactivity", 0.95],
  [1400, "Inactivity", 0.96],
  [1280, "Inactivity", 0.93],
  [1050, "Inactivity", 0.85, "LOW_WEIGHT"], // B-023 — below 1.20 kg
  [1360, "Inactivity", 0.94],
  [1430, "Inactivity", 0.97],
  [1200, "Inactivity", 0.91],
  [1340, "Inactivity", 0.95],
  [1520, "Inactivity", 0.98],
];

export function morpho(weightG: number): Pick<BroilerBird, "breastWidthMm" | "totalLengthMm" | "depthZMm"> {
  const w = weightG / 1000;
  return {
    breastWidthMm: parseFloat((52 + w * 11.6).toFixed(1)),
    totalLengthMm: parseFloat((160 + w * 42).toFixed(1)),
    depthZMm:      parseFloat((82 + w * 21).toFixed(1)),
  };
}

export const broilers: BroilerBird[] = RAW_BIRDS.map(([wG, beh, yConf, flag], i) => ({
  id: `B-${String(i + 1).padStart(3, "0")}`,
  weightG: wG as number,
  weightConfidence: parseFloat(((wG as number > 1200 ? 0.88 : 0.82) + Math.random() * 0.09).toFixed(2)),
  behavior: beh as BehaviorState,
  yoloConfidence: (yConf as number) ?? 0.92,
  activeMinutes: (beh === "Huddling" || flag === "INACTIVE") ? 4 : 44,
  flag: flag as BroilerBird["flag"],
  lastSeenAt: AS_OF,
  ...morpho(wG as number),
}));

/* ─── Kinect weighing-station birds (5 at the station zone) ─────────────── */

export interface KinectDetection {
  id: string;        // "K-001"
  weightG: number;
  depthMm: number;
  x: number;         // % of Kinect frame
  y: number;
  w: number;
  h: number;
}

export const kinectDetections: KinectDetection[] = [
  { id: "K-001", weightG: 1150, depthMm: 310, x: 8,  y: 15, w: 14, h: 22 },
  { id: "K-002", weightG: 1340, depthMm: 285, x: 26, y: 20, w: 14, h: 22 },
  { id: "K-003", weightG: 1620, depthMm: 260, x: 46, y: 12, w: 14, h: 22 },
  { id: "K-004", weightG: 1950, depthMm: 238, x: 65, y: 18, w: 14, h: 22 },
  { id: "K-005", weightG: 1080, depthMm: 320, x: 82, y: 22, w: 14, h: 22 },
];

/* ─── Behavior helpers ────────────────────────────────────────────────────── */

/**
 * Resolve the effective behavior for display.
 * During night cycle all birds show "Sleeping" regardless of daytime state.
 */
export function effectiveBehavior(bird: BroilerBird, night = isNightCycle()): BehaviorState {
  if (night) return "Sleeping";
  return bird.behavior;
}

/** Count birds per behavior state (respects night cycle). */
export function behaviorBreakdown(night = isNightCycle()): Record<BehaviorState, number> {
  const out: Record<BehaviorState, number> = { Active: 0, Inactive: 0, Inactivity: 0, Huddling: 0, Sleeping: 0 };
  broilers.forEach((b) => {
    const beh = effectiveBehavior(b, night);
    out[beh] = (out[beh] ?? 0) + 1;
  });
  out.Inactive = (out.Inactivity ?? 0) + (out.Huddling ?? 0);
  out.Active = broilers.length - out.Inactive;
  return out;
}

/** Count birds per weight category. */
export function weightBreakdown(): Record<WeightCategory, number> {
  const out: Record<WeightCategory, number> = { Underweight: 0, Optimal: 0, Overweight: 0 };
  broilers.forEach((b) => { out[weightCategory(b.weightG)]++; });
  return out;
}

/* ─── Environment sensors ─────────────────────────────────────────────────── */
const environment: SensorReading[] = [
  {
    sensorId: "SN-241-H1", houseId: "H01", parameter: "temperature",
    code: "TEMP_H01", label: "Temperature", value: 29.1, unit: "°C",
    bounds: { min: 26, max: 32, label: "26–32°C" }, status: "nominal", recordedAt: AS_OF,
  },
  {
    sensorId: "SN-242-H1", houseId: "H01", parameter: "humidity",
    code: "HUMID_H01", label: "Humidity", value: 63, unit: "%",
    bounds: { min: 50, max: 70, label: "50–70%" }, status: "nominal", recordedAt: AS_OF,
  },
  {
    sensorId: "SN-244-H1", houseId: "H01", parameter: "nh3",
    code: "NH3_H01", label: "Ammonia", value: 9, unit: "ppm",
    bounds: { max: 25, label: "< 25 ppm" }, status: "nominal", recordedAt: AS_OF,
  },
];

/* ─── Main dataset ────────────────────────────────────────────────────────── */
export const farm: FarmDataset = {
  facility: {
    id: "FARM-001",
    name: "Data Cruz Poultry Farm",
    houseRange: "Pen 1",
    breed: "Ross 308",
    houses: [{ id: "H01", label: "Pen 1", section: "SEC_A", population: 28 }],
  },
  cycle: {
    id: "FC-2024-07",
    label: "Flock Cycle 1",
    startDate: "2024-05-10",
    day: 14,
    projectedYieldDate: "2024-06-21",
    windowStart: "2024-05-17",
    windowEnd: "2024-05-24",
    asOf: AS_OF,
  },
  platform: {
    appVersion: "3.0.0",
    releaseChannel: "STABLE",
    apiVersion: "v2.0",
    mlModel: "Vision Detection",
    llm: "LLAMA_3.3",
    inferenceLatencyMs: 24,
    cpuPercent: 34,
    ramGb: 2.1,
    status: "nominal",
  },
  summary: { status: "optimal", confidence: 0.963 },
  activity: {
    value: 91.4, unit: "%", baseline: 88, trend: "up",
    series: [85, 87, 86, 89, 90, 88, 91, 90, 92, 91, 89, 92, 91, 93, 92, 91, 91.4],
    axisLabels: ["T-24H", "T-18H", "T-12H", "T-06H", "NOW"],
  },
  weight: {
    actualAvgG: Math.round(broilers.reduce((s, b) => s + b.weightG, 0) / broilers.length),
    standardG: 1300,
    variancePercent: 1.5,
    modelConfidence: 0.963,
    estimationConfidencePercent: 92,
    sampleSize: broilers.filter((b) => b.behavior !== "Huddling").length,
    status: "optimal",
    curve: [
      { day: 1,  actualG: 42,   standardG: 40   },
      { day: 3,  actualG: 95,   standardG: 90   },
      { day: 5,  actualG: 152,  standardG: 148  },
      { day: 7,  actualG: 210,  standardG: 200  },
      { day: 9,  actualG: 295,  standardG: 285  },
      { day: 10, actualG: 420,  standardG: 410  },
      { day: 12, actualG: 860,  standardG: 840  },
      { day: 14, actualG: 1320, standardG: 1300 },
      { day: 21, actualG: 0,    standardG: 2000 },
      { day: 28, actualG: 0,    standardG: 2800 },
      { day: 35, actualG: 0,    standardG: 3400 },
      { day: 42, actualG: 0,    standardG: 3900 },
    ],
  },
  cohorts: [{
    id: "PEN1_FLOCK_01", houseId: "H01",
    minG: broilers.reduce((m, b) => Math.min(m, b.weightG), Infinity),
    maxG: broilers.reduce((m, b) => Math.max(m, b.weightG), 0),
    standardDeviationG: 118, medianG: 1340, status: "nominal",
  }],
  feed: {
    fcr: 1.64, fcrTarget: 1.70, fcrDelta: -0.06, adgG: 94,
    cycleNumber: 1, cycleConsumedKg: 13.4,
    series: [1.72, 1.70, 1.69, 1.68, 1.67, 1.66, 1.65, 1.64],
  },
  water: {
    intakeLitresPerHour: 2.4, status: "nominal",
    series: [2.1, 2.2, 2.3, 2.2, 2.4, 2.3, 2.4, 2.5, 2.4],
  },
  volumetric: {
    sensorId: "SN-829-K1", cohortId: "PEN1_FLOCK_01",
    breastWidthMm: 68.4, totalLengthMm: 218.5, depthZMm: 112.1,
    calculatedMassG: 1320, morphologicalIndex: 1.18, densityRatio: 0.97, precisionPercent: 2.1,
  },
  environment,
  cameras: [
    {
      id: "CAM-01", houseId: "H01", fps: 25, resolution: "1280x720",
      online: true, depthPointsPerFrame: 0,
      birdsScanned: broilers.length,
      planViewLabel: "Pen 1 — Dahua Overhead IR CCTV",
      stillUrl: DAHUA_FEED_STREAM,
      location: { x: 50, y: 50 },
    },
    {
      id: "KINECT-01", houseId: "H01", fps: 25, resolution: "640x360",
      online: true, depthPointsPerFrame: 12000,
      birdsScanned: 5,
      planViewLabel: "Pen 1 — Microsoft Kinect 3D Depth Station",
      stillUrl: KINECT_FEED_STREAM,
      location: { x: 30, y: 70 },
    },
  ],
  detections: broilers.slice(0, 8).map((b, i) => ({
    id: `D${String(i + 1).padStart(3, "0")}`,
    box: {
      x: 60 + (i % 4) * 140,
      y: 80 + Math.floor(i / 4) * 160,
      width: 46 + (b.weightG > 1300 ? 4 : 0),
      height: 46 + (b.weightG > 1300 ? 4 : 0),
    },
    behavior: b.behavior.toUpperCase(),
    estimatedWeightG: b.weightG,
    weightConfidence: b.weightConfidence,
    flag: b.flag,
  })),
  clusterWarning: { label: "No cluster warning", risk: 0.02, box: { x: 0, y: 0, width: 0, height: 0 } },
  behavior: {
    movementIndex: 0.914, movementLabel: "Active", movementStatus: "nominal",
    huddlingRisk: 0.08, huddlingLabel: "Low", huddlingStatus: "nominal",
    aggressionEvents: 0,
  },
  incidents: [{
    id: "INC-2024-0520-H01", houseId: "H01",
    title: "B-013 & B-015 huddling detected (> 30 min)",
    startedAt: "2024-05-24T16:30:00.000Z", endedAt: "",
    exceedanceMinutes: 80, activityDropPercent: 7.1,
    cause: "B-013 and B-015 cluster density exceeded threshold near water drinker",
    resolution: "Monitor via CAM-01; inspect if huddling persists > 60 min",
    status: "open",
    peak: {
      sensorId: "SN-241-H1", parameter: "temperature",
      value: 31.4, unit: "°C", threshold: 32, baseline: 29.1,
      series: [28.9, 29.1, 29.5, 30.1, 31.4, 30.8, 30.2, 29.8],
    },
    evidence: {
      cameraId: "CAM-01", clipId: "CAM01-CLIP-042",
      capturedAt: "2024-05-24T16:35:00.000Z",
      detectionLabel: "HUDDLING", detectionConfidence: 0.87,
      imageUrl: INCIDENT_STILL,
    },
  }],
  alerts: [
    {
      id: "ALT-001", kind: "Huddling Detected", severity: "critical",
      raisedAt: "2024-05-24T16:30:00.000Z",
      message: "B-013 and B-015 cluster density exceeded threshold. Check CAM-01.",
      acknowledged: false, actions: ["Check Camera", "Dismiss"],
    },
    {
      id: "ALT-002", kind: "High Temperature", severity: "warning",
      raisedAt: "2024-05-24T10:32:00.000Z",
      message: "SN-241-H1 peaked at 31.4°C (threshold: 32°C). Increase ventilation.",
      acknowledged: false, actions: ["Dismiss"],
    },
    {
      id: "ALT-003", kind: "Low Weight Flag", severity: "warning",
      raisedAt: "2024-05-24T08:15:00.000Z",
      message: "B-023 estimated at 1,050 g — Underweight (<1.20 kg). Monitor closely.",
      acknowledged: false, actions: ["View Bird", "Dismiss"],
    },
    {
      id: "ALT-004", kind: "System Sync", severity: "nominal",
      raisedAt: "2024-05-24T08:00:00.000Z",
      message: "Pipeline synchronized. Detection and weight estimation modules loaded successfully.",
      acknowledged: true,
    },
  ],
  timeline: {
    windowStart: "2024-05-24T00:00:00.000Z",
    windowEnd:   "2024-05-25T00:00:00.000Z",
    cursorAt: AS_OF,
    events: [
      { id: "ANM-001", at: "2024-05-24T08:15:00.000Z", severity: "warning",  label: "Low Weight — B-023" },
      { id: "ANM-002", at: "2024-05-24T10:32:00.000Z", severity: "warning",  label: "High Temp 31.4°C" },
      { id: "ANM-003", at: "2024-05-24T16:30:00.000Z", severity: "critical", label: "Huddling — B-013, B-015" },
    ],
  },
  references: [{
    id: "BROILER_GUIDE_2023",
    quote: "Ammonia levels above 20 ppm cause respiratory irritation in broiler chickens, leading to reduced movement and huddling behavior.",
    citedThreshold: 20, unit: "ppm",
  }],
  report: { id: "RPT-2024-0524", groundingId: "RAG-001", generatedAt: AS_OF, lastScanAt: "2024-05-24T21:08:00.000Z" },
  archive: [
    { id: "RPT-DHS-20240523", icon: "description", format: "PDF", title: "Daily Health Summary",  generatedAt: "2024-05-23T22:00:00.000Z", sizeMb: 0.4 },
    { id: "RPT-ENV-20240523", icon: "monitoring",   format: "CSV", title: "Environment Report",    generatedAt: "2024-05-23T22:05:00.000Z", sizeMb: 0.2 },
    { id: "RPT-W02",          icon: "trending_up",  format: "PDF", title: "Week 2 Growth Report",  generatedAt: "2024-05-24T19:10:00.000Z", sizeMb: 0.6, featured: true, note: "Week 2 summary" },
  ],
};

/* ─── Selectors ───────────────────────────────────────────────────────────── */

export function houseLabel(houseId: string): string {
  return farm.facility.houses.find((h) => h.id === houseId)?.label ?? houseId;
}
export function houseSection(houseId: string): string {
  return farm.facility.houses.find((h) => h.id === houseId)?.section ?? houseId;
}
export function houseReadings(houseId: string): SensorReading[] {
  return farm.environment.filter((r) => r.houseId === houseId);
}
export function readingByCode(code: string): SensorReading {
  const r = farm.environment.find((r) => r.code === code);
  if (!r) throw new Error(`Unknown sensor code: ${code}`);
  return r;
}
export function liveCamera()           { return farm.cameras[0]!; }
export function cameraById(id: string) { return farm.cameras.find((c) => c.id === id) ?? farm.cameras[0]!; }
export function activeIncident()       { return farm.incidents.find((i) => i.status !== "closed") ?? farm.incidents[0]!; }
export function flockStandardDeviationG(): number {
  return Math.round(farm.cohorts.reduce((s, c) => s + c.standardDeviationG, 0) / farm.cohorts.length);
}
export function flockPopulation(): number {
  return farm.facility.houses.reduce((s, h) => s + h.population, 0);
}
export function unacknowledgedAlerts(): number {
  return farm.alerts.filter((a) => !a.acknowledged).length;
}
export function environmentStatus(): StatusLevel {
  const order: StatusLevel[] = ["critical", "warning", "deviation", "nominal", "optimal"];
  for (const level of order) {
    if (farm.environment.some((r) => r.status === level)) return level;
  }
  return "nominal";
}
export function minutesSinceLastAnomaly(): number {
  const events = farm.timeline.events;
  if (!events.length) return 0;
  const last = events[events.length - 1]!;
  return Math.round((new Date(farm.timeline.cursorAt).getTime() - new Date(last.at).getTime()) / 60000);
}
export function lastAnomaly() { return farm.timeline.events.at(-1) ?? null; }

/** Total birds in the flock. */
export function activeBirds():   number { return broilers.filter((b) => b.behavior !== "Huddling").length; }
export function inactiveBirds(): number { return broilers.filter((b) => b.behavior === "Huddling").length; }
