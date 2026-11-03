import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/farm/AppShell";
import { getOperationsOverview } from "@/lib/farm/repository";
import { fetchSituationBriefing, fetchFeedbackAlerts } from "@/lib/intelligence";
import { fetchLiveBehavior } from "@/lib/api-client";
import { T, getLanguage, tr } from "@/lib/i18n";

export const Route = createFileRoute("/intelligence")({
  head: () => ({ meta: [{ title: tr("Insights — CereBroiler") }] }),
  loader: () => getOperationsOverview(),
  component: InsightsPage,
});

const RECOMMENDATIONS = [
  { icon: "🌡️", title: T("Maintain temperature between 26–32°C"), why: T("Broiler chickens are sensitive to heat. Temperatures above 32°C cause stress and reduce feed intake.") },
  { icon: "💧", title: T("Make sure clean water is always available"), why: T("Chickens drink 2–3× more water than they eat. Dehydration quickly leads to health problems.") },
  { icon: "🐔", title: T("Check birds that stay still for a long time"), why: T("Long inactivity may indicate stress, illness, or injury. Early detection prevents losses.") },
  { icon: "💨", title: T("Keep ventilation adequate"), why: T("Good air circulation prevents ammonia buildup, which irritates the respiratory system.") },
];

function InsightsPage() {
  // The day comes from Settings (through the report's cycle), not a fixed number.
  const report = Route.useLoaderData() as any;
  const day = Number(report?.cycle?.day ?? 0);
  const endDay = Number(report?.cycle?.endDay ?? report?.cycle?.lengthDays ?? 45);
  const behind = report?.weight?.status === "warning";
  const lang = getLanguage();
  // What the live behavior monitor sees now; it says "off" until LIVE_BEHAVIOR=1 is set on the camera computer.
  const behaviorQ = useQuery({
    queryKey: ["live-behavior"],
    queryFn: () => fetchLiveBehavior(false),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const monitor = behaviorQ.data?.running ? behaviorQ.data : null;
  const stillBirds = monitor ? (monitor.flock_inactive ? (monitor.birds ?? 0) : (monitor.inactive?.length ?? 0)) : 0;
  const observations: { ok: boolean | null; text: string }[] = [];
  if (report?.weight?.actualAvgG != null) {
    observations.push(behind ? { ok: false, text: tr("Average weight is behind the target") } : { ok: true, text: tr("Average weight is on track") });
  }
  if (monitor) {
    observations.push(
      stillBirds > 0
        ? { ok: false, text: tr("{n} birds have stayed still. Check on them.", { n: stillBirds }) }
        : { ok: true, text: tr("Activity level is normal") },
    );
    if (monitor.huddle?.warning) observations.push({ ok: false, text: tr("{n} birds are huddled together.", { n: monitor.huddle.birds }) });
  } else {
    observations.push({ ok: null, text: tr("Behavior monitoring is off. Turn it on at the camera computer (LIVE_BEHAVIOR=1) to see this.") });
  }
  const briefingQ = useQuery({
    queryKey: ["situation-briefing", lang],
    queryFn: () => fetchSituationBriefing({ data: { lang } } as never),
    staleTime: Infinity, retry: false, refetchOnWindowFocus: false,
  });
  const alertsQ = useQuery({
    queryKey: ["feedback-alerts", lang],
    queryFn: () => fetchFeedbackAlerts({ data: { lang } } as never),
    staleTime: Infinity, retry: false, refetchOnWindowFocus: false,
  });

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>{tr("Insights")}</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--text-tertiary)" }}>
          {tr("Recommendations based on your flock's current condition.")}
        </p>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        {/* Main */}
        <div className="space-y-6 lg:col-span-2">

          {/* AI Insight */}
          <div className="cb-card overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-4 sm:px-6" style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-raised)" }}>
              <span className="text-2xl">🤖</span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{tr("AI Insight")}</h2>
                <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>{tr("Auto-generated from your flock's current data")}</p>
              </div>
              <button onClick={() => briefingQ.refetch()} disabled={briefingQ.isFetching} className="btn-ghost tap shrink-0 text-xs gap-1.5">
                <svg className={`h-3.5 w-3.5 ${briefingQ.isFetching ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0113.9-3.4M20 15a9 9 0 01-13.9 3.4"/>
                </svg>
                {tr("Refresh")}
              </button>
            </div>
            <div className="p-4 sm:p-6">
              {briefingQ.isFetching ? (
                <div className="flex items-center gap-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                  <svg className="h-4 w-4 animate-spin" style={{ color: "var(--brand)" }} viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  {tr("Generating insight from your flock's data…")}
                </div>
              ) : briefingQ.isError ? (
                <div className="rounded-lg p-4" style={{ background: "var(--status-amber-bg)", border: "1px solid var(--status-amber-border)" }}>
                  <p className="text-sm font-medium" style={{ color: "var(--status-amber-text)" }}>{tr("AI insight unavailable")}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {briefingQ.error instanceof Error ? tr(briefingQ.error.message) : tr("Check your GROQ_API_KEY in the .env file.")}
                  </p>
                  <button onClick={() => briefingQ.refetch()} className="tap mt-2 text-xs font-semibold hover:underline" style={{ color: "var(--brand)" }}>
                    {tr("Try again")}
                  </button>
                </div>
              ) : briefingQ.data ? (
                <div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>{briefingQ.data.briefing}</p>
                  <p className="mt-3 text-xs" style={{ color: "var(--text-tertiary)" }}>
                    {tr("Generated from current flock data")}
                  </p>
                </div>
              ) : (
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {tr("No insight yet. Press Refresh to write one from the flock's current data.")}
                </p>
              )}
            </div>
          </div>

          {/* AI Alert Analysis */}
          {(alertsQ.data || alertsQ.isFetching || alertsQ.isError) && (
            <div className="cb-card overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{tr("AI Alert Analysis")}</h2>
                <button onClick={() => alertsQ.refetch()} disabled={alertsQ.isFetching}
                  className="tap text-xs hover:underline" style={{ color: "var(--brand)" }}>
                  {tr("Refresh")}
                </button>
              </div>
              <div className="p-4 sm:p-6 space-y-3">
                {alertsQ.isFetching ? (
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{tr("Analyzing your flock data…")}</p>
                ) : alertsQ.isError ? (
                  <p className="text-sm" style={{ color: "var(--status-amber-text)" }}>
                    {alertsQ.error instanceof Error ? tr(alertsQ.error.message) : tr("Could not load AI analysis.")}
                  </p>
                ) : alertsQ.data?.alerts.map((a: any, i: number) => (
                  <div key={i} className="rounded-lg p-4"
                    style={a.severity === "critical"
                      ? { background: "var(--status-red-bg)", border: "1px solid var(--status-red-border)" }
                      : a.severity === "warning"
                        ? { background: "var(--status-amber-bg)", border: "1px solid var(--status-amber-border)" }
                        : { background: "var(--status-green-bg)", border: "1px solid var(--status-green-border)" }}>
                    <p className="text-sm font-semibold"
                      style={{ color: a.severity === "critical" ? "var(--status-red-text)" : a.severity === "warning" ? "var(--status-amber-text)" : "var(--status-green-text)" }}>
                      {a.title}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{a.detail}</p>
                    <p className="mt-2 text-xs font-medium" style={{ color: "var(--text-primary)" }}>→ {a.action}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          <div className="cb-card overflow-hidden">
            <div className="px-4 py-4 sm:px-6" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{tr("Recommendations")}</h2>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-tertiary)" }}>{tr("What you should do to keep your flock healthy")}</p>
            </div>
            <div style={{ borderBottom: "none" }}>
              {RECOMMENDATIONS.map((rec) => (
                <div key={rec.title} className="flex items-start gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5"
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <span className="text-2xl shrink-0">{rec.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{tr(rec.title)}</p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{tr(rec.why)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="cb-card p-5">
            <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{tr("Key Observations")}</h3>
            <ul className="space-y-2 text-sm">
              {observations.map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="shrink-0" style={{ color: item.ok ? "var(--status-green)" : item.ok === false ? "var(--status-amber)" : "var(--text-tertiary)" }}>
                    {item.ok ? "✓" : item.ok === false ? "⚠" : "–"}
                  </span>
                  <span style={{ color: "var(--text-secondary)" }}>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="cb-card p-5">
            <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {tr("Grow-out Status")}
            </h3>
            <div className="rounded-lg px-3 py-2 text-xs font-medium"
              style={{ background: "var(--status-green-bg)", color: "var(--status-green-text)", border: "1px solid var(--status-green-border)" }}>
              {report?.weight?.actualAvgG == null
                ? tr("Day {day} of {endDay}: no bird weights typed in yet", { day, endDay })
                : behind
                  ? tr("Day {day} of {endDay}: behind the weight target, check feed and water", { day, endDay })
                  : tr("Day {day} of {endDay}: on track for harvest", { day, endDay })}
            </div>
          </div>

          <div className="cb-card p-5 space-y-2">
            <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{tr("Quick Actions")}</h3>
            {[
              { to: "/visuals", icon: "📹", label: tr("View Live Camera") },
              { to: "/alerts",  icon: "🔔", label: tr("View All Alerts")  },
            ].map((item) => (
              <Link key={item.to} to={item.to as any}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-[color:var(--surface-raised)]"
                style={{ border: "1px solid var(--border-default)", color: "var(--text-primary)" }}>
                <span>{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
