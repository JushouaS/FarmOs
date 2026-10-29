import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { AppShell, useAppShell } from "@/components/farm/AppShell";
import { Menu } from "lucide-react";
import { CameraAnalysis } from "@/components/farm/CameraAnalysis";
import { SampleBadge, SampleNotice } from "@/components/farm/SampleBadge";
import {
  farm,
  broilers,
  kinectDetections,
  behaviorBreakdown,
  weightBreakdown,
  isNightCycle,
} from "@/lib/farm/dataset";

export const Route = createFileRoute("/visuals")({
  head: () => ({ meta: [{ title: "Live Vision - Cerebroil" }] }),
  component: VisualsDashboardPage,
});

type ViewLayout = "dual" | "dahua" | "kinect";

/* The menu button needs the app shell's controls, which only exist for
 * components rendered INSIDE <AppShell>. VisualsDashboardPage creates the
 * shell, so calling useAppShell() there returns null and the button did
 * nothing. This small component sits below the shell and can reach them. */
function ShellButtons() {
  const shell = useAppShell();
  return (
    <>
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => shell?.openMobileMenu()}
        className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-raised)] lg:hidden"
        style={{ color: "var(--text-secondary)" }}
        aria-label="Open menu"
        aria-controls="app-sidenav"
      >
        <Menu className="h-5 w-5" />
      </button>
    </>
  );
}

