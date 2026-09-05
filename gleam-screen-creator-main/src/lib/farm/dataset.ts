import type { FarmDataset, SensorReading, StatusLevel } from "./types";

/**
 * Single source of truth for every figure in the console.
 *
 * This module is the seed dataset: it holds one reconciled value per fact, in
 * raw form, shaped exactly like the domain model. When a database is connected,
 * `repository.ts` is the only file that changes — its server functions stop
 * reading `farm` and start reading rows, returning the same shapes. Nothing in
 * the UI needs to be touched.
 *
 * Reconciliation rules applied here:
 * - one canonical average weight (`weight.actualAvgG`) which is also the mean of
 *   the cohort medians;
 * - one canonical environment reading per house sensor, reused by the dashboard
 *   cluster, the live feed HUD and the monitoring report;
 * - percentages, deltas and chart geometry are derived, never restated;
 * - all timestamps are ISO strings anchored to `cycle.asOf`.
 */

/** Everything in the dataset is current as of this instant. */
const AS_OF = "2024-05-24T21:10:00.000Z";

const FEED_STILL =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuCopPRa-XNdwo1f1TabwijSaLDroEN5UcUNFyqBxoDaoD7HlhDF31VnUxCcaHYvsmfoOnod-eYWNzRS9gu_YwwofE4fWx_b3U4UkQDptdvhXYFtSDbppGIPUqg1jrCNZGVz9bnAfI6WcOtg63ag0XjICfOZ_fXhdu-VU9Yi1FZfcxcRYHJkq4JLRJbPY1V2FkvDFg5tqr3PWKSKROY8pmCx9Xcd2tujDrN8qDnhKp7okRgiqYRgg5o_";

const INCIDENT_STILL =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuAABtUdsRNWeVnOQQB2eAHQ35S-QIhSVyxsOimgAmCc5ZGENE3aaquoZdsSlLwpqmm3lkucrtSv_T1Gefy13GUaEiewbOM0CF70C6h5Oavh88ttUST7n4EPBg69gyu9nG5vTucK7Wfk94AJUbuBz_ogbzaoB-cje9ScHmyirVT9LPGu8bKNn66CEUGEHJ3dBEkrZ5Mg10sxAW-cyV446s9kSufVx675k0kJU-oRoJV8QerT4tOIsTnL";

/** Environment sensors. Pen 01 is the single monitored pen. */
const environment: SensorReading[] = [
  {
    sensorId: "SN-241-H1",
    houseId: "H01",
    parameter: "temperature",
    code: "TEMP_H01",
    label: "TEMP",
    value: 24.2,
    unit: "°C",
    bounds: { min: 22, max: 26, label: "22-26 °C" },
    status: "nominal",
    recordedAt: AS_OF,
  },
  {
    sensorId: "SN-242-H1",
    houseId: "H01",
    parameter: "humidity",
    code: "HUMID_H01",
    label: "HUMID",
    value: 58,
    unit: "%",
    bounds: { min: 50, max: 70, label: "50-70%" },
    status: "nominal",
    recordedAt: AS_OF,
  },
  {
    sensorId: "SN-244-H1",
    houseId: "H01",
    parameter: "nh3",
    code: "NH3_H01",
    label: "NH3",
    value: 3,
    unit: "PPM",
    bounds: { max: 25, label: "<= 25 ppm" },
    status: "nominal",
    recordedAt: AS_OF,
  },
];

