import type { FastifyInstance } from "fastify";
import { requireAuth, requireRole } from "../auth/middleware.js";

/**
 * Reports + archive.
 *
 * GET  /reports            — list of monitoring reports
 * GET  /reports/:id        — single report with findings
 * GET  /reports/archive    — archived exports
 */
export async function registerReportRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: [requireAuth] }, async (_request, reply) => {
    const rows = await app.sqlRead`
      SELECT id, facility_id AS "facilityId", grounding_id AS "groundingId",
             generated_at::text AS "generatedAt", last_scan_at::text AS "lastScanAt",
             generated_by AS "generatedBy"
      FROM monitoring_reports
      ORDER BY generated_at DESC LIMIT 100`;
    return reply.send(rows);
  });

  app.get("/archive", { preHandler: [requireAuth] }, async (_request, reply) => {
    const rows = await app.sqlRead`
      SELECT id, title, format, generated_at::text AS "generatedAt",
             size_mb AS "sizeMb", is_featured AS "featured", note, file_url AS "fileUrl"
      FROM archived_reports
      ORDER BY generated_at DESC`;
    return reply.send(rows);
  });

  app.get("/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const report = await app.sqlRead`
      SELECT id, facility_id AS "facilityId", grounding_id AS "groundingId",
             generated_at::text AS "generatedAt", last_scan_at::text AS "lastScanAt"
      FROM monitoring_reports WHERE id = ${id}`;
    if (report.count === 0) return reply.code(404).send({ error: "not_found" });

    const findings = await app.sqlRead`
      SELECT parameter, source_label AS "source", value, unit,
             bounds_label AS "boundsLabel", status
      FROM report_findings WHERE report_id = ${id}
      ORDER BY sort_order ASC`;

    return reply.send({ report: report[0], findings });
  });

  // Placeholder for report generation; the LLM engine is owned by the
  // intelligence service, which is implemented separately.
  app.post("/generate", { preHandler: [requireAuth, requireRole("ADMIN", "FARM_MANAGER")] }, async (_request, reply) => {
    return reply.code(501).send({ error: "not_implemented", message: "Report generation is orchestrated by the intelligence service." });
  });
}
