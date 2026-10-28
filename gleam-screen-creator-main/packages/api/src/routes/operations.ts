import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/middleware.js";

// Ross 308's published cumulative feed-conversion-ratio target is day-indexed
// in the breed standard table; this uses the flat mid-cycle figure the UI
// previously hardcoded (1.70) until a day-indexed target table is modeled.
// Tracked separately from `cycle_weights.standard_g`, which IS already a
// real per-day stored standard.
const FCR_TARGET = 1.70;

// Ross 308 grow-out length the UI measures progress against ("Day N/42").
const GROW_OUT_DAYS = 42;

/**
 * GET /operations/overview
 * Mirrors the `getOperationsOverview` server function — this is the full
 * shape index.tsx's Dashboard renders (summary/activity/weight/water/feed/
 * cluster/lastAnomaly), not just the facility/houses/cycle/alerts subset
 * this route returned before.
 */
export async function registerOperationsRoutes(app: FastifyInstance) {
  app.get("/overview", { preHandler: [requireAuth] }, async (request, reply) => {
    const facility = await app.sqlRead`
      SELECT id, name, breed, house_range_label AS "houseRange"
      FROM facilities LIMIT 1`;
    if (facility.count === 0) return reply.code(404).send({ error: "no_facility" });
    const f = facility[0]!;

    const houses = await app.sqlRead`
      SELECT id, label, section, population
      FROM houses WHERE facility_id = ${f.id} AND is_active = true
      ORDER BY sort_order`;

    // The grow-out day is measured to the facility's latest sensor reading,
    // not the wall clock: a cycle whose data stops (seed snapshot, offline
    // sensors) would otherwise keep counting into nonsense like "Day 929/42".
    // Live data keeps this at today. Capped to the grow-out length.
    const cycle = await app.sqlRead`
      WITH latest AS (
        SELECT LEAST(CURRENT_DATE, COALESCE(max(r.recorded_at)::date, CURRENT_DATE)) AS as_of
        FROM sensor_readings r
        JOIN sensors s ON s.id = r.sensor_id
        JOIN houses h ON h.id = s.house_id
        WHERE h.facility_id = ${f.id}
      )
      SELECT c.id, c.label,
             c.start_date::text AS "startDate",
             c.projected_yield_date::text AS "projectedYieldDate",
             GREATEST(0, LEAST(${GROW_OUT_DAYS}, latest.as_of - c.start_date))::int AS day,
             latest.as_of::text AS "dataAsOf",
             (c.start_date + interval '6 days')::text AS "windowStart",
             (c.start_date + interval '41 days')::text AS "windowEnd",
             now()::text AS "asOf"
      FROM flock_cycles c, latest
      WHERE c.facility_id = ${f.id} AND c.status = 'active'
      LIMIT 1`;
    const activeCycle = cycle[0] ?? null;

    const latestReadings = await app.sqlRead`
      SELECT DISTINCT ON (s.id) s.id AS "sensorId", s.house_id AS "houseId",
             st.code AS parameter, s.code, s.label,
             r.value, r.unit, r.status, r.recorded_at AS "recordedAt",
             sb.lower_bound AS "boundsMin", sb.upper_bound AS "boundsMax",
             sb.display_label AS "boundsLabel"
      FROM sensor_readings r
      JOIN sensors s ON s.id = r.sensor_id
      JOIN sensor_types st ON st.code = s.sensor_type_code
      LEFT JOIN LATERAL (
        SELECT lower_bound, upper_bound, display_label
        FROM sensor_bounds
        WHERE sensor_id = s.id AND effective_from <= CURRENT_DATE
          AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        ORDER BY effective_from DESC LIMIT 1
      ) sb ON true
      ORDER BY s.id, r.recorded_at DESC`;

    const alerts = await app.sqlRead`
      SELECT id, kind, severity, message, raised_at AS "raisedAt", acknowledged
      FROM alerts
      WHERE facility_id = ${f.id}
      ORDER BY raised_at DESC LIMIT 50`;

    const platform = await app.sqlRead`
      SELECT app_version AS "appVersion", release_channel AS "releaseChannel",
             api_version AS "apiVersion", ml_model AS "mlModel", llm,
             cpu_percent AS "cpuPercent", ram_gb AS "ramGb", status
      FROM platform_status LIMIT 1`;

    // ---- weight (WeightAnalytics) --------------------------------------
    const weightCurve = activeCycle
      ? await app.sqlRead`
          SELECT day, actual_g AS "actualG", standard_g AS "standardG"
          FROM cycle_weights WHERE cycle_id = ${activeCycle.id} ORDER BY day ASC`
      : [];
    const latestWeightRow = activeCycle
      ? await app.sqlRead`
          SELECT actual_g AS "actualG", standard_g AS "standardG",
                 sample_size AS "sampleSize", estimation_confidence AS "estimationConfidence"
          FROM cycle_weights WHERE cycle_id = ${activeCycle.id} ORDER BY day DESC LIMIT 1`
      : [];
    const lw = latestWeightRow[0] ?? null;
    const variancePercent = lw && lw.standardG ? ((lw.actualG - lw.standardG) / lw.standardG) * 100 : 0;
    const estimationConfidencePercent = lw?.estimationConfidence != null ? lw.estimationConfidence * 100 : null;
    const weight = {
      actualAvgG: lw?.actualG ?? null,
      standardG: lw?.standardG ?? null,
      variancePercent,
      // Only one confidence figure is actually stored (estimation_confidence);
      // used for both fields pending a separate model-confidence column.
      modelConfidence: estimationConfidencePercent,
      estimationConfidencePercent,
      sampleSize: lw?.sampleSize ?? null,
      status: variancePercent >= 0 ? "optimal" : variancePercent > -5 ? "nominal" : "warning",
      curve: weightCurve,
    };

    // ---- feed (FeedMetrics) ---------------------------------------------
    const feedRows = activeCycle
      ? await app.sqlRead`
          SELECT day, fcr, adg_g AS "adgG", consumed_kg AS "consumedKg"
          FROM feed_samples WHERE cycle_id = ${activeCycle.id} ORDER BY recorded_at ASC`
      : [];
    const latestFeed = feedRows[feedRows.length - 1] ?? null;
    const previousFeed = feedRows[feedRows.length - 2] ?? null;
    const cycleCountRows = await app.sqlRead`
      SELECT count(*)::int AS n FROM flock_cycles WHERE facility_id = ${f.id} AND status = 'completed'`;
    const feed = {
      fcr: latestFeed?.fcr ?? null,
      fcrTarget: FCR_TARGET,
      fcrDelta: latestFeed && previousFeed ? latestFeed.fcr - previousFeed.fcr : 0,
      adgG: latestFeed?.adgG ?? null,
      cycleNumber: (cycleCountRows[0]?.n ?? 0) + 1,
      cycleConsumedKg: feedRows.reduce((sum, r) => sum + (Number(r.consumedKg) || 0), 0),
      series: feedRows.map((r) => r.fcr).filter((v) => v != null).slice(-8),
    };

    // ---- water (WaterMetrics) --------------------------------------------
    const waterRows = activeCycle
      ? await app.sqlRead`
          SELECT litres_per_hour AS "litresPerHour", status
          FROM water_samples WHERE cycle_id = ${activeCycle.id} ORDER BY recorded_at ASC`
      : [];
    const latestWater = waterRows[waterRows.length - 1] ?? null;
    const water = {
      intakeLitresPerHour: latestWater?.litresPerHour ?? null,
      status: latestWater?.status ?? "nominal",
      series: waterRows.map((r) => r.litresPerHour).slice(-8),
    };

    // ---- activity (ActivityIndex) -----------------------------------------
    const activityRows = activeCycle
      ? await app.sqlRead`
          SELECT value, unit, recorded_at AS "recordedAt"
          FROM activity_samples WHERE cycle_id = ${activeCycle.id} ORDER BY recorded_at ASC`
      : [];
    const activitySeries = activityRows.map((r) => Number(r.value));
    // null, not 0, when nothing has been recorded: 0 reads as "no bird is
    // moving", which the dashboard would report as the whole flock inactive.
    const latestActivity = activitySeries[activitySeries.length - 1] ?? null;
    const previousActivity = activitySeries[activitySeries.length - 2] ?? latestActivity;
    const activity = {
      value: latestActivity,
      unit: activityRows[activityRows.length - 1]?.unit ?? "IDX",
      baseline: activitySeries.length > 0
        ? activitySeries.reduce((a, b) => a + b, 0) / activitySeries.length
        : null,
      trend: latestActivity === null || previousActivity === null
        ? "flat"
        : latestActivity > previousActivity ? "up" : latestActivity < previousActivity ? "down" : "flat",
      series: activitySeries.slice(-24),
      axisLabels: activityRows.slice(-24).map((r) => new Date(r.recordedAt as string).toISOString().slice(11, 16)),
    };

    // ---- cluster: sensor readings for the (first online) live camera's house ----
    const liveCamRows = await app.sqlRead`
      SELECT c.id, c.house_id AS "houseId", h.label AS "houseLabel"
      FROM cameras c JOIN houses h ON h.id = c.house_id
      WHERE c.online = true ORDER BY c.id LIMIT 1`;
    const liveCam = liveCamRows[0] ?? null;
    const clusterReadingRows = liveCam
      ? await app.sqlRead`
          SELECT DISTINCT ON (s.id) st.code AS parameter, r.value, r.unit, r.status,
                 sb.display_label AS "boundsLabel"
          FROM sensor_readings r
          JOIN sensors s ON s.id = r.sensor_id
          JOIN sensor_types st ON st.code = s.sensor_type_code
          LEFT JOIN LATERAL (
            SELECT display_label FROM sensor_bounds
            WHERE sensor_id = s.id AND effective_from <= CURRENT_DATE
              AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
            ORDER BY effective_from DESC LIMIT 1
          ) sb ON true
          WHERE s.house_id = ${liveCam.houseId}
          ORDER BY s.id, r.recorded_at DESC`
      : [];
    // index.tsx reads `reading.bounds.label` — nest it to match, rather than
    // changing the frontend's access pattern for this one field.
    const clusterReadings = clusterReadingRows.map((r) => ({
      parameter: r.parameter, value: r.value, unit: r.unit, status: r.status,
      bounds: { label: r.boundsLabel ?? null },
    }));
    const cluster = liveCam
      ? { houseId: liveCam.houseId, houseLabel: liveCam.houseLabel, readings: clusterReadings }
      : null;

    // ---- flock-wide weight standard deviation (avg across this facility's cohorts) ----
    const stdDevRows = await app.sqlRead`
      SELECT AVG(co.standard_deviation_g)::numeric AS "avg"
      FROM cohorts co JOIN houses h ON h.id = co.house_id
      WHERE h.facility_id = ${f.id}`;
    const flockStandardDeviationG = stdDevRows[0]?.avg != null ? Math.round(Number(stdDevRows[0].avg)) : null;

    // ---- last anomaly -------------------------------------------------------
    const lastAnomalyRows = await app.sqlRead`
      SELECT id, at::text AS at, severity, label
      FROM anomaly_events WHERE facility_id = ${f.id} ORDER BY at DESC LIMIT 1`;
    const lastAnomaly = lastAnomalyRows[0] ?? null;
    const minutesSinceLastAnomaly = lastAnomaly
      ? Math.round((Date.now() - new Date(lastAnomaly.at).getTime()) / 60_000)
      : null;

    // ---- latest monitoring report (ReportMeta) -------------------------------
    const reportRows = await app.sqlRead`
      SELECT id, grounding_id AS "groundingId", generated_at::text AS "generatedAt", last_scan_at::text AS "lastScanAt"
      FROM monitoring_reports WHERE facility_id = ${f.id} ORDER BY generated_at DESC LIMIT 1`;

    // ---- summary (FlockSummary) — worst-of across the pieces above -----------
    const hasCritical = alerts.some((a) => a.severity === "critical" && !a.acknowledged);
    const hasWarning = alerts.some((a) => a.severity === "warning" && !a.acknowledged) || weight.status === "warning";
    const summary = {
      status: hasCritical ? "critical" : hasWarning ? "warning" : weight.status === "optimal" ? "optimal" : "nominal",
      confidence: estimationConfidencePercent ?? 80,
    };

    return reply.send({
      facility: f,
      houses,
      cycle: activeCycle,
      platform: platform[0] ?? null,
      readings: latestReadings,
      alerts,
      summary,
      activity,
      weight,
      water,
      feed,
      cluster,
      lastAnomaly,
      minutesSinceLastAnomaly,
      report: reportRows[0] ?? null,
      flockStandardDeviationG,
    });
  });
}
