import type { FastifyInstance } from "fastify";
import nodemailer, { type Transporter } from "nodemailer";
import webpush from "web-push";
import { env } from "./config.js";

/**
 * Alerts and notifications.
 *
 * raiseAlert() is how anything in the system raises an alert (the camera's
 * detection, the mortality log, ...). It saves the alert, then sends it to every
 * active user the way their Settings ask:
 *
 *   in app  always: a row in `notifications`, shown on the Notifications page.
 *   email   when the person turned it on, the alert is at or above their level,
 *           it is not quiet hours (critical alerts ignore quiet hours), and SMTP
 *           is set up (SMTP_HOST and SMTP_FROM in .env).
 *   push    the same rules, to every browser the person allowed (VAPID keys in .env).
 *
 * Every email or push attempt is written to `notifications` with its channel,
 * and delivered_at or failed_at with the reason, so a failed send can be found.
 * The Notifications page only lists the in_app rows.
 */

export type Severity = "optimal" | "nominal" | "deviation" | "warning" | "critical";

const RANK: Record<string, number> = { optimal: 0, nominal: 1, info: 1, deviation: 2, warning: 3, critical: 4 };
const rank = (severity: string): number => RANK[severity.toLowerCase()] ?? 2;

export const emailConfigured = (): boolean => Boolean(env.SMTP_HOST && env.SMTP_FROM);
export const pushConfigured = (): boolean => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

let transport: Transporter | null = null;
function mailer(): Transporter {
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE === "true",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transport;
}

let vapidReady = false;
function initPush(): boolean {
  if (!pushConfigured()) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
    vapidReady = true;
  }
  return true;
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

/** True when `now` (this computer's local time) is inside the quiet hours; they may wrap past midnight. */
export function inQuietHours(start: string | null, end: string | null, now: Date): boolean {
  if (!start || !end) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === to) return false;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

export interface Notice {
  title: string;
  body: string;
  kind: string;
  severity: Severity;
}

interface User {
  id: string;
  email: string;
  fullName: string | null;
}

interface Pref {
  channel: string;
  enabled: boolean;
  minSeverity: string;
  quietStart: string | null;
  quietEnd: string | null;
}

/** What the Settings card shows when a person never saved anything: email on from "warning" up, push off. */
const DEFAULT_PREFS: Record<string, Pref> = {
  email: { channel: "email", enabled: true, minSeverity: "warning", quietStart: null, quietEnd: null },
  push: { channel: "push", enabled: false, minSeverity: "warning", quietStart: null, quietEnd: null },
};

export interface ChannelResult {
  /** "sent", "skipped" (the person's settings say not to), or "failed". */
  status: "sent" | "skipped" | "failed";
  /** Why it was skipped or failed. */
  reason?: string;
}

async function record(
  app: FastifyInstance,
  user: User,
  channel: "in_app" | "email" | "push",
  notice: Notice,
  outcome: { ok: boolean; reason?: string },
): Promise<void> {
  await app.sqlWrite`
    INSERT INTO notifications (user_id, title, body, channel, kind, severity, delivered_at, failed_at, failure_reason)
    VALUES (${user.id}, ${notice.title}, ${notice.body}, ${channel}, ${notice.kind}, ${notice.severity},
            ${outcome.ok ? new Date() : null}, ${outcome.ok ? null : new Date()}, ${outcome.reason ?? null})`;
}

async function sendEmail(user: User, notice: Notice): Promise<{ ok: boolean; reason?: string }> {
  if (!emailConfigured()) return { ok: false, reason: "email_not_configured" };
  try {
    await mailer().sendMail({
      from: env.SMTP_FROM,
      to: user.email,
      subject: `Cerebroil: ${notice.title}`,
      text: `${notice.body}\n\nOpen Cerebroil: ${env.APP_URL}/alerts\n`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message.slice(0, 200) : "send_failed" };
  }
}

/** One plain-text message to one address (the temporary-password email uses it). */
export async function sendMessage(to: string, subject: string, text: string): Promise<{ ok: boolean; reason?: string }> {
  if (!emailConfigured()) return { ok: false, reason: "email_not_configured" };
  try {
    await mailer().sendMail({ from: env.SMTP_FROM, to, subject, text });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message.slice(0, 200) : "send_failed" };
  }
}

async function sendPush(app: FastifyInstance, user: User, notice: Notice): Promise<{ ok: boolean; reason?: string }> {
  if (!initPush()) return { ok: false, reason: "push_not_configured" };
  const subs = await app.sqlRead`
    SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${user.id}`;
  if (subs.length === 0) return { ok: false, reason: "no_browser_allowed" };
  const payload = JSON.stringify({ title: notice.title, body: notice.body, url: "/alerts", severity: notice.severity });
  let sent = 0;
  let lastError = "";
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint as string, keys: { p256dh: sub.p256dh as string, auth: sub.auth as string } },
        payload,
        { TTL: 3600 },
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // The browser withdrew its permission; forget it.
        await app.sqlWrite`DELETE FROM push_subscriptions WHERE id = ${sub.id}`;
      }
      lastError = err instanceof Error ? err.message.slice(0, 200) : "send_failed";
    }
  }
  return sent > 0 ? { ok: true } : { ok: false, reason: lastError || "send_failed" };
}

