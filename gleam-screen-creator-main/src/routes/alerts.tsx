import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/farm/AppShell";
import { getAlerts, acknowledgeAlertFn } from "@/lib/farm/repository";

export const Route = createFileRoute("/alerts")({
  head: () => ({ meta: [{ title: "Alerts — Cerebroil" }] }),
  component: AlertsPage,
});

type Filter = "all" | "critical" | "warning" | "info";

const HELP: Record<string, { why: string; action: string }> = {
  "Inactive Bird": {
    why: "Minimal movement detected for > 30 min. Could indicate heat stress, injury, or illness.",
    action: "Open Live Camera (CAM-01), inspect the flagged bird ID, and check for physical signs.",
  },
  "High Temperature": {
    why: "SN-241-H1 exceeded 31°C. Broilers reduce feed intake above 32°C.",
    action: "Increase ventilation, add cooling, and ensure water access.",
  },
  "Low Weight Flag": {
    why: "Estimated body mass is > 15% below the Ross 308 Day 14 standard of 1,300 g.",
    action: "Review the flagged bird ID in Flock Tracking. Check feed access.",
  },
  "System Sync": {
    why: "Informational — pipeline status update.",
    action: "No action required.",
  },
};

function AlertsPage() {
  const [alerts,   setAlerts]   = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [filter,   setFilter]   = useState<Filter>("all");
  const [mutating, setMutating] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAlerts((await getAlerts({ data: {} } as never)) as any[]);
    } catch {
      setError("Could not load alerts. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = alerts.filter((a) => {
    if (filter === "all")      return true;
    if (filter === "critical") return a.severity === "critical";
    if (filter === "warning")  return a.severity === "warning" || a.severity === "deviation";
    if (filter === "info")     return a.severity === "nominal";
    return true;
  });

  const unread = alerts.filter((a) => !a.acknowledged).length;

  const handleAck = async (id: string) => {
    setMutating((p) => ({ ...p, [id]: true }));
    try {
      const result = await acknowledgeAlertFn({ data: { id } } as never);
      if ((result as any).updated)
        setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, acknowledged: true } : a));
    } finally {
      setMutating((p) => ({ ...p, [id]: false }));
    }
  };

  const handleMarkAllRead = () =>
    Promise.all(alerts.filter((a) => !a.acknowledged).map((a) => handleAck(a.id)));

  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: "all",      label: "All",      count: alerts.length },
    { id: "critical", label: "Critical", count: alerts.filter((a) => a.severity === "critical").length },
    { id: "warning",  label: "Warning",  count: alerts.filter((a) => a.severity === "warning" || a.severity === "deviation").length },
    { id: "info",     label: "Info",     count: alerts.filter((a) => a.severity === "nominal").length },
  ];

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Alerts
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-tertiary)" }}>
            {unread > 0
              ? <><span className="font-mono" style={{ color: "var(--status-red)" }}>{unread}</span> unread alert{unread !== 1 ? "s" : ""}</>
              : "All alerts reviewed"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-xs font-semibold hover:underline"
              style={{ color: "var(--brand)" }}
            >
              Mark all read
            </button>
          )}
          <button onClick={load} disabled={loading} className="btn-ghost text-xs gap-1.5">
            <svg className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0113.9-3.4M20 15a9 9 0 01-13.9 3.4"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div
        className="mb-5 flex gap-1 w-fit rounded-xl p-1"
        style={{ background: "var(--surface-card)", border: "1px solid var(--border-subtle)" }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors"
            style={filter === t.id
              ? { background: "var(--brand)", color: "var(--text-inverse)" }
              : { color: "var(--text-secondary)" }}
          >
            {t.label}
            {t.count > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none"
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
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Loading skeletons */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="cb-card h-20 animate-pulse" style={{ background: "var(--surface-raised)" }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-xl py-16"
          style={{ border: "1px solid var(--border-subtle)", background: "var(--surface-card)" }}
        >
          <svg className="mb-3 h-10 w-10" style={{ color: "var(--status-green)" }}
            fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>All clear</p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-tertiary)" }}>No alerts in this category.</p>
        </div>
      ) : (
        /* ── Alerts table ── */
        <div className="cb-card overflow-hidden">
          {/* Table header */}
          <div
            className="grid grid-cols-12 gap-3 px-5 py-3 font-mono text-[10px] font-semibold uppercase tracking-wide"
            style={{ borderBottom: "1px solid var(--border-subtle)", color: "var(--text-tertiary)" }}
          >
            <div className="col-span-1" />
            <div className="col-span-2">Sev.</div>
            <div className="col-span-3">Type</div>
            <div className="col-span-4">Message</div>
            <div className="col-span-2">Time</div>
          </div>

          <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            {filtered.map((a) => {
              const isCrit = a.severity === "critical";
              const isWarn = a.severity === "warning" || a.severity === "deviation";
              const help   = HELP[a.kind];
              const isExp  = expanded === a.id;
              const isMut  = mutating[a.id] ?? false;
              const accentColor = isCrit ? "var(--status-red)" : isWarn ? "var(--status-amber)" : "var(--status-blue)";

              return (
                <div key={a.id}>
                  <div
                    className="grid grid-cols-12 gap-3 items-center px-5 py-3.5 transition-colors cursor-default"
                    style={{
                      borderLeft: `3px solid ${a.acknowledged ? "transparent" : accentColor}`,
                      background: a.acknowledged ? "transparent" : `${accentColor}06`,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-raised)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = a.acknowledged ? "transparent" : `${accentColor}06`)}
                  >
                    {/* Icon */}
                    <div className="col-span-1">
                      <div
                        className="h-8 w-8 rounded-lg flex items-center justify-center font-mono text-[10px] font-bold"
                        style={{
                          background: isCrit ? "var(--status-red-bg)" : isWarn ? "var(--status-amber-bg)" : "var(--status-blue-bg)",
                          color:      isCrit ? "var(--status-red-text)" : isWarn ? "var(--status-amber-text)" : "var(--status-blue-text)",
                        }}
                      >
                        {a.kind.slice(0, 2).toUpperCase()}
                      </div>
                    </div>

                    {/* Severity badge */}
                    <div className="col-span-2">
                      <span className={isCrit ? "badge-red" : isWarn ? "badge-amber" : "badge-blue"}>
                        {isCrit ? "Critical" : isWarn ? "Warning" : "Info"}
                      </span>
                      {a.acknowledged && (
                        <span className="ml-1.5 badge-green">Read</span>
                      )}
                    </div>

                    {/* Type */}
                    <div className="col-span-3">
                      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                        {a.kind}
                      </p>
                    </div>

                    {/* Message */}
                    <div className="col-span-4">
                      <p className="text-xs line-clamp-2" style={{ color: "var(--text-secondary)" }}>
                        {a.message}
                      </p>
                    </div>

                    {/* Time */}
                    <div className="col-span-2 flex flex-col items-end gap-1.5">
                      <p className="font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                        {new Date(a.raisedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <div className="flex gap-2">
                        {!a.acknowledged && (
                          <button
                            onClick={() => handleAck(a.id)}
                            disabled={isMut}
                            className="btn-ghost text-[11px] py-0.5 px-2"
                          >
                            {isMut ? "…" : "Mark read"}
                          </button>
                        )}
                        {help && (
                          <button
                            onClick={() => setExpanded((p) => p === a.id ? null : a.id)}
                            className="text-[11px] font-medium hover:underline"
                            style={{ color: "var(--brand)" }}
                          >
                            {isExp ? "Hide" : "Details"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExp && help && (
                    <div
                      className="px-5 pb-4 pt-3 space-y-3"
                      style={{ background: "var(--surface-raised)", borderLeft: `3px solid ${accentColor}` }}
                    >
                      <div>
                        <p className="label-section mb-1">Why it matters</p>
                        <p className="text-sm" style={{ color: "var(--text-primary)" }}>{help.why}</p>
                      </div>
                      <div>
                        <p className="label-section mb-1">Recommended action</p>
                        <p className="text-sm" style={{ color: "var(--text-primary)" }}>{help.action}</p>
                      </div>
                      {isCrit && (
                        <Link
                          to="/visuals"
                          className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
                          style={{ color: "var(--cv-accent)" }}
                        >
                          Open Live Camera →
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="mt-3 text-right font-mono text-xs" style={{ color: "var(--text-tertiary)" }}>
        {filtered.length} of {alerts.length} alert{alerts.length !== 1 ? "s" : ""}
      </p>
    </AppShell>
  );
}
