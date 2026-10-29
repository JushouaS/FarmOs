import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { AppShell, useAppShell } from "@/components/farm/AppShell";
import { Menu, PanelLeft } from "lucide-react";
import {
  farm,
  broilers,
  kinectDetections,
  modelTelemetry,
  behaviorBreakdown,
  weightBreakdown,
  effectiveBehavior,
  weightCategory,
  BEHAVIOR_COLOR,
  type BroilerBird,
  type KinectDetection,
} from "@/lib/farm/dataset";

export const Route = createFileRoute("/visuals")({
  head: () => ({ meta: [{ title: "Live Vision - Cerebroil" }] }),
  component: VisualsDashboardPage,
});

type ViewLayout = "dual" | "dahua" | "kinect";

export function VisualsDashboardPage() {
  const shell = useAppShell();
  const [layout, setLayout] = useState<ViewLayout>("dual");
  const [showOverlays, setShowOverlays] = useState(true);
  const [selectedBird, setSelectedBird] = useState<BroilerBird | null>(null);
  const [selectedKinect, setSelectedKinect] = useState<KinectDetection | null>(null);
  const [dahuaError, setDahuaError] = useState(false);
  const [kinectError, setKinectError] = useState(false);
  const [nightModeActive, setNightModeActive] = useState(false);
  const [flashNotice, setFlashNotice] = useState<string | null>(null);

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
  const inspectorRef = useRef<HTMLDivElement>(null);

  // Below lg the inspector sits under the feeds, out of view; bring it up
  // after a tap so the selection visibly does something.
  const revealInspector = () => {
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() =>
        inspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      );
    }
  };

  const bBreakdown = behaviorBreakdown(nightModeActive);
  const wBreakdown = weightBreakdown();
  const totalBirds = broilers.length;

  const handleSnapshot = () => {
    const time = new Date().toLocaleTimeString();
    setFlashNotice(`Frame snapshot captured at ${time}`);
    setTimeout(() => setFlashNotice(null), 3200);
  };

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
            {/* Mobile hamburger */}
            <button
              type="button"
              onClick={() => shell?.openMobileMenu()}
              className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-raised)] lg:hidden"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            {/* Desktop sidebar toggle */}
            <button
              type="button"
              onClick={() => shell?.toggleCollapsed()}
              className="hidden lg:flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-raised)]"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Toggle sidebar"
            >
              <PanelLeft className="h-5 w-5" />
            </button>
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

          {/* Controls: View Layout Switcher, Overlays, Actions */}
          {/* Full-width second row on phones; inline from sm */}
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {/* Notification Toast — floats above the bottom nav on phones */}
            {flashNotice && (
              <div
                role="status"
                className="animate-spring-in fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-center rounded-lg border border-[var(--status-green-border)] bg-[var(--status-green-bg)] px-3 py-2 text-xs font-medium text-[var(--status-green-text)] shadow-lg md:static md:inset-auto md:z-auto md:px-2.5 md:py-1 md:shadow-none"
              >
                {flashNotice}
              </div>
            )}

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

            {/* Toggle Overlay Button — icon-only on phones */}
            <button
              type="button"
              onClick={() => setShowOverlays(!showOverlays)}
              aria-pressed={showOverlays}
              aria-label="Toggle detection overlays"
              className={`tactile-btn tap flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${showOverlays
                  ? "border-[var(--brand)] bg-[var(--brand-muted)] text-[var(--brand)]"
                  : "border-[var(--border-default)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              title="Toggle AI Bounding Box Overlays"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 9h6v6H9z" />
              </svg>
              <span className="hidden md:inline">Detections</span>
            </button>

            {/* Snapshot Trigger Button */}
            <button
              type="button"
              onClick={handleSnapshot}
              aria-label="Capture snapshot"
              className="tactile-btn tap flex shrink-0 items-center justify-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
              title="Capture instantaneous frame"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span className="hidden md:inline">Snapshot</span>
            </button>

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
                        CAM-01 : OVERHEAD CAMERA
                      </span>
                      <span className="hidden shrink-0 rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-tertiary)] sm:inline">
                        1280x720 @ 25fps
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
                          alt="Dahua Overhead CCTV live camera feed"
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
                      <span className="hidden shrink-0 rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-tertiary)] sm:inline">
                        Depth Station
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
                    {showOverlays && !kinectError && (
                      <div className="pointer-events-none absolute inset-0">
                        {kinectDetections.map((kd) => {
                          const isTargetSelected = selectedKinect?.id === kd.id;
                          return (
                            <div
                              key={kd.id}
                              style={{
                                left: `${kd.x}%`,
                                top: `${kd.y}%`,
                                width: `${kd.w}%`,
                                height: `${kd.h}%`,
                              }}
                              className={`pointer-events-auto absolute cursor-pointer rounded border border-dashed transition-all ${isTargetSelected
                                  ? "border-2 border-[var(--brand)] bg-[rgba(52,211,153,0.2)] shadow-[0_0_10px_var(--brand)]"
                                  : "border-[var(--brand)] bg-[rgba(52,211,153,0.06)] hover:bg-[rgba(52,211,153,0.14)]"
                                }`}
                              onClick={() => {
                                setSelectedKinect(kd);
                                setSelectedBird(null);
                                revealInspector();
                              }}
                            >
                              <div className="absolute -top-5 left-0 flex items-center gap-1 rounded bg-black/85 px-1.5 py-0.5 text-[9px] font-mono text-[var(--brand)]">
                                <span>{kd.id}</span>
                                <span className="text-[var(--text-primary)] tabular-nums">{kd.weightG}g</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Weight Telemetry HUD (Bottom Left) */}
                    <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2">
                      <div className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-black/75 px-2.5 py-1 text-xs backdrop-blur-sm elevation-1">
                        <span className="font-mono text-[10px] text-[var(--text-tertiary)]">AVG WEIGHT</span>
                        <span className="font-mono font-bold text-[var(--brand)] tabular-nums">
                          {farm.weight.actualAvgG} g
                        </span>
                        <span className="text-[var(--border-strong)]">|</span>
                        <span className="font-mono text-[10px] text-[var(--text-tertiary)]">TARGET</span>
                        <span className="font-mono font-semibold text-[var(--text-secondary)] tabular-nums">
                          {farm.weight.standardG} g
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </main>

          {/* Right Inspector & Analytics Drawer Panel */}
          {/* Stacks under the feeds below lg (2-up on tablets), docks right from lg */}
          <aside className="grid gap-3 border-t border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 sm:grid-cols-2 sm:p-4 lg:flex lg:w-72 lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:border-t-0 lg:border-l lg:p-3">
            {/* Selected Target Inspection Box */}
            <div ref={inspectorRef} className="scroll-mt-4 scroll-mb-20 rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4 elevation-1">
              <div className="flex items-center justify-between pb-2.5 border-b border-[var(--border-subtle)]">
                <span className="label-section text-[11px] tracking-widest font-bold">
                  {selectedBird ? "Bird Inspector" : selectedKinect ? "Depth Target" : "Target Selection"}
                </span>
                {(selectedBird || selectedKinect) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedBird(null);
                      setSelectedKinect(null);
                    }}
                    className="tactile-btn tap -my-2 px-1 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                  >
                    Clear
                  </button>
                )}
              </div>

              {selectedBird ? (
                <div className="mt-2.5 space-y-2 animate-spring-in">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-[var(--text-primary)]">
                      {selectedBird.id}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{
                        backgroundColor: `${BEHAVIOR_COLOR[effectiveBehavior(selectedBird, nightModeActive)]}20`,
                        color: BEHAVIOR_COLOR[effectiveBehavior(selectedBird, nightModeActive)],
                        border: `1px solid ${BEHAVIOR_COLOR[effectiveBehavior(selectedBird, nightModeActive)]}40`,
                      }}
                    >
                      {effectiveBehavior(selectedBird, nightModeActive)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-[var(--surface-raised)] p-2">
                      <div className="text-[10px] text-[var(--text-tertiary)]">EST. WEIGHT</div>
                      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--brand)]">
                        {selectedBird.weightG} g
                      </div>
                      <div className="text-[10px] text-[var(--text-tertiary)]">
                        {weightCategory(selectedBird.weightG)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-raised)] p-2">
                      <div className="text-[10px] text-[var(--text-tertiary)]">DETECTION CONF</div>
                      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--cv-accent)]">
                        {(selectedBird.yoloConfidence * 100).toFixed(0)}%
                      </div>
                      <div className="text-[10px] text-[var(--text-tertiary)]">
                        Weight: {(selectedBird.weightConfidence * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>

                  {/* Morphometrics Detail */}
                  <div className="rounded-lg bg-[var(--surface-raised)] p-2 text-xs space-y-1">
                    <div className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                      Bird Dimensions
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-secondary)]">Breast Width:</span>
                      <span className="font-mono tabular-nums text-[var(--text-primary)]">
                        {selectedBird.breastWidthMm} mm
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-secondary)]">Total Length:</span>
                      <span className="font-mono tabular-nums text-[var(--text-primary)]">
                        {selectedBird.totalLengthMm} mm
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-secondary)]">Height / Depth:</span>
                      <span className="font-mono tabular-nums text-[var(--text-primary)]">
                        {selectedBird.depthZMm} mm
                      </span>
                    </div>
                  </div>
                </div>
              ) : selectedKinect ? (
                <div className="mt-2.5 space-y-2 animate-spring-in">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-[var(--brand)]">
                      {selectedKinect.id}
                    </span>
                    <span className="badge-cv">SCALE ZONE</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-[var(--surface-raised)] p-2">
                      <div className="text-[10px] text-[var(--text-tertiary)]">ESTIMATED WEIGHT</div>
                      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--brand)]">
                        {selectedKinect.weightG} g
                      </div>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-raised)] p-2">
                      <div className="text-[10px] text-[var(--text-tertiary)]">DISTANCE / DEPTH</div>
                      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                        {selectedKinect.depthMm} mm
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-6 flex flex-col items-center gap-2 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-raised)] text-[var(--text-tertiary)]">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" /></svg>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] leading-relaxed max-w-[180px]">
                    Tap or click any detection box on either stream to inspect bird telemetry.
                  </p>
                </div>
              )}
            </div>

            {/* Behavior State Breakdown Widget */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4 elevation-1">
              <div className="flex items-center justify-between pb-2.5 border-b border-[var(--border-subtle)]">
                <span className="label-section text-[11px] tracking-widest font-bold">Behavior Breakdown</span>
                <button
                  type="button"
                  onClick={() => setNightModeActive(!nightModeActive)}
                  aria-pressed={nightModeActive}
                  className={`tactile-btn tap -my-2 rounded px-1.5 py-0.5 text-[10px] font-mono ${nightModeActive
                      ? "bg-[var(--status-blue-bg)] text-[var(--status-blue-text)] border border-[var(--status-blue-border)]"
                      : "bg-[var(--surface-raised)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                    }`}
                  title="Toggle 21:00-03:59 night cycle override simulation"
                >
                  Night: {nightModeActive ? "ON" : "OFF"}
                </button>
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
              <span className="label-section text-[11px] tracking-widest font-bold block pb-2.5 border-b border-[var(--border-subtle)]">
                Weight Classification
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
              <span className="label-section text-[11px] tracking-widest font-bold block pb-2.5 border-b border-[var(--border-subtle)]">
                Pen Sensor Telemetry
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
