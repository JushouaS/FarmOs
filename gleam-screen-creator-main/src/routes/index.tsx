import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/farm/AppShell";
import { GrowthCard } from "@/components/farm/GrowthCard";
import { buildGrowthCardData } from "@/lib/farm/growth";
import { getOperationsOverview } from "@/lib/farm/repository";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — Cerebroil" }] }),
  loader: () => getOperationsOverview(),
  component: Dashboard,
});

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
} as const;

/* ── Dashboard ──────────────────────────────────────────────── */
function Dashboard() {
  const data = Route.useLoaderData() as any;
  const growth = buildGrowthCardData(data);

  return (
    <AppShell>
      {/* Header. Title chip reuses the KPI cards' bird glyph as the identity
          motif. The camera link is the page's one accent action: the live feed
          is where an operator goes to check on what the numbers report. */}
      <header className="mt-6 mb-6 flex flex-col gap-4 sm:mt-8 sm:flex-row sm:items-center sm:justify-between lg:mt-2">
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

      {/* ── Growth: the weight story first, house readings kept small ── */}
      <GrowthCard data={growth} />
    </AppShell>
  );
}
