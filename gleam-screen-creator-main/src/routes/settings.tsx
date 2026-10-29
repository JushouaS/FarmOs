import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/farm/AppShell";
import { ApiError, saveCycleStartDay, saveNotificationPreferences, type NotificationPreference } from "@/lib/api-client";
import { getNotificationPreferences, getOperationsOverview } from "@/lib/farm/repository";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Cerebroil" }] }),
  loader: async () => {
    const [overview, prefs] = await Promise.all([
      getOperationsOverview(),
      // null (not an empty list) when they could not be loaded, so a save can never overwrite what is stored.
      getNotificationPreferences().catch(() => null),
    ]);
    return { overview, prefs };
  },
  component: SettingsPage,
});

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-6 w-11 rounded-full transition-colors shrink-0 before:absolute before:-inset-2.5 before:content-[''] disabled:opacity-50"
      style={{
        background: checked ? "var(--brand)" : "var(--surface-raised)",
        border: "1px solid var(--border-default)",
      }}
    >
      <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="label-section mb-3">{title}</h2>
      <div className="cb-card overflow-hidden divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{label}</p>
        {sub && <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>{sub}</p>}
      </div>
      {/* Long values (model names, unit lists) wrap right-aligned instead of
          squeezing the label column on phones */}
      <div className="flex min-w-0 max-w-[55%] justify-end text-right [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

function MonoVal({ value }: { value: string }) {
  return (
    <span className="font-mono text-xs font-semibold" style={{ color: "var(--cv-accent)" }}>{value}</span>
  );
}

/* The day the flock is on. The start day is the one setting; today's day counts up
 * from it, and every page that shows a day, a weight target or a growth chart
 * reads it from the same place, so applying it here changes them all. */