export const farm: FarmDataset = {
  facility: {
    id: "FARM-001",
    name: "CereBroiler",
    houseRange: "Pen 01",
    breed: "Ross 308",
    houses: [
      { id: "H01", label: "Pen 01", section: "SEC_A", population: 4210 },
    ],
  },

  cycle: {
    id: "FC-2024-07",
    label: "FLOCK_01",
    startDate: "2024-04-12",
    day: 42,
    projectedYieldDate: "2024-05-27",
    windowStart: "2024-05-18",
    windowEnd: "2024-05-24",
    asOf: AS_OF,
  },

  platform: {
    appVersion: "2.4.0",
    releaseChannel: "STABLE",
    apiVersion: "v1.2",
    mlModel: "v4",
    llm: "LLAMA_3.3",
    inferenceLatencyMs: 24,
    cpuPercent: 34,
    ramGb: 2.1,
    status: "nominal",
  },

  summary: {
    status: "optimal",
    // Weight-model confidence, also quoted as CONF on the analytics page.
    confidence: 0.984,
  },

  activity: {
    value: 482.4,
    unit: "IDX",
    baseline: 455,
    trend: "up",
    series: [
      441.2, 447.6, 439.8, 452.3, 458.1, 455.4, 461.7, 459.2, 466.4, 464.1, 470.8, 468.3,
      474.9, 472.6, 478.2, 476.5, 482.4,
    ],
    axisLabels: ["T-24H", "T-18H", "T-12H", "T-06H", "CURRENT"],
  },

  weight: {
    actualAvgG: 2452,
    standardG: 2422,
    variancePercent: 1.2,
    modelConfidence: 0.984,
    estimationConfidencePercent: 94,
    sampleSize: 4820,
    status: "optimal",
    curve: [
      { day: 1, actualG: 62, standardG: 60 },
      { day: 7, actualG: 196, standardG: 190 },
      { day: 14, actualG: 472, standardG: 460 },
      { day: 21, actualG: 918, standardG: 900 },
      { day: 28, actualG: 1428, standardG: 1400 },
      { day: 35, actualG: 1988, standardG: 1950 },
      { day: 42, actualG: 2452, standardG: 2422 },
    ],
  },

  // Cohort medians average exactly to weight.actualAvgG.
  cohorts: [
    {
      id: "SEC_A_FLOCK_01",
      houseId: "H01",
      minG: 2104,
      maxG: 2855,
      standardDeviationG: 112,
      medianG: 2452,
      status: "nominal",
    },
  ],

  feed: {
    fcr: 1.48,
    fcrTarget: 1.5,
    fcrDelta: -0.02,
    adgG: 68,
    cycleNumber: 4,
    cycleConsumedKg: 1420,
    series: [1.56, 1.55, 1.53, 1.52, 1.51, 1.5, 1.49, 1.48],
  },

  water: {
    intakeLitresPerHour: 2140,
    status: "nominal",
    series: [2118, 2126, 2131, 2124, 2136, 2129, 2140, 2135, 2140],
  },

  volumetric: {
    sensorId: "SN-829-K1",
    cohortId: "SEC_A_FLOCK_01",
    breastWidthMm: 114.2,
    totalLengthMm: 342.5,
    depthZMm: 182.1,
    // Matches the SEC_A cohort median the sample was drawn from.
    calculatedMassG: 2452,
    morphologicalIndex: 1.42,
    densityRatio: 0.985,
    precisionPercent: 1.5,
  },

  environment,

  cameras: [
    {
      id: "UNIT_01_MAIN",
      houseId: "H01",
      fps: 60.2,
      resolution: "4K_UHD",
      online: true,
      depthPointsPerFrame: 42000,
      birdsScanned: 1284,
      planViewLabel: "UNIT_01_PLAN_VIEW",
      stillUrl: FEED_STILL,
      location: { x: 45.021, y: 12.884 },
    },
  ],

  detections: [
    {
      id: "4522",
      box: { x: 250, y: 320, width: 40, height: 40 },
      behavior: "FEEDING",
      estimatedWeightG: 2410,
      weightConfidence: 0.978,
    },
    {
      id: "8901",
      box: { x: 580, y: 150, width: 35, height: 35 },
      behavior: "PREENING",
      estimatedWeightG: 2530,
      weightConfidence: 0.964,
    },
    {
      id: "7215",
      box: { x: 740, y: 420, width: 45, height: 45 },
      behavior: "RESTING",
      estimatedWeightG: 1980,
      weightConfidence: 0.921,
      flag: "LOW_WEIGHT",
    },
  ],

  clusterWarning: {
    label: "HUDDLING_CLUSTER",
    risk: 0.02,
    box: { x: 700, y: 400, width: 120, height: 80 },
  },

  behavior: {
    movementIndex: 0.84,
    movementLabel: "HIGH",
    movementStatus: "nominal",
    huddlingRisk: 0.02,
    huddlingLabel: "MINIMAL",
    huddlingStatus: "nominal",
    aggressionEvents: 0,
  },

  incidents: [
    {
      id: "INC-2024-0524-H01",
      houseId: "H01",
      title: "Ventilation failure — ammonia excursion",
      startedAt: "2024-05-24T02:15:00.000Z",
      endedAt: "2024-05-24T04:40:00.000Z",
      exceedanceMinutes: 142,
      activityDropPercent: 15.4,
      cause: "Ventilation group B failure after a circuit breaker trip",
      resolution: "Ventilation restored; NH3 returned to 3 ppm",
      status: "resolved_monitoring",
      peak: {
        sensorId: "SN-244-H1",
        parameter: "nh3",
        value: 28.4,
        unit: "PPM",
        threshold: 25,
        baseline: 5.5,
        series: [5.4, 5.6, 5.2, 25.9, 28.4, 26.1, 11.2, 5.8],
      },
      evidence: {
        cameraId: "UNIT_01_MAIN",
        clipId: "H1-CAM-08",
        capturedAt: "2024-05-24T02:45:00.000Z",
        detectionLabel: "HUDDLING_CLUSTER",
        detectionConfidence: 0.82,
        imageUrl: INCIDENT_STILL,
      },
    },
  ],

  alerts: [
    {
      id: "ALT-2405-0440",
      kind: "CRITICAL_EVENT",
      severity: "critical",
      raisedAt: "2024-05-24T04:40:00.000Z",
      message: "Activity drop 15.4% detected in Pen 01. Sensor redundancy verified.",
      acknowledged: false,
      actions: ["INVESTIGATE", "DISMISS"],
    },
    {
      id: "ALT-2405-0612",
      kind: "DEVIATION_LOG",
      severity: "deviation",
      raisedAt: "2024-05-24T06:12:00.000Z",
      message: "Weight deviation (-1.3% vs standard) in SEC_A cohort. Sampling rate adjusted.",
      acknowledged: false,
    },
    {
      id: "ALT-2405-1210",
      kind: "ENV_REPORT",
      severity: "nominal",
      raisedAt: "2024-05-24T12:10:00.000Z",
      message: "Humidity sensor SN-242-H1 recalibrated automatically.",
      acknowledged: false,
    },
    {
      id: "ALT-2405-1900",
      kind: "FEED_CYCLE",
      severity: "nominal",
      raisedAt: "2024-05-24T19:00:00.000Z",
      message: "Feed cycle 04 completed. Consumed 1,420 kg.",
      acknowledged: true,
    },
  ],

  timeline: {
    windowStart: "2024-05-24T00:00:00.000Z",
    windowEnd: "2024-05-25T00:00:00.000Z",
    cursorAt: AS_OF,
    events: [
      {
        id: "ANM-0253",
        at: "2024-05-24T02:53:00.000Z",
        severity: "critical",
        label: "NH3_SPIKE_H01",
      },
      {
        id: "ANM-0420",
        at: "2024-05-24T04:20:00.000Z",
        severity: "critical",
        label: "ACTIVITY_DROP_H01",
      },
      {
        id: "ANM-1048",
        at: "2024-05-24T10:48:00.000Z",
        severity: "warning",
        label: "FEED_DROPOUT_H01",
      },
      {
        id: "ANM-1453",
        at: "2024-05-24T14:53:00.000Z",
        severity: "warning",
        label: "TEMP_EXCURSION_H01",
      },
      {
        id: "ANM-1940",
        at: "2024-05-24T19:40:00.000Z",
        severity: "warning",
        label: "HUDDLING_CLUSTER_H01",
      },
    ],
  },

  references: [
    {
      id: "MANUAL_VOL_II_SEC_4.2",
      quote:
        "Ammonia levels above 20ppm cause respiratory irritation in broiler populations, leading to reduced movement and huddling behavior.",
      citedThreshold: 20,
      unit: "ppm",
    },
  ],

  report: {
    id: "IMR-2024-0524-8821",
    groundingId: "RAG-8821",
    generatedAt: AS_OF,
    lastScanAt: "2024-05-24T21:08:44.000Z",
  },

  archive: [
    {
      id: "RPT-DHS-20240523",
      icon: "description",
      format: "PDF_EXPORT",
      title: "Daily Health Summary",
      generatedAt: "2024-05-23T22:00:00.000Z",
      sizeMb: 2.4,
    },
    {
      id: "RPT-ENV-20240523",
      icon: "monitoring",
      format: "CSV_RAW",
      title: "Environment Audit v4",
      generatedAt: "2024-05-23T22:05:00.000Z",
      sizeMb: 8.1,
    },
    {
      id: "RPT-GEN-W21",
      icon: "trending_up",
      format: "PDF_EXPORT",
      title: "Weekly Genetic Trend Projection",
      generatedAt: "2024-05-24T19:10:00.000Z",
      sizeMb: 4.6,
      featured: true,
      note: "Week 21 Analysis",
    },
  ],
};

