import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/farm/AppShell";
import { getOperationsOverview } from "@/lib/farm/repository";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — Cerebroil" }] }),
  loader: () => getOperationsOverview(),
  component: Dashboard,
});

/* ── Helpers ────────────────────────────────────────────────── */
function SBadge({ s }: { s: "critical" | "warning" | "nominal" | "optimal" }) {
  const cls = { critical: "badge-red", warning: "badge-amber", nominal: "badge-blue", optimal: "badge-green" }[s];
  const lbl = { critical: "Critical", warning: "Warning", nominal: "Info", optimal: "Normal" }[s];
  return <span className={cls}>{lbl}</span>;
}

/* ── KPI icon chip ───────────────────────────────────────────
 * One accent (brand green tint) across every chip, varying only the
 * glyph (R-29: stays inside the existing 1-accent system instead of
 * adding a new color per metric; Liveliness Toolkit "one deliberate
 * accent"). Each glyph is drawn for what the metric actually is — a
 * bird, a scale, a thermometer, a droplet, a flask — not a generic
 * sparkle/library icon (R-04). */
function KpiIcon({ path }: { path: React.ReactNode }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10"
      style={{ background: "var(--brand-muted)" }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth={1.6}
        strokeLinecap="round" strokeLinejoin="round">
        {path}
      </svg>
    </span>
  );
}

const KPI_ICON_PATHS = {
  flock: (
    <>
      <path d="M12 3c-3 0-5 2-5 4.5S8.5 11 10 11h.5l-.7 3.2c-.2.9.5 1.8 1.4 1.8.7 0 1.3-.5 1.4-1.2L13.5 11H14c1.5 0 3-1.5 3-3.5S15 3 12 3Z" />
      <circle cx="13.3" cy="6" r="0.6" fill="var(--brand)" />
      <path d="M7 14.5 5 17m12-2.5 2 2.5M9.5 20.5h5" />
    </>
  ),
  scale: (
    <>
      <path d="M12 4v16M8 20h8M5 7h6M5 7 3 11.5a2.2 2.2 0 0 0 4.3 0L5 7Zm13 0h-6m6 0 2 4.5a2.2 2.2 0 0 1-4.3 0L18 7Z" />
    </>
  ),
  thermometer: (
    <>
      <path d="M12 14.5V5a2 2 0 1 0-4 0v9.5a3.5 3.5 0 1 0 4 0Z" />
      <circle cx="10" cy="17" r="1" fill="var(--brand)" />
    </>
  ),
  droplet: (
    <path d="M12 3s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11Z" />
  ),
  flask: (
    <path d="M9 3h6M10 3v5.5L5.8 16a2 2 0 0 0 1.75 3h8.9a2 2 0 0 0 1.75-3L14 8.5V3M8 14h8" />
  ),
} as const;

/* ── Active / Inactive donut (2 slices only) ────────────────── */
const BEHAVIOR_COLORS = {
  Active:   "var(--status-green)",
  Inactive: "var(--status-red)",
} as const;

