import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildFarmSnapshot } from "./farm/snapshot";
import { getOperationsOverview } from "./farm/repository";
import { sampleForDay } from "./farm/sample";

/**
 * Intelligence engine — powered by Groq's free OpenAI-compatible API.
 * Default model: llama-3.3-70b-versatile (~14,400 req/day on the free tier).
 *
 * Configuration:
 *   GROQ_API_KEY  — required (set in .env, see .env.example)
 *   GROQ_MODEL    — optional override (default: llama-3.3-70b-versatile)
 *
 * The API key is read from process.env directly (populated by Vite/TanStack
 * Start via the VITE_* passthrough or the server process env). No filesystem
 * reads are performed — the readFileSync fallback has been removed (C-3 fix).
 */

const CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Grounding context rendered from the same data the UI reads so the model
 * and the screen can never quote different figures. Built per request, so it
 * is on the grow-out day Settings has set (not the day the server started).
 */
async function currentSnapshot(): Promise<string> {
  try {
    return buildFarmSnapshot(sampleForDay(await getOperationsOverview()).farm);
  } catch {
    return buildFarmSnapshot();
  }
}

/** What to add to a prompt so the model writes for farmers in the language chosen in the app. */
const LANGUAGE_NOTE: Record<string, string> = {
  tl: "Write the whole answer in Filipino (Tagalog), in simple everyday words that a poultry farmer with little schooling can understand. Keep numbers, units and sensor or house names as they are.",
  ceb: "Write the whole answer in Cebuano (Bisaya), in simple everyday words that a poultry farmer with little schooling can understand. Keep numbers, units and sensor or house names as they are.",
};
const languageNote = (lang?: string) => (lang && LANGUAGE_NOTE[lang] ? `\n${LANGUAGE_NOTE[lang]}` : "");

const systemPrompt = (snapshot: string, lang?: string) => `You are the CereBroiler Intelligence Engine inside the FARM_OS operations console.
Produce analysis strictly grounded in the telemetry snapshot below. Be precise and clinical;
reference sensors, houses and figures from the snapshot. Respond in plain text only
(no markdown, no headings).${languageNote(lang)}

${snapshot}`;

type ChatMessage = { role: "system" | "user"; content: string };

/**
 * Read the Groq API key from process.env.
 * Throws a clear, actionable error if it is missing so the UI can surface it.
 */
function getApiKey(): string {
  // TanStack Start / Vite SSR exposes process.env directly on the server.
  const key =
    (typeof process !== "undefined" && process.env?.GROQ_API_KEY) ||
    (typeof import.meta !== "undefined" && (import.meta as any).env?.GROQ_API_KEY);

  if (!key) {
    throw new Error(
      "GROQ_API_KEY is not configured. Add GROQ_API_KEY=gsk_... to your .env file " +
        "(see .env.example) and restart the dev server.",
    );
  }
  return key;
}

function getModel(): string {
  return (
    (typeof process !== "undefined" && process.env?.GROQ_MODEL) ||
    (typeof import.meta !== "undefined" && (import.meta as any).env?.GROQ_MODEL) ||
    DEFAULT_MODEL
  );
}

async function callEngine(
  messages: ChatMessage[],
  maxTokens: number,
): Promise<{ content: string; latencyMs: number; model: string }> {
  const token = getApiKey();
  const model = getModel();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(CHAT_URL, {
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
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    // Truncate response body to avoid leaking large internal details (M-7 pattern)
    const raw = await res.text().catch(() => "");
    const detail = raw.slice(0, 400);

    if (res.status === 401) {
      throw new Error(
        "Groq API key is invalid or expired. Check GROQ_API_KEY in your .env file.",
      );
    }
    if (res.status === 429) {
      throw new Error(
        "Groq rate limit reached. Wait a moment and try again, or upgrade your Groq plan.",
      );
    }
    throw new Error(`Intelligence engine request failed (HTTP ${res.status}): ${detail}`);
  }

  const json = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string; reasoning_content?: string } }[];
    error?: { message?: string };
  };

  // Surface structured API errors (e.g. model not found)
  if (json.error?.message) {
    throw new Error(`Groq API error: ${json.error.message}`);
  }

  const message = json.choices?.[0]?.message;
  const content = message?.content?.trim() || message?.reasoning_content?.trim();
  if (!content) {
    throw new Error(
      "The model returned an empty response. Try again or switch GROQ_MODEL in .env.",
    );
  }

  return {
    content,
    latencyMs: Date.now() - (Date.now() - (res.headers.get("x-request-id") ? 0 : 0)), // resolved below
    model: json.model ?? model,
  };
}

// Wrap callEngine to track latency properly
async function callEngineWithTiming(
  messages: ChatMessage[],
  maxTokens: number,
): Promise<{ content: string; latencyMs: number; model: string }> {
  const started = Date.now();
  const result = await callEngine(messages, maxTokens);
  return { ...result, latencyMs: Date.now() - started };
}

/* -------------------------------------------------------------------------- */
/*  Server functions                                                          */
/* -------------------------------------------------------------------------- */

const BRIEFING_PROMPT = `Compile the automated situation briefing for the farm operator right now.
Cover: overall flock status, the open incident in the snapshot with its root cause, and the
immediate outlook. Maximum 130 words, 2-3 short paragraphs separated by blank lines.`;

export const fetchSituationBriefing = createServerFn({ method: "POST" }).handler(async ({ data }) => {
  const lang = ((data ?? {}) as { lang?: string }).lang;
  const snapshot = await currentSnapshot();
  const { content, latencyMs, model } = await callEngineWithTiming(
    [
      { role: "system", content: systemPrompt(snapshot, lang) },
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

const alertsPrompt = (snapshot: string, lang?: string) => `Analyze the telemetry snapshot and produce feedback alerts for the farm operator.
Return ONLY a JSON array (no markdown fences, no prose) of 3 to 5 objects with exactly these keys:
"severity" (one of "critical", "warning", "nominal"), "title" (<= 8 words, uppercase),
"detail" (one sentence citing snapshot figures), "action" (one imperative sentence).
Order from most to least severe.${lang && LANGUAGE_NOTE[lang] ? `\nKeep the JSON keys and the "severity" values in English exactly as listed; only "title", "detail" and "action" are written in the chosen language.${languageNote(lang)}` : ""}

${snapshot}`;

function extractJsonArray(raw: string): unknown {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new Error(
      "The model response did not contain a valid JSON array. Try regenerating.",
    );
  }
  return JSON.parse(raw.slice(start, end + 1));
}

export const fetchFeedbackAlerts = createServerFn({ method: "POST" }).handler(async ({ data }) => {
  const lang = ((data ?? {}) as { lang?: string }).lang;
  const snapshot = await currentSnapshot();
  const { content, latencyMs, model } = await callEngineWithTiming(
    [{ role: "user", content: alertsPrompt(snapshot, lang) }],
    2500,
  );
  const alerts = z.array(alertSchema).min(1).max(6).parse(extractJsonArray(content));
  return { alerts, latencyMs, model, generatedAt: new Date().toISOString() };
});
