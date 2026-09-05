import {
  activeIncident,
  farm,
  flockPopulation,
  houseLabel,
  houseReadings,
  liveCamera,
  minutesSinceLastAnomaly,
  readingByCode,
} from "./dataset";
import {
  formatDeltaVsBaseline,
  formatDuration,
  formatGrams,
  formatMeasurement,
  formatNumber,
  formatPercent,
  formatSignedPercent,
  formatWindow,
} from "./format";

/**
 * Grounding context for the intelligence engine, rendered from the same dataset
 * the UI reads. Keeping the prompt generated (rather than hand-written) means
 * the model can never be briefed on figures that differ from the screen.
 */
export function buildFarmSnapshot(): string {
  const { facility, cycle, platform, weight, activity, feed, water, behavior } = farm;
  const incident = activeIncident();
  const camera = liveCamera();
  const cameraHouse = houseLabel(camera.houseId);
  const cluster = houseReadings(camera.houseId)
    .map((r) => `${r.label.toLowerCase()} ${formatMeasurement(r.value, r.unit).toLowerCase()}`)
    .join(", ");
  const nh3Current = readingByCode(`NH3_${incident.houseId}`);

  return [
    `FARM TELEMETRY SNAPSHOT (${facility.name} FARM_OS v${platform.appVersion})`,
    `- Facility: ${facility.houseRange}, ${facility.breed} broilers, grow-out day ${cycle.day}, ${formatNumber(flockPopulation())} birds.`,
    `- Real-time activity index: ${activity.value} ${activity.unit} vs ${activity.baseline} baseline, trending ${activity.trend} over last 24h.`,
    `- Weight: actual avg ${formatGrams(weight.actualAvgG)} vs breed standard ${formatGrams(weight.standardG)} (${formatSignedPercent(weight.variancePercent)} variance, ${weight.status.toUpperCase()}, model conf ${formatPercent(weight.modelConfidence * 100)}).`,
    `- Estimation confidence: ${formatPercent(weight.estimationConfidencePercent, 0)} over ${formatNumber(weight.sampleSize)} weighed birds.`,
    `- Feed: FCR ${feed.fcr} vs target ${feed.fcrTarget}, ADG ${feed.adgG} g/day. Water intake ${formatNumber(water.intakeLitresPerHour)} L/h.`,
    `- ${cameraHouse} environment: ${cluster} — within bounds.`,
    `- Open incident (${incident.id}, ${incident.status}): ${houseLabel(incident.houseId)} activity dropped ${formatPercent(incident.activityDropPercent)} between ${formatWindow(incident.startedAt, incident.endedAt)}. Sensor ${incident.peak.sensorId} peaked at ${formatMeasurement(incident.peak.value, incident.peak.unit.toLowerCase())} (${formatDeltaVsBaseline(incident.peak.value, incident.peak.baseline)} vs ${incident.peak.baseline} ppm baseline), above the ${incident.peak.threshold} ppm threshold for ${formatDuration(incident.exceedanceMinutes)}. Cause: ${incident.cause}. ${incident.resolution}; current reading ${formatMeasurement(nh3Current.value, nh3Current.unit.toLowerCase())}.`,
    `- Camera AI (${incident.evidence.cameraId}): ${incident.evidence.detectionLabel} warning flagged (${incident.evidence.detectionConfidence} confidence) in the ${houseLabel(incident.houseId)} replay.`,
    `- Behavior on ${camera.id}: movement index ${behavior.movementIndex} (${behavior.movementLabel}), huddling risk ${formatPercent(behavior.huddlingRisk * 100, 0)}, ${behavior.aggressionEvents} aggression events.`,
    `- Last logged anomaly: ${farm.timeline.events[farm.timeline.events.length - 1].label}, ${formatDuration(minutesSinceLastAnomaly())} ago.`,
    `- Platform: API_${platform.apiVersion}, ML_MODEL_${platform.mlModel}, inference latency ${platform.inferenceLatencyMs} ms, CPU ${platform.cpuPercent}%, RAM ${platform.ramGb} GB, status ${platform.status.toUpperCase()}.`,
  ].join("\n");
}
