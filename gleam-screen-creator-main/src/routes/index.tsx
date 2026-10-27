import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/farm/AppShell";
import { getOperationsOverview } from "@/lib/farm/repository";
import { activeBirds, behaviorBreakdown, broilers, farm, inactiveBirds } from "@/lib/farm/dataset";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — Cerebroil" }] }),
  loader: () => getOperationsOverview(),
  component: Dashboard,
});

/* ── Helpers ────────────────────────────────────────────────── */
/** Monospaced telemetry value with cv-accent colour */
function TV({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono font-semibold" style={{ color: "var(--cv-accent)" }}>
      {children}
    </span>
  );
}

function SBadge({ s }: { s: "critical" | "warning" | "nominal" | "optimal" }) {
  const cls = { critical: "badge-red", warning: "badge-amber", nominal: "badge-blue", optimal: "badge-green" }[s];
  const lbl = { critical: "Critical", warning: "Warning", nominal: "Info", optimal: "Normal" }[s];
  return <span className={cls}>{lbl}</span>;
}

/* ── Active / Inactive donut (2 slices only) ────────────────── */
const BEHAVIOR_COLORS = {
  Active:   "var(--status-green)",
  Inactive: "var(--status-red)",
} as const;

function ActivityDonut() {
  const bd = behaviorBreakdown();
  const total = broilers.length;
  const R = 38, CX = 48, CY = 48, SW = 11;
  const circ = 2 * Math.PI * R;
  let offset = 0;
  const slices = (["Active", "Inactive"] as const).filter((k) => bd[k] > 0);
  return (
    <div className="flex items-center gap-5">
      <svg width="96" height="96" viewBox="0 0 96 96" className="shrink-0">
        {slices.map((k) => {
          const dash = (bd[k] / total) * circ;
          const el = (
            <circle key={k} cx={CX} cy={CY} r={R} fill="none"
              stroke={BEHAVIOR_COLORS[k]} strokeWidth={SW}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
              style={{ transform: "rotate(-90deg)", transformOrigin: `${CX}px ${CY}px` }}
            />
          );
          offset += dash;
          return el;
        })}
        <text x={CX} y={CY - 5} textAnchor="middle" fontSize="16" fontWeight="700"
          fill="var(--text-primary)">{total}</text>
        <text x={CX} y={CY + 10} textAnchor="middle" fontSize="8"
          fill="var(--text-tertiary)">birds</text>
      </svg>
      <div className="space-y-2 min-w-0">
        {slices.map((k) => (
          <div key={k} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: BEHAVIOR_COLORS[k] }} />
            <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>{k}</span>
            <span className="ml-auto font-mono text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {bd[k]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Weight sparkline ────────────────────────────────────────── */
function WeightSparkline() {
  const pts = farm.weight.curve.filter((p) => p.actualG > 0);
  const W = 260, H = 60, pX = 4, pY = 6;
  const maxV = Math.max(...pts.map((p) => p.actualG));
  const xS = (i: number) => pX + (i / (pts.length - 1)) * (W - pX * 2);
  const yS = (v: number) => H - pY - (v / maxV) * (H - pY * 2);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${xS(i).toFixed(1)},${yS(p.actualG).toFixed(1)}`).join(" ");
  const area = `${line} L${xS(pts.length - 1)},${H - pY} L${xS(0)},${H - pY} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12">
      <defs>
        <linearGradient id="wsGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#wsGrad)" />
      <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" />
      <circle cx={xS(pts.length - 1)} cy={yS(pts[pts.length - 1]!.actualG)} r="3" fill="var(--brand)" />
    </svg>
  );
}

/* ── Dashboard ──────────────────────────────────────────────── */
function Dashboard() {
  const data = Route.useLoaderData() as Awaited<ReturnType<typeof getOperationsOverview>>;
  const cluster = data.cluster as { readings: { parameter: string; value: number; bounds: { label: string } }[] };

  const temp  = cluster.readings.find((r) => r.parameter === "temperature");
  const humid = cluster.readings.find((r) => r.parameter === "humidity");
  const nh3   = cluster.readings.find((r) => r.parameter === "nh3");

  const active    = activeBirds();
  const inactive  = inactiveBirds();
  const total     = broilers.length;
  const actPct    = Math.round((active / total) * 100);
  const avgWeight = Math.round(broilers.reduce((s, b) => s + b.weightG, 0) / total);
  const topAlerts = farm.alerts.filter((a) => !a.acknowledged).slice(0, 4);

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Dashboard
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            {farm.facility.name} &middot; Pen 1 &middot; Grow-out Day{" "}
            <TV>{farm.cycle.day}</TV>/42 &middot; Ross 308
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 self-start shrink-0"
          style={{ background: "var(--surface-raised)", border: "1px solid var(--border-subtle)" }}>
          <span className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--status-green)", boxShadow: "0 0 4px var(--status-green)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Status: <span className="font-semibold text-[var(--status-green)]">Healthy</span>
          </span>
        </div>
      </div>

      {/* ── KPI grid — responsive ───────────────────────────── */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {/* Flock */}
        <div className="cb-card p-4 flex flex-col gap-1">
          <p className="label-section">Flock Count</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-mono text-2xl font-bold" style={{ color: "var(--cv-accent)" }}>{total}</span>
            <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>birds</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--status-green)" }} />
            <span className="font-mono text-xs" style={{ color: "var(--status-green-text)" }}>{active} active</span>
            {inactive > 0 && (
              <>
                <span style={{ color: "var(--border-strong)" }}>·</span>
                <span className="font-mono text-xs" style={{ color: "var(--status-red-text)" }}>{inactive} inactive</span>
              </>
            )}
          </div>
        </div>

        {/* Avg Weight */}
        <div className="cb-card p-4 flex flex-col gap-1">
          <p className="label-section">Avg Weight</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-mono text-2xl font-bold" style={{ color: "var(--cv-accent)" }}>
              {(avgWeight / 1000).toFixed(3)}
            </span>
            <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>kg</span>
          </div>
          <p className="font-mono text-xs mt-1" style={{ color: "var(--status-green-text)" }}>
            +{((avgWeight - farm.weight.standardG) / farm.weight.standardG * 100).toFixed(1)}% vs std
          </p>
        </div>

        {/* Temperature */}
        <div className="cb-card p-4 flex flex-col gap-1">
          <p className="label-section">Temperature</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-mono text-2xl font-bold" style={{ color: "var(--cv-accent)" }}>
              {temp?.value ?? 29.1}
            </span>
            <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>°C</span>
          </div>
          <p className="font-mono text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
            {temp?.bounds?.label ?? "26–32°C"}
          </p>
        </div>

        {/* Humidity */}
        <div className="cb-card p-4 flex flex-col gap-1">
          <p className="label-section">Humidity</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-mono text-2xl font-bold" style={{ color: "var(--cv-accent)" }}>
              {humid?.value ?? 63}
            </span>
            <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>%</span>
          </div>
          <p className="font-mono text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
            {humid?.bounds?.label ?? "50–70%"}
          </p>
        </div>

        {/* Ammonia */}
        <div className="cb-card p-4 flex flex-col gap-1">
          <p className="label-section">Ammonia NH₃</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-mono text-2xl font-bold" style={{ color: "var(--cv-accent)" }}>
              {nh3?.value ?? 9}
            </span>
            <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>ppm</span>
          </div>
          <p className="font-mono text-xs mt-1" style={{ color: "var(--status-green-text)" }}>
            Safe · {nh3?.bounds?.label ?? "< 25 ppm"}
          </p>
        </div>
      </div>

      {/* ── Mid row ─────────────────────────────────────────── */}
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        {/* Weight sparkline */}
        <div className="cb-card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Weight Trend
              </h2>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                Actual scans vs Ross 308 &middot; Day {farm.cycle.day}/42
              </p>
            </div>
            <Link to="/telemetry" className="text-xs font-semibold hover:underline"
              style={{ color: "var(--brand)" }}>
              Full Analytics →
            </Link>
          </div>
          <WeightSparkline />
          <div className="mt-3 grid grid-cols-3 gap-3 pt-3"
            style={{ borderTop: "1px solid var(--border-subtle)" }}>
            {[
              { label: "Confidence", value: `${farm.weight.estimationConfidencePercent}%` },
              { label: "Sample",     value: `${farm.weight.sampleSize} birds` },
              { label: "FCR",        value: String(farm.feed.fcr) },
            ].map((s) => (
              <div key={s.label}>
                <p className="label-section">{s.label}</p>
                <p className="font-mono text-sm font-bold mt-0.5" style={{ color: "var(--cv-accent)" }}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Activity donut */}
        <div className="cb-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Activity Status
            </h2>
            <span className="font-mono text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              last scan
            </span>
          </div>
          <ActivityDonut />
          <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span style={{ color: "var(--text-secondary)" }}>Activity rate</span>
              <span className="font-mono font-bold" style={{ color: "var(--cv-accent)" }}>{actPct}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--surface-sunken)" }}>
              <div className="h-2 rounded-full transition-all"
                style={{ width: `${actPct}%`, background: "var(--brand)" }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Recent alerts ───────────────────────────────────── */}
      <div className="cb-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Recent Alerts</h2>
          <Link to="/alerts" className="text-xs font-semibold hover:underline" style={{ color: "var(--brand)" }}>
            View all →
          </Link>
        </div>

        {topAlerts.length === 0 ? (
          <div className="flex flex-col items-center py-10">
            <svg className="mb-2 h-7 w-7" style={{ color: "var(--status-green)" }}
              fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No active alerts</p>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border-subtle)" }}>
              <div className="col-span-1" />
              <div className="col-span-3">Type</div>
              <div className="col-span-5">Message</div>
              <div className="col-span-2">Time</div>
              <div className="col-span-1">Sev.</div>
            </div>
            {topAlerts.map((a, i) => (
              <div key={a.id}
                className="flex flex-col gap-1 px-5 py-3.5 sm:grid sm:grid-cols-12 sm:items-center sm:gap-3 transition-colors"
                style={{
                  borderBottom: i < topAlerts.length - 1 ? "1px solid var(--border-subtle)" : "none",
                  background: "transparent",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-raised)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div className="hidden sm:flex sm:col-span-1">
                  <div className="h-7 w-7 rounded-lg flex items-center justify-center font-mono text-[10px] font-bold"
                    style={a.severity === "critical"
                      ? { background: "var(--status-red-bg)", color: "var(--status-red-text)" }
                      : a.severity === "warning"
                        ? { background: "var(--status-amber-bg)", color: "var(--status-amber-text)" }
                        : { background: "var(--status-blue-bg)", color: "var(--status-blue-text)" }}>
                    {a.kind.slice(0, 2).toUpperCase()}
                  </div>
                </div>
                <div className="sm:col-span-3 flex items-center gap-2">
                  <SBadge s={a.severity as "critical" | "warning" | "nominal"} />
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                    {a.kind}
                  </p>
                </div>
                <div className="sm:col-span-5">
                  <p className="text-xs line-clamp-1" style={{ color: "var(--text-secondary)" }}>{a.message}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {new Date(a.raisedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <div className="hidden sm:block sm:col-span-1">
                  <SBadge s={a.severity as "critical" | "warning" | "nominal"} />
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </AppShell>
  );
}
