import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/farm/AppShell";
import { getMonitoringReport } from "@/lib/farm/repository";
import { fetchSituationBriefing, fetchFeedbackAlerts } from "@/lib/intelligence";
import { SampleBadge, SampleNotice } from "@/components/farm/SampleBadge";

export const Route = createFileRoute("/intelligence")({
  head: () => ({ meta: [{ title: "Insights — CereBroiler" }] }),
  loader: () => getMonitoringReport(),
  component: InsightsPage,
});

const RECOMMENDATIONS = [
  { icon: "🌡️", title: "Maintain temperature between 26–32°C", why: "Broiler chickens are sensitive to heat. Temperatures above 32°C cause stress and reduce feed intake.", ok: true },
  { icon: "💧", title: "Make sure clean water is always available", why: "Chickens drink 2–3× more water than they eat. Dehydration quickly leads to health problems.", ok: true },
  { icon: "🐔", title: "Monitor the 2 inactive birds closely", why: "Long inactivity may indicate stress, illness, or injury. Early detection prevents losses.", ok: false },
  { icon: "💨", title: "Keep ventilation adequate", why: "Good air circulation prevents ammonia buildup, which irritates the respiratory system.", ok: true },
];

function InsightsPage() {
  // The day comes from Settings (through the report's cycle), not a fixed number.
  const report = Route.useLoaderData() as any;
  const day = Number(report?.cycle?.day ?? 0);
  const endDay = Number(report?.cycle?.endDay ?? report?.cycle?.lengthDays ?? 45);
  const behind = report?.weightStatus === "warning";
  const briefingQ = useQuery({
    queryKey: ["situation-briefing"],
    queryFn: fetchSituationBriefing,
    staleTime: Infinity, retry: false, refetchOnWindowFocus: false,
  });
  const alertsQ = useQuery({
    queryKey: ["feedback-alerts"],
    queryFn: fetchFeedbackAlerts,
    staleTime: Infinity, retry: false, refetchOnWindowFocus: false,
  });

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>Insights</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--text-tertiary)" }}>
          Recommendations based on your flock's current condition.
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
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>AI Insight</h2>
                <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Auto-generated from your flock's current data</p>
              </div>
              <button onClick={() => briefingQ.refetch()} disabled={briefingQ.isFetching} className="btn-ghost tap shrink-0 text-xs gap-1.5">
                <svg className={`h-3.5 w-3.5 ${briefingQ.isFetching ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0113.9-3.4M20 15a9 9 0 01-13.9 3.4"/>
                </svg>
                Refresh
              </button>
            </div>
            <div className="p-4 sm:p-6">
              {briefingQ.isFetching ? (
                <div className="flex items-center gap-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                  <svg className="h-4 w-4 animate-spin" style={{ color: "var(--brand)" }} viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Generating insight from your flock's data…
                </div>
              ) : briefingQ.isError ? (
                <div className="rounded-lg p-4" style={{ background: "var(--status-amber-bg)", border: "1px solid var(--status-amber-border)" }}>
                  <p className="text-sm font-medium" style={{ color: "var(--status-amber-text)" }}>AI insight unavailable</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {briefingQ.error instanceof Error ? briefingQ.error.message : "Check your GROQ_API_KEY in the .env file."}
                  </p>
                  <button onClick={() => briefingQ.refetch()} className="tap mt-2 text-xs font-semibold hover:underline" style={{ color: "var(--brand)" }}>
                    Try again
                  </button>
                </div>
              ) : briefingQ.data ? (
                <div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>{briefingQ.data.briefing}</p>
                  <p className="mt-3 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    Generated from current flock data
                  </p>
                </div>
              ) : (
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
                  Your flock is generally healthy. Average weight is increasing normally and environmental conditions are within the recommended range. Monitor the 2 inactive birds closely and ensure ventilation is adequate.
                </p>
              )}
            </div>
          </div>

          {/* AI Alert Analysis */}
          {(alertsQ.data || alertsQ.isFetching || alertsQ.isError) && (
            <div className="cb-card overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>AI Alert Analysis</h2>
                <button onClick={() => alertsQ.refetch()} disabled={alertsQ.isFetching}
                  className="tap text-xs hover:underline" style={{ color: "var(--brand)" }}>
                  Refresh
                </button>
              </div>
              <div className="p-4 sm:p-6 space-y-3">
                {alertsQ.isFetching ? (
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Analyzing your flock data…</p>
                ) : alertsQ.isError ? (
                  <p className="text-sm" style={{ color: "var(--status-amber-text)" }}>
                    {alertsQ.error instanceof Error ? alertsQ.error.message : "Could not load AI analysis."}
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
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Recommendations</h2>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-tertiary)" }}>What you should do to keep your flock healthy</p>
            </div>
            <div style={{ borderBottom: "none" }}>
              {RECOMMENDATIONS.map((rec) => (
                <div key={rec.title} className="flex items-start gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5"
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <span className="text-2xl shrink-0">{rec.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{rec.title}</p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{rec.why}</p>
                    {/* Status sits under the text on phones so it can't squeeze the title */}
                    <div className="mt-2 sm:hidden">
                      <span className={rec.ok ? "badge-green" : "badge-amber"}>
                        {rec.ok ? "✓ Good" : "⚠ Attention"}
                      </span>
                    </div>
                  </div>
                  <div className="hidden shrink-0 sm:block">
                    <span className={rec.ok ? "badge-green" : "badge-amber"}>
                      {rec.ok ? "✓ Good" : "⚠ Attention"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="cb-card p-5">
            <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Key Observations</h3>
            <ul className="space-y-2 text-sm">
              {[
                { ok: true,  text: "Average weight is on track" },
                { ok: true,  text: "Activity level is normal" },
                { ok: true,  text: "Ammonia level is safe (9 ppm)" },
                { ok: false, text: "2 birds inactive — monitor closely" },
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="shrink-0" style={{ color: item.ok ? "var(--status-green)" : "var(--status-amber)" }}>
                    {item.ok ? "✓" : "⚠"}
                  </span>
                  <span style={{ color: "var(--text-secondary)" }}>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="cb-card p-5">
            <h3 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Next Focus <SampleBadge />
            </h3>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Prepare for the next weight check in the coming days.
            </p>
            <div className="mt-3 rounded-lg px-3 py-2 text-xs font-medium"
              style={{ background: "var(--status-green-bg)", color: "var(--status-green-text)", border: "1px solid var(--status-green-border)" }}>
              {behind ? `Day ${day} of ${endDay}: behind the weight target, check feed and water` : `Day ${day} of ${endDay}: on track for harvest`}
            </div>
          </div>

          <div className="cb-card p-5 space-y-2">
            <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Quick Actions</h3>
            {[
              { to: "/visuals", icon: "📹", label: "View Live Camera" },
              { to: "/alerts",  icon: "🔔", label: "View All Alerts"  },
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
