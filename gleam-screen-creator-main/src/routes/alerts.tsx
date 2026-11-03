import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Info, ListChecks, OctagonAlert } from "lucide-react";
import { AppShell } from "@/components/farm/AppShell";
import { getAlerts, acknowledgeAlertFn } from "@/lib/farm/repository";
import { removeUnacknowledgedAlert } from "@/lib/alert-store";
import { T, localeTag, tr } from "@/lib/i18n";
import { alertKindTitle, alertMessage } from "@/lib/farm/alert-text";

export const Route = createFileRoute("/alerts")({
  head: () => ({ meta: [{ title: tr("Alerts — Cerebroil") }] }),
  component: AlertsPage,
});

type Filter = "all" | "critical" | "warning" | "info";

const HELP: Record<string, { why: string; action: string }> = {
  "Inactive Bird": {
    why: T("Minimal movement detected for > 30 min. Could indicate heat stress, injury, or illness."),
    action: T("Open Live Camera (CAM-01), inspect the flagged bird ID, and check for physical signs."),
  },
  "Flock Inactivity": {
    why: T("Most of the flock has been still for a long time during the day. Heat, cold, poor light or illness can cause this."),
    action: T("Check the temperature, the lights, and that every drinker and feeder works. Walk the house."),
  },
  "Huddling Detected": {
    why: T("A large share of the birds are packed together. Cold, drafts or a fright make birds huddle, and the ones underneath can be hurt."),
    action: T("Check the temperature and look for drafts. Walk the house gently to spread the birds."),
  },
  "Mortality Spike": {
    why: T("More birds died today than the day before."),
    action: T("Check for sick birds, the temperature, the ventilation and the water. Ask your veterinarian if it continues."),
  },
  "High Temperature": {
    why: T("SN-241-H1 exceeded 31°C. Broilers reduce feed intake above 32°C."),
    action: T("Increase ventilation, add cooling, and ensure water access."),
  },
  "Low Weight Flag": {
    why: T("Estimated body mass is > 15% below the Ross 308 Day 14 standard of 1,300 g."),
    action: T("Review the flagged bird ID in Flock Tracking. Check feed access."),
  },
  "System Sync": {
    why: T("Informational — pipeline status update."),
    action: T("No action required."),
  },
};

/** Critical first, then warnings, then information; newest first within each. */
const severityRank = (s: string) => (s === "critical" ? 0 : s === "warning" || s === "deviation" ? 1 : 2);

interface RowProps {
  a: any;
  expanded: string | null;
  setExpanded: (updater: (prev: string | null) => string | null) => void;
  busy: boolean;
  onRead: (id: string) => void;
  /** Just moved here from Unread: shown with a brief highlight. */
  justRead: boolean;
}

