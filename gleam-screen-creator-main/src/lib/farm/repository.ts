import { createServerFn } from "@tanstack/react-start";
import { formatMeasurement } from "./format";
import {
  activeIncident,
  farm,
  flockStandardDeviationG,
  houseLabel,
  houseReadings,
  lastAnomaly,
  liveCamera,
  minutesSinceLastAnomaly,
  readingByCode,
} from "./dataset";
import type { ReportFinding } from "./types";

/**
 * Data access layer — the seam a real database plugs into.
 *
 * Each function is a TanStack server function, so it already runs on the server
 * for both SSR and client navigation. Today the handlers read the in-memory
 * `farm` dataset; to go live, replace the body of each handler with the
 * equivalent query (e.g. `await db.query.houses.findMany(...)`) and keep the
 * returned shape. Pages consume these through route loaders and never import
 * the dataset for their figures, so no UI code changes when the source changes.
 *
 * Contract for every handler:
 * - returns JSON-serializable data only (numbers, strings, ISO timestamps);
 * - returns raw values, not formatted strings (formatting lives in `format.ts`);
 * - is read-only and safe to call during render.
 */

/** Dashboard — executive summary, activity index, KPI cards, alerts, sensors. */
export const getOperationsOverview = createServerFn({ method: "GET" }).handler(async () => {
  const clusterHouseId = liveCamera().houseId;

  return {
    facility: {
      name: farm.facility.name,
      houseRange: farm.facility.houseRange,
      breed: farm.facility.breed,
    },
    cycle: farm.cycle,
    platform: farm.platform,
    summary: farm.summary,
    activity: farm.activity,
    weight: farm.weight,
    flockStandardDeviationG: flockStandardDeviationG(),
    water: farm.water,
    feed: farm.feed,
    alerts: farm.alerts,
    /** Sensor cluster shown at the foot of the dashboard. */
    cluster: {
      houseId: clusterHouseId,
      houseLabel: houseLabel(clusterHouseId),
      readings: houseReadings(clusterHouseId),
    },
    lastAnomaly: lastAnomaly(),
    minutesSinceLastAnomaly: minutesSinceLastAnomaly(),
    report: farm.report,
  };
});

/** Analytics — growth curve, cohort distribution, volumetric sample. */
export const getGrowthAnalytics = createServerFn({ method: "GET" }).handler(async () => {
  const volumetricCohort = farm.cohorts.find((c) => c.id === farm.volumetric.cohortId);

  return {
    cycle: farm.cycle,
    weight: farm.weight,
    feed: farm.feed,
    flockStandardDeviationG: flockStandardDeviationG(),
    cohorts: farm.cohorts.map((cohort) => ({
      ...cohort,
      houseLabel: houseLabel(cohort.houseId),
    })),
    volumetric: {
      ...farm.volumetric,
      cohortHouseLabel: volumetricCohort ? houseLabel(volumetricCohort.houseId) : null,
    },
  };
});

/** Visual telemetry — live feed overlays, behaviour metrics, anomaly timeline. */
export const getVisualTelemetry = createServerFn({ method: "GET" }).handler(async () => {
  const camera = liveCamera();
  const cycleTotalDays = Math.round(
    (new Date(farm.cycle.projectedYieldDate).getTime() -
      new Date(farm.cycle.startDate).getTime()) /
      86_400_000,
  );

  return {
    camera: { ...camera, houseLabel: houseLabel(camera.houseId) },
    /** HUD readings for the house on camera. */
    hud: {
      temperature: readingByCode(`TEMP_${camera.houseId}`),
      humidity: readingByCode(`HUMID_${camera.houseId}`),
    },
    detections: farm.detections,
    clusterWarning: farm.clusterWarning,
    behavior: farm.behavior,
    weight: {
      actualAvgG: farm.weight.actualAvgG,
      standardG: farm.weight.standardG,
      variancePercent: farm.weight.variancePercent,
      estimationConfidencePercent: farm.weight.estimationConfidencePercent,
      sampleSize: farm.weight.sampleSize,
      status: farm.weight.status,
    },
    cycleDay: farm.cycle.day,
    /** Grow-out length used to show how far the cycle has progressed. */
    cycleTotalDays,
    timeline: farm.timeline,
  };
});

