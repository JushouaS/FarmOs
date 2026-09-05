import { readFileSync } from "node:fs";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildFarmSnapshot } from "./farm/snapshot";

/**
 * Intelligence engine for the Intelligence page — served by Groq's free
 * OpenAI-compatible API (default model: Llama 3.3 70B). Groq's free tier
 * (~14,400 req/day) replaces the earlier moonshotai/Kimi-K3 route through the
 * Hugging Face Inference Providers router, which billed per token.
 */
const CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Grounding context, rendered from the same dataset the pages read
 * (`src/lib/farm`) so the model and the UI can never quote different figures.
 */
const FARM_SNAPSHOT = buildFarmSnapshot();

const SYSTEM_PROMPT = `You are the CereBroiler Intelligence Engine inside the FARM_OS operations console.
Produce analysis strictly grounded in the telemetry snapshot below. Be precise and clinical;
reference sensors, houses and figures from the snapshot. Respond in plain text only
(no markdown, no headings).

${FARM_SNAPSHOT}`;

type ChatMessage = { role: "system" | "user"; content: string };

/**
 * Vite does not copy .env into process.env for SSR modules, so fall back to
 * parsing the project .env file once at module load.
 */
function loadApiKey(): string | undefined {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  try {
    const line = readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("GROQ_API_KEY="));
    const value = line?.slice("GROQ_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
    return value || undefined;
  } catch {
    return undefined;
  }
}

async function callEngine(
  messages: ChatMessage[],
  maxTokens: number,
): Promise<{ content: string; latencyMs: number; model: string }> {
  const token = loadApiKey();
  if (!token) {
    throw new Error(
      "GROQ_API_KEY is not configured. Add GROQ_API_KEY=gsk_... to the .env file (see .env.example) and restart the dev server.",
    );
  }

  const model = process.env.GROQ_MODEL ?? DEFAULT_MODEL;
  const started = Date.now();
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Intelligence engine request failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string; reasoning_content?: string } }[];
  };
  // Reasoning models (e.g. gpt-oss via GROQ_MODEL override) place the final
  // answer in `content` after the reasoning budget; fall back to
  // `reasoning_content` if content came back empty.
  const message = json.choices?.[0]?.message;
  const content = message?.content?.trim() || message?.reasoning_content?.trim();
  if (!content) throw new Error("The model returned an empty response.");

  return { content, latencyMs: Date.now() - started, model: json.model ?? model };
}

/** Situation briefing — auto-generated from the current telemetry, no operator input. */
const BRIEFING_PROMPT = `Compile the automated situation briefing for the farm operator right now.
Cover: overall flock status, the open incident in the snapshot with its root cause, and the
immediate outlook. Maximum 130 words, 2-3 short paragraphs separated by blank lines.`;

export const fetchSituationBriefing = createServerFn({ method: "POST" }).handler(async () => {
  const { content, latencyMs, model } = await callEngine(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: BRIEFING_PROMPT },
    ],
    2000,
  );
  return { briefing: content, latencyMs, model, generatedAt: new Date().toISOString() };
});

const alertSchema = z.object({
  severity: z.enum(["critical", "warning", "nominal"]),
  title: z.string().min(1).max(80),
  detail: z.string().min(1).max(300),
  action: z.string().min(1).max(200),
});

export type FeedbackAlert = z.infer<typeof alertSchema>;

const ALERTS_PROMPT = `Analyze the telemetry snapshot and produce feedback alerts for the farm operator.
Return ONLY a JSON array (no markdown fences, no prose) of 3 to 5 objects with exactly these keys:
"severity" (one of "critical", "warning", "nominal"), "title" (<= 8 words, uppercase),
"detail" (one sentence citing snapshot figures), "action" (one imperative sentence).
Order from most to least severe.

${FARM_SNAPSHOT}`;

function extractJsonArray(raw: string): unknown {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new Error("The model response did not contain a JSON array.");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

/** Feedback alerts — model-generated triage of the current telemetry. */
export const fetchFeedbackAlerts = createServerFn({ method: "POST" }).handler(async () => {
  const { content, latencyMs, model } = await callEngine(
    [{ role: "user", content: ALERTS_PROMPT }],
    2500,
  );
  const alerts = z.array(alertSchema).min(1).max(6).parse(extractJsonArray(content));
  return { alerts, latencyMs, model, generatedAt: new Date().toISOString() };
});
