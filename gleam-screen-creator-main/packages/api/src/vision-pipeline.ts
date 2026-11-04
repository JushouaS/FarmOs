import type { FastifyInstance } from "fastify";
import { env } from "./config.js";
import { classify, isNightAt, type BehaviorVerdict } from "./behavior.js";
import { readLighting } from "./lighting.js";

/**
 * Fetch → decide → persist, in one place.
 *
 * This used to live inside the /visual routes, which was fine until a timer
 * needed to do the same thing. Rather than copy the SQL and the night rule
 * into a second caller and let them drift, the whole pipeline sits here and
 * both the routes and the sampler call it.
 */

const VISION_BASE = env.VISION_SERVICE_URL;
const VISION_TOKEN = env.VISION_SERVICE_TOKEN;

/** Headers forwarded to the Flask service. */
export function visionHeaders(): Record<string, string> {
  return { "X-Vision-Token": VISION_TOKEN };
}

/** The vision service answered, but with an error; carries its status and body. */
export class VisionError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super("vision_error");
  }
}

/** One measurement pass on the camera's latest frame pair. */
export async function fetchAnalysis(cameraId: string): Promise<any> {
  const res = await fetch(`${VISION_BASE}/analyze/${encodeURIComponent(cameraId)}`, {
    method: "POST",
    headers: { ...visionHeaders(), "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    // M-7: truncate body to prevent internal Flask stack traces leaking to the client
    const body = (await res.text().catch(() => "")).slice(0, 500);
    // Surface the service's own error code when there is one. "frame_grab_failed"
    // tells an operator to look at the camera; "analyze_error" only says that
    // something, somewhere, went wrong.
    let code = "analyze_error";
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed?.error === "string") code = parsed.error;
    } catch {
      // Not JSON — keep the generic code.
    }
    throw new VisionError(res.status, { error: code, detail: body });
  }
  return res.json();
}

/** Apply the behaviour policy without touching the database. */
export async function decideVerdict(
  app: FastifyInstance,
  analysis: any,
): Promise<BehaviorVerdict> {
  const lighting = await readLighting(app);
  return classify(analysis?.metrics, {
    night: isNightAt(new Date(), lighting),
    warnings: analysis?.warnings ?? [],
  });
}

/**
 * Writes an /analyze result into Postgres, applying the behaviour policy first.
 *
 * Returns whether any row was written, plus the verdict that was stored.
 * Looks the camera up by id; if it has no matching `cameras` row (or the row
 * has no sensor/cohort to attach a weight sample to) the corresponding piece
 * is skipped rather than thrown.
 *
 * The verdict is decided here, not by the vision service: `classify` turns the
 * raw counts into Inactive / Huddling / Sleeping and applies the night
 * exception. So what lands in behavior_snapshots is a judgement that can be
 * read back and argued about, with the counts it came from stored beside it.
 *
 * `only` can leave out detections or cluster warnings (both default to saved).
 */
export async function persistAnalysis(
  app: FastifyInstance,
  cameraId: string,
  analysis: any,
  only: { detections?: boolean; clusters?: boolean } = {},
): Promise<{ wrote: boolean; behaviour: BehaviorVerdict }> {
  const behaviour = await decideVerdict(app, analysis);

  const cameraRows = await app.sqlRead`
    SELECT id, house_id AS "houseId" FROM cameras WHERE id = ${cameraId}`;
  if (cameraRows.count === 0) return { wrote: false, behaviour };
  const camera = cameraRows[0]!;

  let wrote = false;

  const detections: any[] =
    only.detections !== false && Array.isArray(analysis?.detections) ? analysis.detections : [];
  for (const d of detections) {
    const id = `D-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await app.sqlWrite`
      INSERT INTO detections (id, camera_id, frame_at, box_x, box_y, box_w, box_h, behavior, estimated_weight_g, weight_confidence, flag)
      VALUES (${id}, ${camera.id}, now(), ${d.box_x}, ${d.box_y}, ${d.box_w}, ${d.box_h}, ${d.behavior ?? "UNKNOWN"}, ${d.estimated_weight_g ?? null}, ${d.weight_confidence ?? null}, ${d.flag ?? null})`;
    wrote = true;
  }

  await app.sqlWrite`
    INSERT INTO behavior_snapshots (
      camera_id, at, movement_index, movement_label, movement_status,
      huddling_risk, huddling_label, huddling_status, aggression_events,
      bird_count, zone_count, evaluable_count, inactive_count, huddled_count,
      confidence, night, suppressed, reliable
    )
    VALUES (
      ${camera.id}, now(), ${behaviour.movement_index}, ${behaviour.movement_label},
      ${behaviour.movement_status}, ${behaviour.huddling_risk}, ${behaviour.huddling_label},
      ${behaviour.huddling_status}, ${behaviour.aggression_events},
      ${behaviour.bird_count}, ${behaviour.zone_count}, ${behaviour.evaluable_count},
      ${behaviour.inactive_count}, ${behaviour.huddled_count}, ${behaviour.confidence},
      ${behaviour.night}, ${behaviour.suppressed}, ${behaviour.reliable}
    )`;
  wrote = true;

  const clusters: any[] =
    only.clusters !== false && Array.isArray(analysis?.clusters) ? analysis.clusters : [];
  for (const cl of clusters) {
    await app.sqlWrite`
      INSERT INTO cluster_warnings (camera_id, raised_at, label, risk, box)
      VALUES (${camera.id}, now(), ${cl.label ?? "Cluster warning"}, ${cl.risk ?? 0}, ${JSON.stringify(cl.box ?? {})}::jsonb)`;
    wrote = true;
  }

  const weight = analysis?.weight;
  if (weight) {
    // volumetric_samples wants a sensor_id and (optionally) a cohort_id.
    // Best-effort lookup: any sensor on this camera's house; any cohort tied
    // to the same house. Skip the insert if neither resolves rather than
    // writing a row with a dangling/guessed foreign key.
    const sensorRows = await app.sqlRead`
      SELECT id FROM sensors WHERE house_id = ${camera.houseId} ORDER BY id LIMIT 1`;
    if (sensorRows.count > 0) {
      const cohortRows = await app.sqlRead`
        SELECT id FROM cohorts WHERE house_id = ${camera.houseId} ORDER BY updated_at DESC LIMIT 1`;
      await app.sqlWrite`
        INSERT INTO volumetric_samples (sensor_id, cohort_id, calculated_mass_g, density_ratio, precision_percent, sampled_at)
        VALUES (${sensorRows[0]!.id}, ${cohortRows[0]?.id ?? null}, ${weight.median_g ?? null}, ${null}, ${weight.confidence != null ? weight.confidence * 100 : null}, now())`;
      wrote = true;
    }
  }

  return { wrote, behaviour };
}

/** One full pass: measure, decide, record. */
export async function analyseAndPersist(
  app: FastifyInstance,
  cameraId: string,
  only: { detections?: boolean; clusters?: boolean } = {},
): Promise<{ analysis: any; wrote: boolean; behaviour: BehaviorVerdict }> {
  const analysis = await fetchAnalysis(cameraId);
  const { wrote, behaviour } = await persistAnalysis(app, cameraId, analysis, only);
  return { analysis, wrote, behaviour };
}
