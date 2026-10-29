import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/farm/AppShell";
import { AccountSection } from "@/components/farm/AccountSection";
import { FlockSizeSection } from "@/components/farm/FlockSizeSection";
import { LightingSection } from "@/components/farm/LightingSection";
import { Block, Hint, MonoVal, Row, SaveRow, Section, Toggle, useSaver } from "@/components/farm/SettingsParts";
import { ApiError, saveCycleStartDay, saveNotificationPreferences, type NotificationPreference } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { DEFAULT_LIGHTING } from "@/lib/farm/dataset";
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
      <Block>
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
      </Block>
      <Row label="Today" sub={harvest ? `Last day is ${harvest}` : undefined}>
        <MonoVal value={`Day ${today} of ${endDay} · ${left} ${left === 1 ? "day" : "days"} left`} />
      </Row>
    </Section>
  );
}

/* Email and push preferences, stored per user (notification_preferences): which
 * channels, from which severity up, and the quiet hours. These save the choice;
 * sending email or push is not set up yet, and the card says so. */
const CHANNELS = [
  { channel: "email", label: "Email Alerts", sub: "Alerts at your chosen level, by email" },
  { channel: "push", label: "Push Notifications", sub: "Browser push at your chosen level" },
] as const;

const LEVELS = [
  { value: "critical", label: "Critical only" },
  { value: "warning", label: "Warning and critical" },
  { value: "deviation", label: "Everything, including deviations" },
] as const;
type Level = (typeof LEVELS)[number]["value"];

/** The stored severity as one of the three choices (anything milder than a warning is "everything"). */
const levelOf = (severity: string | undefined): Level =>
  severity === "critical" ? "critical" : severity === undefined || severity === "warning" ? "warning" : "deviation";

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function NotificationsSection({ stored }: { stored: NotificationPreference[] | null }) {
  const router = useRouter();
  const saver = useSaver();
  const savedOn = (channel: string, fallback: boolean) => stored?.find((p) => p.channel === channel)?.enabled ?? fallback;
  // The level and quiet hours are shared by email and push, so they are read from whichever is stored.
  const ref = stored?.find((p) => p.channel === "email") ?? stored?.find((p) => p.channel === "push");
  const saved = {
    email: savedOn("email", true),
    push: savedOn("push", false),
    level: levelOf(ref?.minSeverity),
    quietOn: Boolean(ref?.quietHoursStart && ref?.quietHoursEnd),
    quietStart: hhmm(ref?.quietHoursStart) || "22:00",
    quietEnd: hhmm(ref?.quietHoursEnd) || "05:00",
  };
  const key = JSON.stringify(saved);
  const [on, setOn] = useState(saved);

  // Follow what is saved (after saving, or when the page loads).
  useEffect(() => setOn(saved), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(on) !== key;
  const quietValid = !on.quietOn || (HHMM.test(on.quietStart) && HHMM.test(on.quietEnd) && on.quietStart !== on.quietEnd);
  const unavailable = stored === null;
  const change = (patch: Partial<typeof on>) => {
    saver.setNote(null);
    setOn((p) => ({ ...p, ...patch }));
  };

  const save = async () => {
    if (!dirty || !quietValid || stored === null) return;
    const ok = await saver.run(() => {
      // The API replaces the whole list, so the other channels are sent back as they are.
      const rows: NotificationPreference[] = [
        ...stored.filter((p) => p.channel !== "email" && p.channel !== "push"),
        ...CHANNELS.map(({ channel }) => ({
          channel,
          enabled: on[channel],
          minSeverity: on.level,
          quietHoursStart: on.quietOn ? on.quietStart : null,
          quietHoursEnd: on.quietOn ? on.quietEnd : null,
        })),
      ];
      return saveNotificationPreferences(rows);
    }, "Saved.");
    if (ok) await router.invalidate();
  };

  return (
    <Section title="Notifications">
      {CHANNELS.map(({ channel, label, sub }) => (
        <Row key={channel} label={label} sub={sub}>
          <Toggle label={label} checked={on[channel]} disabled={unavailable} onChange={(v) => change({ [channel]: v })} />
        </Row>
      ))}
      <Block>
        <label htmlFor="alert-level" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Send me
        </label>
        <select
          id="alert-level"
          value={on.level}
          disabled={unavailable}
          onChange={(e) => change({ level: e.target.value as Level })}
          className="cb-input mt-1.5 block w-full text-sm disabled:opacity-60"
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </Block>
      <Row label="Quiet hours" sub="Hold back alerts below critical during these hours">
        <Toggle label="Quiet hours" checked={on.quietOn} disabled={unavailable} onChange={(v) => change({ quietOn: v })} />
      </Row>
      {on.quietOn && (
        <Block>
          <div className="flex flex-wrap gap-5">
            {([["quiet-start", "From", "quietStart"], ["quiet-end", "Until", "quietEnd"]] as const).map(([id, label, field]) => (
              <div key={id}>
                <label htmlFor={id} className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{label}</label>
                <input
                  id={id}
                  type="time"
                  value={on[field]}
                  disabled={unavailable}
                  onChange={(e) => change({ [field]: e.target.value })}
                  aria-invalid={!quietValid}
                  className="cb-input mt-1.5 block w-36 font-mono text-sm disabled:opacity-60"
                />
              </div>
            ))}
          </div>
          {!quietValid && <Hint tone="error">Give both times, and make them different.</Hint>}
        </Block>
      )}
      <Block>
        <Hint tone={unavailable ? "error" : undefined}>
          {unavailable
            ? "Could not load your saved preferences. Refresh the page to try again."
            : "Your choices are saved to your account. Sending email and push is not set up yet, so no messages go out."}
        </Hint>
        <SaveRow onSave={save} busy={saver.busy} disabled={!dirty || !quietValid || unavailable} note={saver.note} />
      </Block>
    </Section>
  );
}

function SettingsPage() {
  const { overview, prefs } = Route.useLoaderData() as {
    overview: any;
    prefs: NotificationPreference[] | null;
  };
  const { user } = useAuth();
  const cycle = overview?.cycle ?? null;
  // One pen: the house the live camera watches (the first house if none is named).
  const houses: any[] = overview?.houses ?? [];
  const house = houses.find((h) => h.id === overview?.cluster?.houseId) ?? houses[0] ?? null;
  // Farm-wide settings are for administrators and farm managers; everyone can change their own account.
  const canManage = Boolean(user?.roles?.some((r) => r === "ADMIN" || r === "FARM_MANAGER"));

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

      {/* Responsive: one column on a phone, two on a wide screen */}
      <div className="grid items-start gap-6 grid-cols-1 lg:grid-cols-2">
        <div className="space-y-6">
          <CycleDaySection cycle={cycle} />
          <FlockSizeSection house={house} canManage={canManage} />
          <LightingSection lighting={overview?.lighting ?? DEFAULT_LIGHTING} canManage={canManage} />
        </div>
        <div className="space-y-6">
          <AccountSection />
          <NotificationsSection stored={prefs} />
        </div>
      </div>
    </AppShell>
  );
}
