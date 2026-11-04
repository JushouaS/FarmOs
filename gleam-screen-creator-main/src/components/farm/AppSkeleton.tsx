import { tr } from "@/lib/i18n";

/* The page's outline, shown while the session is restored on a refresh: the
 * sidebar, the top bar and a dashboard-shaped page as grey blocks with a slow
 * shimmer. It follows the real shell's sizes (AppShell, SideNav), so when the
 * real page arrives it fills the same places instead of jumping.
 * It reads no saved settings, so the server and the browser draw the same thing. */

/** One grey block. `side` is the tone used on the sidebar's darker surface. */
function Block({ className = "", side = false }: { className?: string; side?: boolean }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={side ? ({ "--skeleton-bg": "color-mix(in srgb, var(--sidebar-muted) 18%, transparent)" } as React.CSSProperties) : undefined}
      aria-hidden="true"
    />
  );
}

function SidebarSkeleton() {
  return (
    <div
      className="fixed left-0 top-0 z-40 hidden h-full w-60 flex-col lg:flex"
      style={{ background: "var(--sidebar-bg)", borderRight: "1px solid var(--sidebar-border)" }}
      aria-hidden="true"
    >
      {/* The brand is real: it is the one thing that is already known */}
      <div className="flex h-14 shrink-0 items-center gap-3 px-3.5" style={{ borderBottom: "1px solid var(--sidebar-border)" }}>
        <div
          className="flex h-[34px] w-[34px] items-center justify-center rounded-xl"
          style={{ background: "linear-gradient(135deg, var(--sidebar-active-text), color-mix(in srgb, var(--sidebar-active-text) 75%, #059669))" }}
        >
          <svg className="h-5 w-5" style={{ color: "#020617" }} fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="4" />
            <path strokeLinecap="round" d="M3 9l2-3h14l2 3M3 9v9a2 2 0 002 2h14a2 2 0 002-2V9" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="font-display text-sm font-bold leading-none tracking-tight" style={{ color: "var(--sidebar-heading)" }}>
            {tr("Cerebroil")}
          </div>
          <div className="mt-1 text-xs font-medium leading-none" style={{ color: "var(--sidebar-muted)" }}>
            {tr("Flock Monitor")}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-1 px-3 py-4">
        <Block side className="mb-3 ml-1 h-2.5 w-20" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex h-10 items-center gap-3 px-2">
            <Block side className="h-5 w-5 shrink-0 rounded-md" />
            <Block side className="h-3 rounded" />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 px-4 py-4" style={{ borderTop: "1px solid var(--sidebar-border)" }}>
        <Block side className="h-8 w-8 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Block side className="h-2.5 w-24 rounded" />
          <Block side className="h-2 w-16 rounded" />
        </div>
      </div>
    </div>
  );
}

function TopBarSkeleton() {
  return (
    <div
      className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-5 lg:px-6"
      style={{ background: "var(--surface-card)", borderColor: "var(--border-subtle)" }}
      aria-hidden="true"
    >
      <Block className="h-8 w-8 rounded-lg lg:invisible" />
      <div className="flex items-center gap-2">
        <Block className="h-8 w-14 rounded-lg" />
        <Block className="h-8 w-8 rounded-lg" />
        <Block className="h-8 w-8 rounded-lg" />
        <Block className="h-8 w-8 rounded-full" />
      </div>
    </div>
  );
}

function BottomNavSkeleton() {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 flex lg:hidden"
      style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1.5 py-2">
          <Block className="h-4 w-4 rounded" />
          <Block className="h-2 w-8 rounded" />
        </div>
      ))}
    </div>
  );
}

/** A page-sized card: a heading line, a column of figures, and a chart area. */
function PageSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Block className="h-10 w-10 rounded-xl" />
          <Block className="h-8 w-44 rounded-lg sm:w-56" />
        </div>
        <Block className="h-10 w-32 rounded-xl sm:w-40" />
      </div>

      <div className="cb-card space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Block className="h-4 w-16 rounded" />
            <Block className="h-3 w-48 rounded sm:w-64" />
          </div>
          <Block className="h-9 w-28 rounded-xl sm:w-36" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <Block className="h-2.5 w-24 rounded" />
            <Block className="h-11 w-40 rounded-lg" />
            <Block className="h-7 w-44 rounded-full" />
            <Block className="h-3 w-full rounded" />
            <Block className="h-3 w-4/5 rounded" />
            <div className="grid grid-cols-2 gap-4 border-t pt-4 lg:grid-cols-1" style={{ borderColor: "var(--border-subtle)" }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <Block className="h-2.5 w-16 rounded" />
                  <Block className="h-5 w-20 rounded" />
                </div>
              ))}
            </div>
          </div>
          <Block className="h-56 w-full rounded-xl sm:h-72 lg:h-[26rem]" />
        </div>
      </div>
    </div>
  );
}

/** What the page shows while the session is being restored. */
export function AppSkeleton() {
  return (
    <div
      className="flex min-h-dvh"
      style={{ background: "var(--surface-page)" }}
      role="status"
      aria-busy="true"
      aria-label={tr("Restoring session")}
    >
      <SidebarSkeleton />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <TopBarSkeleton />
        <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:p-5 lg:p-6 lg:pb-6">
          <PageSkeleton />
        </main>
      </div>
      <BottomNavSkeleton />
    </div>
  );
}