function CycleDaySection({ cycle }: { cycle: any }) {
  const router = useRouter();
  const minDay = Number(cycle?.minStartDay ?? 16);
  const endDay = Number(cycle?.endDay ?? cycle?.lengthDays ?? 45);
  const startDay = Number(cycle?.startDay ?? minDay);
  const today = Number(cycle?.day ?? startDay);
  const [draft, setDraft] = useState(String(startDay));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Follow the saved value when it changes (after applying, or from another device).
  useEffect(() => setDraft(String(startDay)), [startDay]);

  const value = Number(draft);
  const valid = draft.trim() !== "" && Number.isInteger(value) && value >= minDay && value <= endDay;
  const step = (by: number) => {
    const base = Number.isInteger(value) ? value : startDay;
    setNote(null);
    setDraft(String(Math.min(endDay, Math.max(minDay, base + by))));
  };

  const apply = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await saveCycleStartDay(value);
      await router.invalidate();
      setNote({ ok: true, text: `Done. The flock is on Day ${value} today.` });
    } catch (err) {
      setNote({
        ok: false,
        text:
          err instanceof ApiError && err.status === 403
            ? "Only an administrator or farm manager can change the day."
            : "Could not save the day. Check the connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const harvest = cycle?.projectedYieldDate
    ? new Date(`${cycle.projectedYieldDate}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;
  const left = Math.max(0, endDay - today);

  return (
    <Section title="Grow-out Day">
      <div className="px-4 py-4 sm:px-5">
        <label htmlFor="start-day" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Start day
        </label>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          The day the flock is on today, from Day {minDay} to Day {endDay}. It counts up by one each day after that.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center overflow-hidden rounded-xl" style={{ border: "1px solid var(--border-default)", background: "var(--surface-sunken)" }}>
            <button type="button" onClick={() => step(-1)} disabled={valid && value <= minDay} aria-label="One day earlier"
              className="tap h-11 w-11 text-lg font-semibold disabled:opacity-40" style={{ color: "var(--text-secondary)" }}>
              −
            </button>
            <input
              id="start-day"
              type="number"
              inputMode="numeric"
              min={minDay}
              max={endDay}
              value={draft}
              onChange={(e) => { setNote(null); setDraft(e.target.value); }}
              onKeyDown={(e) => e.key === "Enter" && apply()}
              aria-invalid={!valid}
              aria-describedby="start-day-hint"
              className="h-11 w-16 bg-transparent text-center font-mono text-lg font-bold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              style={{ color: "var(--text-primary)" }}
            />
            <button type="button" onClick={() => step(1)} disabled={valid && value >= endDay} aria-label="One day later"
              className="tap h-11 w-11 text-lg font-semibold disabled:opacity-40" style={{ color: "var(--text-secondary)" }}>
              +
            </button>
          </div>
          <button type="button" onClick={apply} disabled={!valid || busy} className="btn-primary tap disabled:opacity-50">
            {busy ? "Applying…" : valid ? `Set today as Day ${value}` : "Set the day"}
          </button>
          {startDay !== minDay && (
            <button type="button" onClick={() => { setNote(null); setDraft(String(minDay)); }}
              className="tap text-sm font-semibold hover:underline" style={{ color: "var(--brand)" }}>
              Use Day {minDay}
            </button>
          )}
        </div>
        <p id="start-day-hint" className="mt-2 text-xs" style={{ color: valid ? "var(--text-tertiary)" : "var(--status-red-text)" }}>
          {valid ? `Changing it updates the Dashboard, Analytics, Flock Tracking, Live Camera and Insights.` : `Enter a whole number from ${minDay} to ${endDay}.`}
        </p>
        {note && (
          <p role="status" className="mt-2 text-sm font-semibold" style={{ color: note.ok ? "var(--status-green-text)" : "var(--status-red-text)" }}>
            {note.text}
          </p>
        )}
      </div>
      <Row label="Today" sub={harvest ? `Last day is ${harvest}` : undefined}>
        <MonoVal value={`Day ${today} of ${endDay} · ${left} ${left === 1 ? "day" : "days"} left`} />
      </Row>
    </Section>
  );
}

/* Email and push preferences, stored per user (notification_preferences). These save
 * the choice; sending email or push is not set up yet, and the card says so. */
const CHANNELS = [
  { channel: "email", label: "Email Alerts", sub: "Critical and warning alerts via email", fallback: true },
  { channel: "push", label: "Push Notifications", sub: "Browser push for real-time alerts", fallback: false },
] as const;

function NotificationsSection({ stored }: { stored: NotificationPreference[] | null }) {
  const router = useRouter();
  const savedOn = (channel: string, fallback: boolean) => stored?.find((p) => p.channel === channel)?.enabled ?? fallback;
  const savedEmail = savedOn("email", true);
  const savedPush = savedOn("push", false);
  const [on, setOn] = useState({ email: savedEmail, push: savedPush });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Follow what is saved (after saving, or when the page loads).
  useEffect(() => setOn({ email: savedEmail, push: savedPush }), [savedEmail, savedPush]);

  const dirty = on.email !== savedEmail || on.push !== savedPush;
  const unavailable = stored === null;

  const save = async () => {
    if (!dirty || busy || stored === null) return;
    setBusy(true);
    setNote(null);
    try {
      // The API replaces the whole list, so the other channels are sent back as they are.
      const rows: NotificationPreference[] = [
        ...stored.filter((p) => p.channel !== "email" && p.channel !== "push"),
        ...CHANNELS.map(({ channel }) => {
          const current = stored.find((p) => p.channel === channel);
          return {
            channel,
            enabled: on[channel],
            // New rows follow the wording on the card: critical and warning alerts.
            minSeverity: current?.minSeverity ?? "warning",
            quietHoursStart: current?.quietHoursStart ?? null,
            quietHoursEnd: current?.quietHoursEnd ?? null,
          };
        }),
      ];
      await saveNotificationPreferences(rows);
      await router.invalidate();
      setNote({ ok: true, text: "Saved." });
    } catch {
      setNote({ ok: false, text: "Could not save. Check the connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Notifications">
      {CHANNELS.map(({ channel, label, sub }) => (
        <Row key={channel} label={label} sub={sub}>
          <Toggle
            label={label}
            checked={on[channel]}
            disabled={unavailable}
            onChange={(v) => { setNote(null); setOn((p) => ({ ...p, [channel]: v })); }}
          />
        </Row>
      ))}
      <div className="px-4 py-4 sm:px-5">
        <p className="text-xs" style={{ color: unavailable ? "var(--status-red-text)" : "var(--text-tertiary)" }}>
          {unavailable
            ? "Could not load your saved preferences. Refresh the page to try again."
            : "Your choice is saved to your account. Sending email and push is not set up yet, so no messages go out."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={!dirty || busy || unavailable} className="btn-primary tap disabled:opacity-50">
            {busy ? "Saving…" : "Save Changes"}
          </button>
          {note && (
            <span role="status" className="text-sm font-semibold" style={{ color: note.ok ? "var(--status-green-text)" : "var(--status-red-text)" }}>
              {note.text}
            </span>
          )}
        </div>
      </div>
    </Section>
  );
}

function SettingsPage() {
  // The cycle comes from the API (/operations/overview); notification choices from /notifications/preferences.
  const { overview, prefs } = Route.useLoaderData() as { overview: any; prefs: NotificationPreference[] | null };
  const cycle = overview?.cycle ?? null;

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Settings
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
          System configuration, Cerebroil CV Flock Monitor
        </p>
      </div>

      {/* Responsive grid: 1 col mobile, 2 col lg */}
      <div className="grid items-start gap-6 grid-cols-1 lg:grid-cols-2">
        <CycleDaySection cycle={cycle} />

        <NotificationsSection stored={prefs} />
      </div>
    </AppShell>
  );
}
