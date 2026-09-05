import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/middleware.js";

/**
 * GET /intelligence/report — the latest monitoring report with its findings,
 * reference docs, incident detail, and archived exports.
 */
export async function registerIntelligenceRoutes(app: FastifyInstance) {
  app.get("/report", { preHandler: [requireAuth] }, async (request, reply) => {
    const report = await app.sqlRead`
      SELECT id, facility_id AS "facilityId", grounding_id AS "groundingId",
             generated_at::text AS "generatedAt", last_scan_at::text AS "lastScanAt"
      FROM monitoring_reports
      ORDER BY generated_at DESC LIMIT 1`;
    if (report.count === 0) return reply.code(404).send({ error: "no_report" });
    const r = report[0]!;

    const findings = await app.sqlRead`
      SELECT id, parameter, source_label AS "source", value, unit,
             bounds_label AS "boundsLabel", status
      FROM report_findings
      WHERE report_id = ${r.id}
      ORDER BY sort_order ASC`;

    const incident = await app.sqlRead`
      SELECT i.id, i.house_id AS "houseId", h.label AS "houseLabel",
             i.title, i.started_at::text AS "startedAt", i.ended_at::text AS "endedAt",
             i.exceedance_minutes AS "exceedanceMinutes",
             i.activity_drop_percent AS "activityDropPercent",
             i.cause, i.resolution, i.status,
             p.sensor_id AS "peakSensorId", p.parameter AS "peakParameter",
             p.value AS "peakValue", p.unit AS "peakUnit",
             p.threshold AS "peakThreshold", p.baseline AS "peakBaseline",
             e.camera_id AS "evidenceCameraId", e.clip_id AS "evidenceClipId",
             e.captured_at::text AS "evidenceCapturedAt",
             e.detection_label AS "evidenceLabel",
             e.detection_confidence AS "evidenceConfidence",
             e.image_url AS "evidenceImageUrl"
      FROM incidents i
      JOIN houses h ON h.id = i.house_id
      LEFT JOIN incident_peaks p ON p.incident_id = i.id
      LEFT JOIN incident_evidence e ON e.incident_id = i.id
      WHERE i.status <> 'closed'
      ORDER BY i.started_at DESC
      LIMIT 1`;

    const peakSeries = incident.count > 0
      ? await app.sqlRead`
          SELECT sample_index AS "sampleIndex", value
          FROM incident_peak_series
          WHERE incident_id = ${incident[0]!.id}
          ORDER BY sample_index ASC`
      : [];

    const references = await app.sqlRead`
      SELECT id, quote, cited_threshold AS "citedThreshold", unit, document_ref AS "documentRef"
      FROM reference_docs
      ORDER BY id`;

    const archive = await app.sqlRead`
      SELECT id, title, format, generated_at::text AS "generatedAt",
             size_mb AS "sizeMb", is_featured AS "featured", note
      FROM archived_reports
      ORDER BY generated_at DESC`;

    return reply.send({
      report: r,
      findings,
      incident: incident[0]
        ? { ...incident[0], peakSeries: peakSeries.map((s) => s.value) }
        : null,
      references,
      archive,
    });
  });
}
