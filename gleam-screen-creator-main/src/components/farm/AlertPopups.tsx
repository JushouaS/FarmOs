import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, OctagonAlert, TrendingDown, X } from "lucide-react";
import { acknowledgeAlert, ApiError, fetchAlerts } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  clearUnacknowledgedAlerts,
  removeUnacknowledgedAlert,
  setUnacknowledgedAlerts,
  useUnacknowledgedAlerts,
} from "@/lib/alert-store";

/* Alert pop-ups: a small card that slides in at the corner of the screen,
 * desktop-notification style, when something abnormal comes in.
 *
 * What counts as abnormal is the alert's severity: critical, deviation or
 * warning. "nominal" alerts are just information and never pop up.
 *
 * A pop-up stays until the person deals with it:
 *   Noted  tells the server the alert was seen (it is then acknowledged for
 *          everyone and stops appearing),
 *   X      only hides it here, on this device; the alert stays unacknowledged
 *          on the Alerts page and does not pop up again on this device.
 * It never closes by itself. */

const ABNORMAL = new Set(["critical", "deviation", "warning"]);
const POLL_MS = 30_000;
// How many pop-ups show at once: a phone screen only has room for one.
const MAX_WIDE = 3;
const MAX_NARROW = 1;
const DISMISSED_KEY = "cb-alert-popups-dismissed";
const DISMISSED_KEEP = 200;

const STYLE = {
  critical: { label: "Critical alert", color: "var(--status-red-text)", bg: "var(--status-red-bg)", border: "var(--status-red-border)", bar: "var(--status-red)", Icon: OctagonAlert },
  deviation: { label: "Deviation", color: "var(--status-amber-text)", bg: "var(--status-amber-bg)", border: "var(--status-amber-border)", bar: "var(--status-amber)", Icon: TrendingDown },
  warning: { label: "Warning", color: "var(--status-amber-text)", bg: "var(--status-amber-bg)", border: "var(--status-amber-border)", bar: "var(--status-amber)", Icon: AlertTriangle },
} as const;

type Severity = keyof typeof STYLE;

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return []; // storage blocked or corrupt: nothing remembered
  }
}

function writeDismissed(ids: string[]) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-DISMISSED_KEEP)));
  } catch {
    /* not remembered; the pop-up just comes back next visit */
  }
}

/** "CRITICAL_EVENT" -> "Critical event" */
function titleOf(kind: string): string {
  const words = kind.toLowerCase().replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function whenOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function useIsWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const on = () => setWide(query.matches);
    on();
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, []);
  return wide;
}

export function AlertPopups() {
  const { user, refresh } = useAuth();
  const wide = useIsWide();
  // The shared list also feeds the alert badges; only the abnormal ones pop up.
  const { alerts: unacknowledged } = useUnacknowledgedAlerts();
  const alerts = useMemo(() => unacknowledged.filter((a) => ABNORMAL.has(a.severity)), [unacknowledged]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // Read after mount so the server render and the first client render match.
  useEffect(() => setDismissed(readDismissed()), []);

  const load = useCallback(async () => {
    try {
      const rows = await fetchAlerts({ acknowledged: false, limit: 50 });
      setUnacknowledgedAlerts(rows);
    } catch (err) {
      // apiFetch already renewed the session and retried, so a 401 here means
      // the sign-in is really over: tell the auth context, which sends the
      // person to /login and stops this polling. Anything else (offline, API
      // down) keeps what is on screen.
      if (err instanceof ApiError && err.status === 401) await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    if (!user) {
      clearUnacknowledgedAlerts();
      return;
    }
    load();
    const timer = setInterval(load, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, load]);

  // Critical first, then newest.
  const pending = useMemo(
    () =>
      alerts
        .filter((a) => !dismissed.includes(a.id))
        .sort((a, b) => {
          const rank = (s: string) => (s === "critical" ? 0 : 1);
          return rank(a.severity) - rank(b.severity) || b.raisedAt.localeCompare(a.raisedAt);
        }),
    [alerts, dismissed],
  );
  const visible = pending.slice(0, wide ? MAX_WIDE : MAX_NARROW);
  const hidden = pending.length - visible.length;

  const close = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    writeDismissed(next);
  };

  const note = async (id: string) => {
    setSaving(id);
    setFailed(null);
    try {
      await acknowledgeAlert(id);
      removeUnacknowledgedAlert(id);
    } catch {
      setFailed(id);
    } finally {
      setSaving(null);
    }
  };

  if (visible.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Alert notifications"
      className="pointer-events-none fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col gap-2 sm:left-auto sm:right-4 sm:w-[23rem] lg:bottom-5 lg:right-5"
    >
      {visible.map((alert) => {
        const sev = (alert.severity in STYLE ? alert.severity : "warning") as Severity;
        const { label, color, bg, border, bar, Icon } = STYLE[sev];
        return (
          <div
            key={alert.id}
            role={sev === "critical" ? "alert" : "status"}
            className="animate-alert-in pointer-events-auto relative overflow-hidden rounded-xl border bg-[var(--surface-raised)] shadow-[var(--shadow-elev-3)]"
            style={{ borderColor: border }}
          >
            <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: bar }} />
            <div className="flex items-start gap-3 py-3 pl-4 pr-2.5">
              <span
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{ background: bg, color }}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color }}>
                  {label}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-[var(--text-primary)]">{titleOf(alert.kind)}</p>
                <p className="mt-0.5 line-clamp-2 text-sm leading-snug sm:line-clamp-3 text-[var(--text-secondary)]">{alert.message}</p>
                <p className="mt-1 font-mono text-xs text-[var(--text-tertiary)]">{whenOf(alert.raisedAt)}</p>

                {failed === alert.id && (
                  <p role="alert" className="mt-1.5 text-xs" style={{ color: "var(--status-red-text)" }}>
                    Could not save that. Try again.
                  </p>
                )}

                <div className="mt-2.5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => note(alert.id)}
                    disabled={saving === alert.id}
                    className="tap inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-3.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:opacity-60"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    {saving === alert.id ? "Saving…" : "Noted"}
                  </button>
                  <Link
                    to="/alerts"
                    className="tap inline-flex items-center text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
                  >
                    View alerts
                  </Link>
                </div>
              </div>

              <button
                type="button"
                onClick={() => close(alert.id)}
                aria-label={`Close ${titleOf(alert.kind)} alert`}
                title="Close (the alert stays on the Alerts page)"
                className="tap -mr-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-card)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}

      {hidden > 0 && (
        <Link
          to="/alerts"
          className="pointer-events-auto self-end rounded-full border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] shadow-lg hover:text-[var(--text-primary)]"
        >
          +{hidden} more · View all
        </Link>
      )}
    </div>
  );
}