/* ------------------------------------------------------------------ *
 * Selectors — the only sanctioned way to reach into the dataset.
 * ------------------------------------------------------------------ */

export function houseLabel(houseId: string): string {
  return farm.facility.houses.find((h) => h.id === houseId)?.label ?? houseId;
}

export function houseSection(houseId: string): string {
  return farm.facility.houses.find((h) => h.id === houseId)?.section ?? houseId;
}

/** Environment readings for one house, in console display order. */
export function houseReadings(houseId: string): SensorReading[] {
  return farm.environment.filter((r) => r.houseId === houseId);
}

export function readingByCode(code: string): SensorReading {
  const reading = farm.environment.find((r) => r.code === code);
  if (!reading) throw new Error(`Unknown sensor code: ${code}`);
  return reading;
}

/** Camera whose feed the visual telemetry page streams. */
export function liveCamera() {
  return farm.cameras[0];
}

export function cameraById(id: string) {
  return farm.cameras.find((c) => c.id === id) ?? farm.cameras[0];
}

/** The incident currently under observation, if any. */
export function activeIncident() {
  return farm.incidents.find((i) => i.status !== "closed") ?? farm.incidents[0];
}

/** Mean of the cohort standard deviations — the flock-level spread. */
export function flockStandardDeviationG(): number {
  const total = farm.cohorts.reduce((sum, c) => sum + c.standardDeviationG, 0);
  return Math.round(total / farm.cohorts.length);
}

/** Total birds across all houses. */
export function flockPopulation(): number {
  return farm.facility.houses.reduce((sum, h) => sum + h.population, 0);
}

export function unacknowledgedAlerts(): number {
  return farm.alerts.filter((a) => !a.acknowledged).length;
}

/** Most severe status across the environment sensors. */
export function environmentStatus(): StatusLevel {
  const order: StatusLevel[] = ["critical", "warning", "deviation", "nominal", "optimal"];
  for (const level of order) {
    if (farm.environment.some((r) => r.status === level)) return level;
  }
  return "nominal";
}

/** Minutes since the last logged anomaly, measured from the timeline cursor. */
export function minutesSinceLastAnomaly(): number {
  const events = farm.timeline.events;
  const last = events[events.length - 1];
  const delta = new Date(farm.timeline.cursorAt).getTime() - new Date(last.at).getTime();
  return Math.round(delta / 60000);
}

/** Latest anomaly on the 24h timeline. */
export function lastAnomaly() {
  return farm.timeline.events[farm.timeline.events.length - 1];
}