/** Intelligence — the auto-generated monitoring report and its evidence. */
export const getMonitoringReport = createServerFn({ method: "GET" }).handler(async () => {
  const incident = activeIncident();
  const nh3Current = readingByCode("NH3_H01");
  const temperature = readingByCode("TEMP_H01");
  const humidity = readingByCode("HUMID_H01");

  const findings: ReportFinding[] = [
    {
      id: "nh3-peak",
      parameter: "Ammonia NH3 (incident peak)",
      source: `${incident.peak.sensorId} / ${houseLabel(incident.houseId)}`,
      value: incident.peak.value,
      unit: incident.peak.unit,
      boundsLabel: `<= ${incident.peak.threshold} ${incident.peak.unit.toLowerCase()}`,
      status: "critical",
    },
    {
      id: "nh3-current",
      parameter: "Ammonia NH3 (current)",
      source: `${nh3Current.sensorId} / ${houseLabel(nh3Current.houseId)}`,
      value: nh3Current.value,
      unit: nh3Current.unit,
      boundsLabel: nh3Current.bounds.label,
      status: nh3Current.status,
    },
    {
      id: "temperature",
      parameter: "Temperature",
      source: `${temperature.sensorId} / ${houseLabel(temperature.houseId)}`,
      value: temperature.value,
      unit: temperature.unit,
      boundsLabel: temperature.bounds.label,
      status: temperature.status,
    },
    {
      id: "humidity",
      parameter: "Relative humidity",
      source: `${humidity.sensorId} / ${houseLabel(humidity.houseId)}`,
      value: humidity.value,
      unit: humidity.unit,
      boundsLabel: humidity.bounds.label,
      status: humidity.status,
    },
    {
      id: "weight",
      parameter: "Average bird weight",
      source: `SCALE / ${farm.facility.houseRange}`,
      value: farm.weight.actualAvgG,
      unit: "g",
      boundsLabel: `STD ${formatMeasurement(farm.weight.standardG, "g")}`,
      status: farm.weight.status,
    },
  ];

  return {
    report: farm.report,
    platform: farm.platform,
    facility: {
      name: farm.facility.name,
      houseRange: farm.facility.houseRange,
    },
    cycle: farm.cycle,
    incident: {
      ...incident,
      houseLabel: houseLabel(incident.houseId),
    },
    findings,
    references: farm.references,
    archive: farm.archive,
  };
});

/** Alerts — list with optional severity / acknowledged filters. */
export const getAlerts = createServerFn({ method: "GET" })
  .handler(async ({ data }) => {
    const input = (data ?? {}) as { severity?: string; acknowledged?: boolean };
    return farm.alerts
      .filter((a) => !input.severity || a.severity === input.severity)
      .filter((a) => input.acknowledged === undefined || a.acknowledged === input.acknowledged)
      .map((a) => ({
        id: a.id,
        kind: a.kind,
        severity: a.severity,
        raisedAt: a.raisedAt,
        message: a.message,
        acknowledged: a.acknowledged,
        acknowledgedAt: a.acknowledgedAt ?? null,
        sourceIncidentId: a.sourceIncidentId ?? null,
      }));
  });

/** Alerts — mark an alert as acknowledged. */
export const acknowledgeAlertFn = createServerFn({ method: "POST" })
  .handler(async ({ data }) => {
    const { id } = (data ?? {}) as { id: string };
    const alert = farm.alerts.find((a) => a.id === id);
    if (!alert || alert.acknowledged) return { updated: false, reason: "already_acknowledged_or_missing" };
    alert.acknowledged = true;
    alert.acknowledgedAt = new Date().toISOString();
    return { updated: true, id };
  });

/** Alerts — dismiss (remove) an alert. */
export const dismissAlertFn = createServerFn({ method: "POST" })
  .handler(async ({ data }) => {
    const { id } = (data ?? {}) as { id: string };
    const idx = farm.alerts.findIndex((a) => a.id === id);
    if (idx === -1) return { updated: false, reason: "not_found" };
    farm.alerts.splice(idx, 1);
    return { updated: true, id };
  });