/** A colour mixed into the card surface, so a tint stays readable in both themes. */
const wash = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, var(--surface-card))`;

function AlertRow({ a, expanded, setExpanded, busy, onRead, justRead }: RowProps) {
  const isCrit = a.severity === "critical";
  const isWarn = a.severity === "warning" || a.severity === "deviation";
  const help = HELP[a.kind];
  const isExp = expanded === a.id;
  const unread = !a.acknowledged;
  const accent = isCrit ? "var(--status-red)" : isWarn ? "var(--status-amber)" : "var(--status-blue)";
  const accentText = isCrit ? "var(--status-red-text)" : isWarn ? "var(--status-amber-text)" : "var(--status-blue-text)";
  const Icon = isCrit ? OctagonAlert : isWarn ? AlertTriangle : Info;
  const label = isCrit ? tr("Critical") : isWarn ? tr("Warning") : tr("Info");
  const raised = new Date(a.raisedAt);
  const when = raised.toLocaleString(localeTag(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <article
      className={`relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 overflow-hidden rounded-2xl border px-4 py-4 transition-colors duration-300 hover:border-[var(--border-strong)] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-5 ${justRead ? "animate-spring-in" : ""}`}
      style={{
        borderColor: unread ? wash(accent, 35) : "var(--border-subtle)",
        background: justRead ? "var(--status-green-bg)" : unread ? wash(accent, 7) : "var(--surface-card)",
      }}
    >
      {/* A bar on the edge for what is still unread */}
      {unread && <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} aria-hidden="true" />}

      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ background: wash(accent, 16), color: accentText }}
        aria-hidden="true"
      >
        <Icon className="h-5 w-5" />
      </span>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3
            className="text-base font-semibold leading-snug"
            style={{ color: unread ? "var(--text-primary)" : "var(--text-secondary)" }}
          >
            {alertKindTitle(a.kind)}
          </h3>
          <span className={isCrit ? "badge-red" : isWarn ? "badge-amber" : "badge-blue"}>{label}</span>
        </div>
        <p className="mt-1 text-sm leading-relaxed line-clamp-3" style={{ color: "var(--text-secondary)" }}>
          {alertMessage(a.message)}
        </p>
        <time dateTime={raised.toISOString()} className="mt-1.5 block text-xs" style={{ color: "var(--text-tertiary)" }}>
          {when}
        </time>
      </div>

      <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:flex-col sm:items-stretch sm:justify-center">
        {unread && (
          <button onClick={() => onRead(a.id)} disabled={busy} className="btn-ghost tap gap-1.5 text-sm">
            <Check className="h-4 w-4" aria-hidden="true" />
            {busy ? "…" : tr("Mark read")}
          </button>
        )}
        {help && (
          <button
            onClick={() => setExpanded((p) => (p === a.id ? null : a.id))}
            aria-expanded={isExp}
            className="tap inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-sm font-medium hover:underline"
            style={{ color: "var(--brand)" }}
          >
            {isExp ? tr("Hide") : tr("Details")}
            <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${isExp ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Why it matters, and what to do about it */}
      {isExp && help && (
        <div className="col-span-full grid animate-spring-in gap-3 border-t pt-4 sm:grid-cols-2" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="rounded-xl p-3.5" style={{ background: "var(--surface-raised)" }}>
            <p className="label-section mb-1.5 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              {tr("Why it matters")}
            </p>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>{tr(help.why)}</p>
          </div>
          <div className="rounded-xl p-3.5" style={{ background: "var(--surface-raised)" }}>
            <p className="label-section mb-1.5 flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
              {tr("Recommended action")}
            </p>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>{tr(help.action)}</p>
            {isCrit && (
              <Link
                to="/visuals"
                className="tap mt-2 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
                style={{ color: "var(--cv-accent)" }}
              >
                {tr("Open Live Camera →")}
              </Link>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/** The alerts as a list of cards, one each. */
function AlertTable({ list, ...row }: { list: any[] } & Omit<RowProps, "a" | "busy" | "justRead"> & { busyIds: Record<string, boolean>; justReadId: string | null }) {
  const { busyIds, justReadId, ...shared } = row;
  return (
    <div className="space-y-2.5">
      {list.map((a) => (
        <AlertRow key={a.id} a={a} busy={busyIds[a.id] ?? false} justRead={justReadId === a.id} {...shared} />
      ))}
    </div>
  );
}

function Count({ n, tone }: { n: number; tone: "red" | "muted" }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 font-mono text-xs font-bold leading-none"
      style={
        tone === "red" && n > 0
          ? { background: "var(--status-red-bg)", color: "var(--status-red-text)", border: "1px solid var(--status-red-border)" }
          : { background: "var(--surface-raised)", color: "var(--text-tertiary)" }
      }
    >
      {n}
    </span>
  );
}

function AlertsPage() {
  const [alerts,   setAlerts]   = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [filter,   setFilter]   = useState<Filter>("all");
  const [mutating, setMutating] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showRead, setShowRead] = useState(true);
  // The alert that just moved to Read, kept highlighted for a moment.
  const [justRead, setJustRead] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAlerts((await getAlerts({ data: {} } as never)) as any[]);
    } catch {
      setError(tr("Could not load alerts. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  const filtered = alerts.filter((a) => {
    if (filter === "all")      return true;
    if (filter === "critical") return a.severity === "critical";
    if (filter === "warning")  return a.severity === "warning" || a.severity === "deviation";
    if (filter === "info")     return a.severity === "nominal";
    return true;
  });

  // Unread first and ordered by how urgent it is; Read is newest first.
  const unreadList = filtered
    .filter((a) => !a.acknowledged)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || String(b.raisedAt).localeCompare(String(a.raisedAt)));
  const readList = filtered
    .filter((a) => a.acknowledged)
    .sort((a, b) => String(b.raisedAt).localeCompare(String(a.raisedAt)));

  const unread = alerts.filter((a) => !a.acknowledged).length;
  const readTotal = alerts.length - unread;

  const handleAck = async (id: string) => {
    setMutating((p) => ({ ...p, [id]: true }));
    try {
      const result = await acknowledgeAlertFn({ data: { id } } as never);
      if ((result as any).updated) {
        const done = alerts.find((a) => a.id === id);
        // It leaves Unread and shows up in Read at once, and the alert badges
        // in the top bar and menus drop without waiting for their next check.
        setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
        removeUnacknowledgedAlert(id);
        setJustRead(id);
        setAnnounce(tr("{kind} marked read and moved to Read.", { kind: done?.kind ?? tr("Alert") }));
        clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setJustRead(null), 2500);
      }
    } finally {
      setMutating((p) => ({ ...p, [id]: false }));
    }
  };

  const handleMarkAllRead = () =>
    Promise.all(alerts.filter((a) => !a.acknowledged).map((a) => handleAck(a.id)));

  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: "all",      label: tr("All"),      count: alerts.length },
    { id: "critical", label: tr("Critical"), count: alerts.filter((a) => a.severity === "critical").length },
    { id: "warning",  label: tr("Warning"),  count: alerts.filter((a) => a.severity === "warning" || a.severity === "deviation").length },
    { id: "info",     label: tr("Info"),     count: alerts.filter((a) => a.severity === "nominal").length },
  ];

  const shared = { expanded, setExpanded, onRead: handleAck, busyIds: mutating, justReadId: justRead };

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            {tr("Alerts")}
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-tertiary)" }}>
            {unread > 0
              ? <><span className="font-mono" style={{ color: "var(--status-red)" }}>{unread}</span> {tr("unread alert")}{unread !== 1 ? "s" : ""}</>
              : tr("All alerts reviewed")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="tap px-1 text-xs font-semibold hover:underline"
              style={{ color: "var(--brand)" }}
            >
              {tr("Mark all read")}
            </button>
          )}
          <button onClick={load} disabled={loading} className="btn-ghost tap text-xs gap-1.5">
            <svg className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0113.9-3.4M20 15a9 9 0 01-13.9 3.4"/>
            </svg>
            {tr("Refresh")}
          </button>
        </div>
      </div>

      {/* Filter tabs: severity, applied to both lists below */}
      <div
        className="mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl p-1"
        style={{ background: "var(--surface-card)", border: "1px solid var(--border-subtle)" }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className="tap flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors sm:px-3.5"
            style={filter === t.id
              ? { background: "var(--brand)", color: "var(--text-inverse)" }
              : { color: "var(--text-secondary)" }}
          >
            {t.label}
            {t.count > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 font-mono text-xs font-bold leading-none"
                style={filter === t.id
                  ? { background: "rgba(255,255,255,0.22)", color: "var(--text-inverse)" }
                  : { background: "var(--surface-raised)", color: "var(--text-tertiary)" }}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-lg p-4"
          style={{ background: "var(--status-red-bg)", border: "1px solid var(--status-red-border)" }}>
          <svg className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--status-red)" }}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"/>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01"/>
          </svg>
          <div>
            <p className="text-sm" style={{ color: "var(--status-red-text)" }}>{error}</p>
            <button onClick={load} className="mt-1 text-xs font-semibold hover:underline" style={{ color: "var(--status-red)" }}>
              {tr("Try again")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="cb-card h-20 animate-pulse" style={{ background: "var(--surface-raised)" }} />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── UNREAD: what still needs attention ── */}
          <section aria-labelledby="alerts-unread">
            <div className="mb-2 flex items-center gap-2">
              <h2 id="alerts-unread" className="label-section text-xs font-bold tracking-widest">{tr("Unread")}</h2>
              <Count n={unreadList.length} tone="red" />
            </div>
            {unreadList.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center rounded-xl py-10"
                style={{ border: "1px solid var(--border-subtle)", background: "var(--surface-card)" }}
              >
                <svg className="mb-2 h-9 w-9" style={{ color: "var(--status-green)" }}
                  fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{tr("All caught up")}</p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-tertiary)" }}>
                  {alerts.length === 0 ? tr("No alerts yet.") : tr("No unread alerts in this category.")}
                </p>
              </div>
            ) : (
              <AlertTable list={unreadList} {...shared} />
            )}
          </section>

          {/* ── READ: already handled, kept for reference ── */}
          <section aria-labelledby="alerts-read">
            <button
              type="button"
              onClick={() => setShowRead((v) => !v)}
              aria-expanded={showRead}
              aria-controls="alerts-read-list"
              className="tap mb-2 flex min-h-6 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${showRead ? "" : "-rotate-90"}`}
                style={{ color: "var(--text-tertiary)" }}
                aria-hidden="true"
              />
              <span id="alerts-read" className="label-section text-xs font-bold tracking-widest">{tr("Read")}</span>
              <Count n={readList.length} tone="muted" />
            </button>
            <div id="alerts-read-list" hidden={!showRead}>
              {readList.length === 0 ? (
                <p className="rounded-xl px-4 py-5 text-center text-xs"
                  style={{ border: "1px solid var(--border-subtle)", background: "var(--surface-card)", color: "var(--text-tertiary)" }}>
                  {readTotal === 0 ? tr("Alerts you mark as read will move here.") : tr("No read alerts in this category.")}
                </p>
              ) : (
                <AlertTable list={readList} {...shared} />
              )}
            </div>
          </section>
        </div>
      )}

      <p className="mt-3 text-right font-mono text-xs" style={{ color: "var(--text-tertiary)" }}>{tr("{length} unread · {length2} read · {length3} total", { length: unreadList.length, length2: readList.length, length3: alerts.length })}</p>
    </AppShell>
  );
}
