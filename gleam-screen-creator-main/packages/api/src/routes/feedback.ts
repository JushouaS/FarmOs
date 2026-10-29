import type { FastifyInstance } from "fastify";
import { appendFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { env } from "../config.js";

/**
 * Two separate forms, two separate CSV files:
 *
 *   POST /feedback/report  "Report a problem": a free-text note.
 *   POST /feedback/sus     the System Usability Scale questionnaire.
 *
 * Each response is (1) appended to a local CSV, which is the copy of record,
 * then (2) sent to the owner's Google Apps Script, which appends it to a .csv
 * of the same name in their Google Drive. A Google failure never loses a
 * response: the local row is already written, and the failure is logged for
 * the owner.
 *
 * Respondents are anonymous by default: no user id or email is stored, only
 * the name/code and role they choose to type.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const dataDir = resolve(here, "..", "..", "data");

export const SUS_FILE = "sus_responses.csv";
export const REPORT_FILE = "problem_reports.csv";

export const SUS_HEADER = [
  "timestamp",
  "respondent",
  "role",
  ...Array.from({ length: 10 }, (_, i) => `q${i + 1}`),
  "sus_score",
  "interpretation",
] as const;

export const REPORT_HEADER = ["timestamp", "respondent", "role", "page", "problem"] as const;

const susBody = z
  .object({
    respondent: z.string().trim().max(80).optional(),
    role: z.string().trim().max(80).optional(),
    answers: z.array(z.number().int().min(1).max(5)).length(10),
  })
  .strict();

const reportBody = z
  .object({
    respondent: z.string().trim().max(80).optional(),
    role: z.string().trim().max(80).optional(),
    page: z.string().trim().max(200).optional(),
    problem: z.string().trim().min(1).max(2000),
  })
  .strict();

/** Standard SUS scoring: odd items contribute (answer - 1), even items
 *  (5 - answer); the sum times 2.5 gives 0 to 100. */
export function susScore(answers: readonly number[]): number {
  const sum = answers.reduce((acc, a, i) => acc + ((i + 1) % 2 === 1 ? a - 1 : 5 - a), 0);
  return Math.round(sum * 2.5 * 10) / 10;
}

/** Same bands the camera service's questionnaire used. */
export function susInterpretation(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 73) return "Good";
  if (score >= 68) return "OK";
  if (score >= 51) return "Poor";
  return "Awful";
}

type Row = ReadonlyArray<string | number>;

/** One CSV cell. Text starting with = + - @ (or a tab/CR) would run as a
 *  formula when the file is opened in Excel or Sheets, so it is defused with
 *  a leading apostrophe; everything is quoted. */
function csvCell(value: string | number): string {
  if (typeof value === "number") return String(value);
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const csvLine = (cells: Row) => cells.map(csvCell).join(",") + "\r\n";

/** An append-only CSV file. Appends are queued so two submissions can't
 *  interleave or both write a header. */
function csvStore(path: string, header: Row) {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    append(row: Row): Promise<void> {
      const run = async () => {
        await mkdir(dirname(path), { recursive: true });
        const needsHeader = await stat(path).then((s) => s.size === 0, () => true);
        // The BOM makes Excel read names with accents or non-Latin letters correctly.
        const text = (needsHeader ? "﻿" + csvLine(header) : "") + csvLine(row);
        await appendFile(path, text, "utf8");
      };
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next;
    },
  };
}

const susStore = csvStore(env.SUS_CSV_PATH ? resolve(env.SUS_CSV_PATH) : resolve(dataDir, SUS_FILE), SUS_HEADER);
const reportStore = csvStore(
  env.REPORT_CSV_PATH ? resolve(env.REPORT_CSV_PATH) : resolve(dataDir, REPORT_FILE),
  REPORT_HEADER,
);

type GoogleResult = { status: "sent" | "skipped" } | { status: "failed"; reason: string };

/** `file` is the Drive file the script appends to; the script only accepts
 *  the two names above. */
async function sendToGoogle(file: string, header: Row, row: Row): Promise<GoogleResult> {
  const url = env.SUS_GOOGLE_SCRIPT_URL;
  const token = env.SUS_GOOGLE_SCRIPT_TOKEN;
  if (!url || !token) return { status: "skipped" };
  try {
    const res = await fetch(url, {
      method: "POST",
      // text/plain: Apps Script reads the raw body either way.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token, file, header, row }),
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (res.ok && json?.ok === true) return { status: "sent" };
    throw new Error(json?.error ?? `HTTP ${res.status}`);
  } catch (err) {
    // The URL and token are deliberately left out of the reason.
    return { status: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function registerFeedbackRoutes(app: FastifyInstance) {
  const options = { preHandler: [requireAuth], config: { rateLimit: { max: 10, timeWindow: "1 hour" } } };

  app.post("/report", options, async (request, reply) => {
    const parsed = reportBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { respondent, role, page, problem } = parsed.data;
    const row: Row = [new Date().toISOString(), respondent || "anonymous", role ?? "", page ?? "", problem];

    try {
      await reportStore.append(row);
    } catch (err) {
      request.log.error({ err }, "could not write the problem report to the local CSV");
      return reply.code(500).send({ error: "could_not_save" });
    }

    const google = await sendToGoogle(REPORT_FILE, REPORT_HEADER, row);
    if (google.status === "failed") {
      request.log.warn(
        { reason: google.reason },
        "problem report saved locally but NOT sent to Google; check SUS_GOOGLE_SCRIPT_URL/TOKEN and the Apps Script deployment",
      );
    }
    return reply.code(201).send({ ok: true });
  });

  app.post("/sus", options, async (request, reply) => {
    const parsed = susBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { respondent, role, answers } = parsed.data;
    const score = susScore(answers);
    const interpretation = susInterpretation(score);
    const row: Row = [new Date().toISOString(), respondent || "anonymous", role ?? "", ...answers, score, interpretation];

    try {
      await susStore.append(row);
    } catch (err) {
      request.log.error({ err }, "could not write the SUS response to the local CSV");
      return reply.code(500).send({ error: "could_not_save" });
    }

    const google = await sendToGoogle(SUS_FILE, SUS_HEADER, row);
    if (google.status === "failed") {
      request.log.warn(
        { reason: google.reason },
        "SUS response saved locally but NOT sent to Google; check SUS_GOOGLE_SCRIPT_URL/TOKEN and the Apps Script deployment",
      );
    }
    // The score stays server side: it goes in the CSV, not back to the respondent.
    return reply.code(201).send({ ok: true });
  });
}