export function VisualsDashboardPage() {
  const [layout, setLayout] = useState<ViewLayout>("dual");
  const [dahuaError, setDahuaError] = useState(false);
  const [kinectError, setKinectError] = useState(false);
  // The clock drives the day/night cycle: day is 05:00 to 16:59, and birds
  // count as sleeping the rest of the time (isNightCycle). Null until mounted so the server render and
  // the first client render match.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const nightModeActive = now ? isNightCycle(now) : false;

  // Vision service (cerebroil-stream, port 5000) on the host that served this
  // page, so a phone on the LAN gets this machine's feed instead of its own
  // localhost. Set after mount: the server render can't know that host, and a
  // guessed src would mismatch on hydration.
  const [feedOrigin, setFeedOrigin] = useState<string | null>(null);
  useEffect(() => {
    setFeedOrigin(`${window.location.protocol}//${window.location.hostname}:5000`);
  }, []);
  const feedHost = feedOrigin?.replace(/^https?:\/\//, "") ?? "port 5000";

  const containerRef = useRef<HTMLDivElement>(null);

  const bBreakdown = behaviorBreakdown(nightModeActive);
  const wBreakdown = weightBreakdown();
  const totalBirds = broilers.length;

  const handleFullscreenToggle = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  };

  return (
    <AppShell bare>
      {/* Below lg the page scrolls as a document (feeds, then the inspector);
          from lg it is a fixed-height workspace with its own scroll regions. */}
      <div
        ref={containerRef}
        className="flex flex-col bg-[var(--surface-page)] text-[var(--text-primary)] lg:h-dvh [&:fullscreen]:h-dvh [&:fullscreen]:overflow-y-auto"
      >
        {/* Top Control Bar — wraps to two rows on narrow screens */}
        <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-2 sm:px-5 lg:flex-nowrap lg:px-6 elevation-1">
          <div className="flex min-w-0 items-center gap-3">
            <ShellButtons />
            <div className="flex min-w-0 items-center gap-2">
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--cv-accent)] opacity-75"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--cv-accent)]"></span>
              </span>
              <h1 className="truncate font-display text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                Live Camera Feeds
              </h1>
            </div>

            <div className="hidden h-4 w-px bg-[var(--border-default)] xl:block" />

            {/* Farm & Pen Info Tag */}
            <div className="hidden items-center gap-1.5 text-xs text-[var(--text-secondary)] xl:flex">
              <span className="rounded bg-[var(--surface-raised)] px-2 py-0.5 font-medium">
                {farm.facility.houses[0].label}
              </span>
              <span className="text-[var(--text-tertiary)]">/</span>
              <span>{farm.facility.name}</span>
            </div>
          </div>

          {/* Controls: View Layout Switcher, Fullscreen */}
          {/* Full-width second row on phones; inline from sm */}
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {/* Layout Mode Selector (Concentric: outer rounded-lg p-0.5, inner rounded-md) */}
            <div className="flex flex-1 items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-0.5 sm:flex-none">
              <button
                type="button"
                onClick={() => setLayout("dual")}
                aria-pressed={layout === "dual"}
                className={`tactile-btn tap flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:flex-none ${layout === "dual"
                    ? "bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                aria-label="Dual camera split layout"
              >
                <span className="sm:hidden">Split</span>
                <span className="hidden sm:inline">Split (Dual)</span>
              </button>
              <button
                type="button"
                onClick={() => setLayout("dahua")}
                aria-pressed={layout === "dahua"}
                className={`tactile-btn tap flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:flex-none ${layout === "dahua"
                    ? "bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                aria-label="Dahua overhead view only"
              >
                <span className="sm:hidden">Dahua</span>
                <span className="hidden sm:inline">Dahua CCTV</span>
              </button>
              <button
                type="button"
                onClick={() => setLayout("kinect")}
                aria-pressed={layout === "kinect"}
                className={`tactile-btn tap flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:flex-none ${layout === "kinect"
                    ? "bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                aria-label="Kinect 3D depth view only"
              >
                <span className="sm:hidden">Kinect</span>
                <span className="hidden sm:inline">Kinect 3D</span>
              </button>
            </div>

            {/* Fullscreen Trigger Button */}
            <button
              type="button"
              onClick={handleFullscreenToggle}
              className="tactile-btn tap flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              title="Toggle Fullscreen"
              aria-label="Toggle Fullscreen"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            </button>
          </div>
        </header>

        {/* Main Content Area: Video Viewports + Inspector Panel */}
        <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row lg:overflow-hidden">
          {/* Video Feeds Grid */}
          <main className="p-3 sm:p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <div
              className={`grid gap-3 lg:h-full lg:gap-4 ${layout === "dual"
                  ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
                  : "grid-cols-1"
                }`}
            >
              {/* Feed 1: Dahua Overhead CCTV (YOLOv8 Detection) */}
              {(layout === "dual" || layout === "dahua") && (
                <div className="relative flex flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] elevation-2">
                  {/* Viewport Header */}
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--cv-accent)]" />
                      <span className="truncate font-mono text-xs font-semibold tracking-wider text-[var(--text-primary)]">
                        CAM-01 : BROILERS BEHAVIOR
                      </span>
                    </div>
                  </div>

                  {/* Video Viewport Container — 16:9 box when the page scrolls,
                      fills the available height in the lg workspace */}
                  <div className="relative flex aspect-video min-h-60 items-center justify-center overflow-hidden bg-black lg:aspect-auto lg:min-h-0 lg:flex-1">
                    {!dahuaError ? (
                      feedOrigin && (
                        <img
                          src={`${feedOrigin}/video_feed/dahua`}
                          alt="Live camera feed of the broilers' behavior"
                          className="h-full w-full object-contain"
                          onError={() => setDahuaError(true)}
                        />
                      )
                    ) : (
                      <div className="flex flex-col items-center justify-center px-6 pt-4 pb-12 text-center">
                        <div className="mb-2 rounded-full bg-[var(--status-amber-bg)] p-3 text-[var(--status-amber-text)]">
                          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                          </svg>
                        </div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                          Vision service not reachable
                        </h3>
                        {/* Only shown when the service itself is down; with the
                            service up but the camera off it streams a placeholder. */}
                        <p className="mt-1 max-w-xs text-xs text-[var(--text-secondary)]">
                          Nothing is answering at {feedHost}. Start cerebroil-stream, then retry.
                        </p>
                        <button
                          type="button"
                          onClick={() => setDahuaError(false)}
                          className="tactile-btn tap mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--brand)]"
                        >
                          Retry Connection
                        </button>
                      </div>
                    )}

                    {/* No overlays on this feed: the boxes, temperature/humidity chip and
                        bird count that used to sit here were demo data, not camera output. */}
                  </div>
                </div>
              )}

              {/* Feed 2: Microsoft Kinect 3D Depth Station */}
              {(layout === "dual" || layout === "kinect") && (
                <div className="relative flex flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] elevation-2">
                  {/* Viewport Header */}
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--brand)]" />
                      <span className="truncate font-mono text-xs font-semibold tracking-wider text-[var(--text-primary)]">
                        CAM-02 : WEIGHING STATION
                      </span>
                    </div>
                  </div>

                  {/* Video Viewport Container — 16:9 box when the page scrolls,
                      fills the available height in the lg workspace */}
                  <div className="relative flex aspect-video min-h-60 items-center justify-center overflow-hidden bg-black lg:aspect-auto lg:min-h-0 lg:flex-1">
                    {!kinectError ? (
                      feedOrigin && (
                        <img
                          src={`${feedOrigin}/video_feed/kinect`}
                          alt="Microsoft Kinect 3D depth sensor station feed"
                          className="h-full w-full object-contain"
                          onError={() => setKinectError(true)}
                        />
                      )
                    ) : (
                      <div className="flex flex-col items-center justify-center px-6 pt-4 pb-12 text-center">
                        <div className="mb-2 rounded-full bg-[var(--status-blue-bg)] p-3 text-[var(--status-blue-text)]">
                          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="12 2 2 7 12 12 22 7 12 2" />
                            <polyline points="2 17 12 22 22 17" />
                            <polyline points="2 12 12 17 22 12" />
                          </svg>
                        </div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                          Depth station not reachable
                        </h3>
                        <p className="mt-1 max-w-xs text-xs text-[var(--text-secondary)]">
                          No depth feed from {feedHost}. Start cerebroil-stream, then recheck.
                        </p>
                        <button
                          type="button"
                          onClick={() => setKinectError(false)}
                          className="tactile-btn tap mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--brand)]"
                        >
                          Recheck Sensor
                        </button>
                      </div>
                    )}

                    {/* Interactive Kinect Depth-Target Overlay */}
                    {!kinectError && (
                      <div className="pointer-events-none absolute inset-0">
                        {kinectDetections.map((kd) => (
                          <div
                            key={kd.id}
                            style={{
                              left: `${kd.x}%`,
                              top: `${kd.y}%`,
                              width: `${kd.w}%`,
                              height: `${kd.h}%`,
                            }}
                            className="absolute rounded border border-dashed border-[var(--brand)] bg-[rgba(52,211,153,0.06)]"
                          >
                            <div className="absolute -top-5 left-0 flex items-center gap-1 rounded bg-black/85 px-1.5 py-0.5 text-[9px] font-mono text-[var(--brand)]">
                              <span>{kd.id}</span>
                              <span className="text-[var(--text-primary)] tabular-nums">{kd.weightG}g</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </main>

          {/* Right Inspector & Analytics Drawer Panel */}
          {/* Stacks under the feeds below lg (2-up on tablets), docks right from lg */}
          <aside className="grid gap-3 border-t border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 sm:grid-cols-2 sm:p-4 lg:flex lg:w-72 lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:border-t-0 lg:border-l lg:p-3">
            <CameraAnalysis />

            {/* Behavior State Breakdown Widget */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4 elevation-1">
              <div className="flex items-center justify-between pb-2.5 border-b border-[var(--border-subtle)]">
                <span className="flex items-center gap-2">
                  <span className="label-section text-[11px] tracking-widest font-bold">Behavior Breakdown</span>
                  <SampleBadge />
                </span>
                <time
                  dateTime={now?.toISOString()}
                  title={`Local time. Day is 5:00 AM to 4:59 PM, night is the rest. It is ${nightModeActive ? "night" : "day"} now.`}
                  className="-my-2 rounded bg-[var(--surface-raised)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--text-secondary)]"
                >
                  {now
                    ? `${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${nightModeActive ? "Night" : "Day"}`
                    : "--:--:--"}
                </time>
              </div>

              <div className="mt-3.5 space-y-3 text-xs">
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-[var(--text-secondary)]">Active / Standing</span>
                    <span className="font-mono font-semibold tabular-nums text-[var(--text-primary)]">
                      {totalBirds - bBreakdown.Inactivity - bBreakdown.Huddling - bBreakdown.Sleeping}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[var(--surface-raised)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--status-green)] transition-all duration-300"
                      style={{
                        width: `${((totalBirds - bBreakdown.Inactivity - bBreakdown.Huddling - bBreakdown.Sleeping) / totalBirds) * 100}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-[var(--text-secondary)]">Inactivity Alert</span>
                    <span className="font-mono font-semibold tabular-nums text-[var(--status-red)]">
                      {bBreakdown.Inactivity}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[var(--surface-raised)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--status-red)] transition-all duration-300"
                      style={{
                        width: `${(bBreakdown.Inactivity / totalBirds) * 100}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-[var(--text-secondary)]">Huddling Cluster</span>
                    <span className="font-mono font-semibold tabular-nums text-[var(--status-amber)]">
                      {bBreakdown.Huddling}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[var(--surface-raised)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--status-amber)] transition-all duration-300"
                      style={{
                        width: `${(bBreakdown.Huddling / totalBirds) * 100}%`,
                      }}
                    />
                  </div>
                </div>

                {nightModeActive && (
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-[var(--text-secondary)]">Sleeping Cycle</span>
                      <span className="font-mono font-semibold tabular-nums text-[var(--status-blue)]">
                        {bBreakdown.Sleeping}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[var(--surface-raised)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--status-blue)] transition-all duration-300"
                        style={{
                          width: `${(bBreakdown.Sleeping / totalBirds) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Weight Category Distribution */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4 elevation-1">
              <span className="label-section text-[11px] tracking-widest font-bold flex items-center gap-2 pb-2.5 border-b border-[var(--border-subtle)]">
                Weight Classification <SampleBadge />
              </span>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[var(--surface-raised)] p-3">
                  <div className="text-[11px] font-semibold text-[var(--status-amber)]">Under</div>
                  <div className="mt-1 font-mono text-xl font-bold tabular-nums text-[var(--text-primary)]">
                    {wBreakdown.Underweight}
                  </div>
                  <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">&lt;1.2 kg</div>
                </div>

                <div className="rounded-lg bg-[var(--surface-raised)] p-3">
                  <div className="text-[11px] font-semibold text-[var(--brand)]">Optimal</div>
                  <div className="mt-1 font-mono text-xl font-bold tabular-nums text-[var(--text-primary)]">
                    {wBreakdown.Optimal}
                  </div>
                  <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">1.2-1.9 kg</div>
                </div>

                <div className="rounded-lg bg-[var(--surface-raised)] p-3">
                  <div className="text-[11px] font-semibold text-[var(--status-blue)]">Over</div>
                  <div className="mt-1 font-mono text-xl font-bold tabular-nums text-[var(--text-primary)]">
                    {wBreakdown.Overweight}
                  </div>
                  <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">&gt;1.9 kg</div>
                </div>
              </div>
            </div>

            {/* Quick Environment Telemetry */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4 elevation-1">
              <span className="label-section text-[11px] tracking-widest font-bold flex items-center gap-2 pb-2.5 border-b border-[var(--border-subtle)]">
                Pen Sensor Telemetry <SampleBadge />
              </span>

              <div className="mt-3 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)] text-xs">Temperature:</span>
                  <span className="font-mono font-medium tabular-nums text-[var(--text-primary)] text-xs">
                    29.1°C <span className="text-[11px] text-[var(--status-green)] font-semibold">(Nominal)</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)] text-xs">Humidity:</span>
                  <span className="font-mono font-medium tabular-nums text-[var(--text-primary)] text-xs">
                    63% <span className="text-[11px] text-[var(--status-green)] font-semibold">(Nominal)</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)] text-xs">Ammonia (NH3):</span>
                  <span className="font-mono font-medium tabular-nums text-[var(--text-primary)] text-xs">
                    9 ppm <span className="text-[11px] text-[var(--status-green)] font-semibold">(Clean)</span>
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