function ActivityDonut({ active, inactive, total }: { active: number; inactive: number; total: number }) {
  const bd = { Active: active, Inactive: inactive };
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
function WeightSparkline({ curve }: { curve: { actualG: number }[] }) {
  const pts = curve.filter((p) => p.actualG > 0);
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
  const data = Route.useLoaderData() as any;
  const cluster = data.cluster as { readings: { parameter: string; value: number; bounds: { label: string } }[] } | null;

  const readings = cluster?.readings ?? [];
  const temp  = readings.find((r) => r.parameter === "temperature");
  const humid = readings.find((r) => r.parameter === "humidity");
  const nh3   = readings.find((r) => r.parameter === "nh3");

  // No per-bird roster exists in the live schema (only house-level population
  // and a flock-wide activity index) — derive a real active/inactive split
  // from today's measured activity index applied to the house population,
  // rather than carrying over the mock's fictional 28-bird sample roster.
  // Scope the bird count to the house the live camera is watching (matches
  // the page's single-pen framing) rather than summing every house.
  const houses: { id: string; population: number }[] = data.houses ?? [];
  const total = houses.find((h) => h.id === data.cluster?.houseId)?.population
    ?? houses.reduce((s, h) => s + h.population, 0);
  // The API sends null when no activity has been recorded; show that as
  // "no data" rather than turning it into 0% (every bird inactive).
  const actPct: number | null = data.activity?.value != null ? Math.round(data.activity.value) : null;
  const active    = actPct != null ? Math.round((total * actPct) / 100) : null;
  const inactive  = active != null ? total - active : null;
  const avgWeight = data.weight?.actualAvgG ?? 0;
  const topAlerts = (data.alerts as any[]).filter((a) => !a.acknowledged).slice(0, 4);

  return (
    <AppShell>
      {/* Header. Title chip reuses the KPI cards' bird glyph as the identity
          motif. The camera link is the page's one accent action: the live feed
          is where an operator goes to check on what the numbers report. */}
      <header className="mt-6 mb-6 flex flex-col gap-4 sm:mt-8 sm:flex-row sm:items-center sm:justify-between lg:mt-10">
        <div className="flex min-w-0 items-center gap-3">
          <KpiIcon path={KPI_ICON_PATHS.flock} />
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: "var(--text-primary)" }}>
            Dashboard
          </h1>
        </div>
        <Link
          to="/visuals"
          className="btn-primary tap shrink-0 self-start sm:self-auto"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="6" width="14" height="12" rx="2" />
            <path d="m16 10 6-3v10l-6-3" />
          </svg>
          Open live camera
        </Link>
      </header>

      {/* ── KPI grid — responsive ───────────────────────────────
           Flock count is the page's focal metric, so it takes the wide
           slot whenever the grid can't fit all five in one row
           (phone: 1 + 2×2, tablet/laptop: 2+1 / 3, wide desktop: 5). */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        {/* Flock */}
        <div className="cb-card col-span-2 xl:col-span-1 p-4 sm:p-5 flex min-w-0 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <p className="label-section min-w-0">Flock Count</p>
            <KpiIcon path={KPI_ICON_PATHS.flock} />
          </div>
          <div className="flex items-baseline gap-1 mt-2">
            <span className="font-mono text-2xl font-bold" style={{ color: "var(--cv-accent)" }}>{total}</span>
            <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>birds</span>
          </div>
          {active != null && inactive != null ? (
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
          ) : (
            <p className="mt-1 text-xs" style={{ color: "var(--text-tertiary)" }}>Activity not recorded yet</p>
          )}
        </div>

        {/* Avg Weight */}
        <div className="cb-card p-4 sm:p-5 flex min-w-0 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <p className="label-section min-w-0">Avg Weight</p>
            <KpiIcon path={KPI_ICON_PATHS.scale} />
          </div>
          <div className="flex items-baseline gap-1 mt-2">
            <span className="font-mono text-2xl font-bold" style={{ color: "var(--cv-accent)" }}>
              {(avgWeight / 1000).toFixed(3)}
            </span>
            <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>kg</span>
          </div>
          <p className="font-mono text-xs mt-1" style={{ color: "var(--status-green-text)" }}>
            {data.weight?.variancePercent >= 0 ? "+" : ""}{(data.weight?.variancePercent ?? 0).toFixed(1)}% vs std
          </p>
        </div>

        {/* Temperature */}
        <div className="cb-card p-4 sm:p-5 flex min-w-0 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <p className="label-section min-w-0">Temperature</p>
            <KpiIcon path={KPI_ICON_PATHS.thermometer} />
          </div>
          <div className="flex items-baseline gap-1 mt-2">
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
        <div className="cb-card p-4 sm:p-5 flex min-w-0 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <p className="label-section min-w-0">Humidity</p>
            <KpiIcon path={KPI_ICON_PATHS.droplet} />
          </div>
          <div className="flex items-baseline gap-1 mt-2">
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
        <div className="cb-card p-4 sm:p-5 flex min-w-0 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <p className="label-section min-w-0">Ammonia NH₃</p>
            <KpiIcon path={KPI_ICON_PATHS.flask} />
          </div>
          <div className="flex items-baseline gap-1 mt-2">
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
      <div className="mb-6 grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
        {/* Weight sparkline */}
        <div className="cb-card p-5 sm:p-6 xl:col-span-2">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Weight Trend
              </h2>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                Actual scans vs Ross 308 &middot; Day {data.cycle?.day ?? "—"}/42
              </p>
            </div>
            <Link to="/telemetry" className="tap inline-flex shrink-0 items-center justify-end text-xs font-semibold hover:underline"
              style={{ color: "var(--brand)" }}>
              Full Analytics →
            </Link>
          </div>
          <WeightSparkline curve={data.weight?.curve ?? []} />
          <div className="mt-3 grid grid-cols-3 gap-3 pt-3"
            style={{ borderTop: "1px solid var(--border-subtle)" }}>
            {[
              { label: "Confidence", value: `${Math.round(data.weight?.estimationConfidencePercent ?? 0)}%` },
              { label: "Sample",     value: `${data.weight?.sampleSize ?? 0} birds` },
              { label: "FCR",        value: String(data.feed?.fcr ?? "—") },
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
        <div className="cb-card p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Activity Status
            </h2>
            <span className="font-mono text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              last scan
            </span>
          </div>
          {actPct != null && active != null && inactive != null ? (
            <>
              <ActivityDonut active={active} inactive={inactive} total={total} />
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
            </>
          ) : (
            /* Empty state (R-27): no activity samples recorded for this cycle */
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <svg className="h-8 w-8" style={{ color: "var(--text-tertiary)" }} fill="none" stroke="currentColor"
                strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h4l3-8 4 16 3-8h4" />
              </svg>
              <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>No activity data yet</p>
              <p className="max-w-[16rem] text-xs" style={{ color: "var(--text-tertiary)" }}>
                Appears once the camera pipeline records movement for this cycle.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Recent alerts ───────────────────────────────────── */}
      <div className="cb-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Recent Alerts</h2>
          <Link to="/alerts" className="tap inline-flex items-center justify-end text-xs font-semibold hover:underline" style={{ color: "var(--brand)" }}>
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
            <div className="hidden sm:grid grid-cols-12 gap-3 px-6 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border-subtle)" }}>
              <div className="col-span-1" />
              <div className="col-span-3">Type</div>
              <div className="col-span-5">Message</div>
              <div className="col-span-2">Time</div>
              <div className="col-span-1">Sev.</div>
            </div>
            {topAlerts.map((a, i) => (
              <div key={a.id}
                className="flex flex-col gap-1 px-4 py-3.5 sm:grid sm:grid-cols-12 sm:items-center sm:gap-3 sm:px-6 transition-colors"
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
                <div className="sm:col-span-3 flex min-w-0 items-center gap-2">
                  <span className="shrink-0 sm:hidden"><SBadge s={a.severity as "critical" | "warning" | "nominal"} /></span>
                  <p className="min-w-0 text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
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