/**
 * Sends one notice to one person. With `force` the person's level and quiet hours
 * are ignored (the "Send a test" button); the channels they switched on still apply.
 */
export async function notifyUser(
  app: FastifyInstance,
  user: User,
  notice: Notice,
  prefs: Pref[],
  options: { force?: boolean; now?: Date } = {},
): Promise<{ in_app: ChannelResult; email: ChannelResult; push: ChannelResult }> {
  const now = options.now ?? new Date();
  await record(app, user, "in_app", notice, { ok: true });
  const result = { in_app: { status: "sent" } as ChannelResult, email: { status: "skipped" } as ChannelResult, push: { status: "skipped" } as ChannelResult };

  for (const channel of ["email", "push"] as const) {
    const pref = prefs.find((p) => p.channel === channel) ?? DEFAULT_PREFS[channel]!;
    if (!pref.enabled) {
      result[channel] = { status: "skipped", reason: "turned_off" };
      continue;
    }
    if (!options.force) {
      if (rank(notice.severity) < rank(pref.minSeverity)) {
        result[channel] = { status: "skipped", reason: "below_level" };
        continue;
      }
      if (notice.severity !== "critical" && inQuietHours(pref.quietStart, pref.quietEnd, now)) {
        result[channel] = { status: "skipped", reason: "quiet_hours" };
        continue;
      }
    }
    const outcome = channel === "email" ? await sendEmail(user, notice) : await sendPush(app, user, notice);
    await record(app, user, channel, notice, outcome);
    result[channel] = outcome.ok ? { status: "sent" } : { status: "failed", reason: outcome.reason };
  }
  return result;
}

export async function loadPrefs(app: FastifyInstance, userId?: string): Promise<Map<string, Pref[]>> {
  const rows = userId
    ? await app.sqlRead`
        SELECT user_id AS "userId", channel, enabled, min_severity AS "minSeverity",
               quiet_hours_start::text AS "quietStart", quiet_hours_end::text AS "quietEnd"
        FROM notification_preferences WHERE user_id = ${userId}`
    : await app.sqlRead`
        SELECT user_id AS "userId", channel, enabled, min_severity AS "minSeverity",
               quiet_hours_start::text AS "quietStart", quiet_hours_end::text AS "quietEnd"
        FROM notification_preferences`;
  const byUser = new Map<string, Pref[]>();
  for (const r of rows) {
    const list = byUser.get(r.userId as string) ?? [];
    list.push(r as unknown as Pref);
    byUser.set(r.userId as string, list);
  }
  return byUser;
}

export interface AlertInput {
  kind: string;
  severity: Severity;
  message: string;
  facilityId?: string;
  /** Do not raise it again while an unacknowledged alert of this kind is this recent. */
  dedupeMinutes?: number;
}

/** Saves an alert and sends it to everyone. Returns null when it was left out as a repeat. */
export async function raiseAlert(app: FastifyInstance, input: AlertInput): Promise<{ id: string } | null> {
  const facility =
    input.facilityId ?? ((await app.sqlRead`SELECT id FROM facilities ORDER BY id LIMIT 1`)[0]?.id as string | undefined);
  if (!facility) return null;

  if (input.dedupeMinutes) {
    const recent = await app.sqlRead`
      SELECT 1 FROM alerts
      WHERE facility_id = ${facility} AND kind = ${input.kind} AND acknowledged = false
        AND raised_at > now() - (${input.dedupeMinutes} * interval '1 minute')
      LIMIT 1`;
    if (recent.length > 0) return null;
  }

  const id = `ALT-${input.kind.replace(/[^A-Za-z0-9]+/g, "").slice(0, 12).toUpperCase()}-${Date.now()}`;
  await app.sqlWrite`
    INSERT INTO alerts (id, facility_id, kind, severity, message, raised_at)
    VALUES (${id}, ${facility}, ${input.kind}, ${input.severity}, ${input.message}, now())`;

  const notice: Notice = { title: input.kind, body: input.message, kind: input.kind, severity: input.severity };
  const users = (await app.sqlRead`
    SELECT id, email::text AS email, full_name AS "fullName" FROM users WHERE is_active`) as unknown as User[];
  const prefs = await loadPrefs(app);
  for (const user of users) {
    try {
      await notifyUser(app, user, notice, prefs.get(user.id) ?? []);
    } catch (err) {
      app.log.error({ err, userId: user.id }, "notify: could not notify a user");
    }
  }
  return { id };
}
