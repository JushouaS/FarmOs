import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
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
  DAHUA_FEED_STREAM,
  KINECT_FEED_STREAM,
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
  const [showConfidence] = useState(true);
  const [selectedBird, setSelectedBird] = useState<BroilerBird | null>(null);
  const [selectedKinect, setSelectedKinect] = useState<KinectDetection | null>(null);
  const [dahuaError, setDahuaError] = useState(false);
  const [kinectError, setKinectError] = useState(false);
  const [nightModeActive, setNightModeActive] = useState(false);
  const [flashNotice, setFlashNotice] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

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
      <div
        ref={containerRef}
        className="flex h-[calc(100vh-56px)] flex-col bg-[var(--surface-page)] text-[var(--text-primary)]"
      >
        {/* Top Control Bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 elevation-1">
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <button
              type="button"
              onClick={() => shell?.openMobileMenu()}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-raised)] lg:hidden"
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
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--cv-accent)] opacity-75"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--cv-accent)]"></span>
              </span>
              <h1 className="font-display text-sm font-semibold tracking-tight text-[var(--text-primary)] text-balance">
                Live Camera Feeds
              </h1>
            </div>

            <div className="hidden h-4 w-px bg-[var(--border-default)] sm:block" />

            {/* Farm & Pen Info Tag */}
            <div className="hidden items-center gap-1.5 text-xs text-[var(--text-secondary)] sm:flex">
              <span className="rounded bg-[var(--surface-raised)] px-2 py-0.5 font-medium">
                {farm.facility.houses[0].label}
              </span>
              <span className="text-[var(--text-tertiary)]">/</span>
              <span>{farm.facility.name}</span>
            </div>
          </div>

          {/* Controls: View Layout Switcher, Overlays, Actions */}
          <div className="flex items-center gap-2">
            {/* Notification Toast */}
            {flashNotice && (
              <div className="animate-spring-in hidden items-center rounded-lg border border-[var(--status-green-border)] bg-[var(--status-green-bg)] px-2.5 py-1 text-xs font-medium text-[var(--status-green-text)] md:flex">
                {flashNotice}
              </div>
            )}

            {/* Layout Mode Selector (Concentric: outer rounded-lg p-0.5, inner rounded-md) */}
            <div className="flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-0.5">
              <button
                type="button"
                onClick={() => setLayout("dual")}
                className={`tactile-btn rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${layout === "dual"
                    ? "bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                aria-label="Dual camera split layout"
              >
                Split (Dual)
              </button>
              <button
                type="button"
                onClick={() => setLayout("dahua")}
                className={`tactile-btn rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${layout === "dahua"
                    ? "bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                aria-label="Dahua overhead view only"
              >
                Dahua CCTV
              </button>
              <button
                type="button"
                onClick={() => setLayout("kinect")}
                className={`tactile-btn rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${layout === "kinect"
                    ? "bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                aria-label="Kinect 3D depth view only"
              >
                Kinect 3D
              </button>
            </div>

            {/* Toggle Overlay Button */}
            <button
              type="button"
              onClick={() => setShowOverlays(!showOverlays)}
              className={`tactile-btn hidden items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium md:flex ${showOverlays
                  ? "border-[var(--brand)] bg-[var(--brand-muted)] text-[var(--brand)]"
                  : "border-[var(--border-default)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              title="Toggle AI Bounding Box Overlays"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 9h6v6H9z" />
              </svg>
              <span>Detections</span>
            </button>

            {/* Snapshot Trigger Button */}
            <button
              type="button"
              onClick={handleSnapshot}
              className="tactile-btn flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
              title="Capture instantaneous frame"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span className="hidden sm:inline">Snapshot</span>
            </button>

            {/* Fullscreen Trigger Button */}
            <button
              type="button"
              onClick={handleFullscreenToggle}
              className="tactile-btn flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
        <div className="flex flex-1 overflow-hidden">
          {/* Video Feeds Grid */}
          <main className="flex-1 overflow-y-auto p-3 lg:p-4">
            <div
              className={`grid h-full gap-3 lg:gap-4 ${layout === "dual"
                  ? "grid-cols-1 xl:grid-cols-2"
                  : "grid-cols-1"
                }`}
            >
              {/* Feed 1: Dahua Overhead CCTV (YOLOv8 Detection) */}
              {(layout === "dual" || layout === "dahua") && (
                <div className="relative flex flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] elevation-2">
                  {/* Viewport Header */}
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[var(--cv-accent)]" />
                      <span className="font-mono text-xs font-semibold tracking-wider text-[var(--text-primary)]">
                        CAM-01 : OVERHEAD CAMERA
                      </span>
                      <span className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-tertiary)]">
                        1280x720 @ 25fps
                      </span>
                    </div>
                  </div>

                  {/* Video Viewport Container */}
                  <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
                    {!dahuaError ? (
                      <img
                        src={DAHUA_FEED_STREAM}
                        alt="Dahua Overhead CCTV live camera feed"
                        className="h-full w-full object-contain"
                        onError={() => setDahuaError(true)}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center p-6 text-center">
                        <div className="mb-2 rounded-full bg-[var(--status-amber-bg)] p-3 text-[var(--status-amber-text)]">
                          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                          </svg>
                        </div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                          Local Stream Standby
                        </h3>
                        <p className="mt-1 max-w-xs text-xs text-[var(--text-secondary)]">
                          Vision service at localhost:5000 is waiting for client stream connection.
                        </p>
                        <button
                          type="button"
                          onClick={() => setDahuaError(false)}
                          className="tactile-btn mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--brand)]"
                        >
                          Retry Connection
                        </button>
                      </div>
                    )}

                    {/* AI Bounding Box Overlays (SVG Composited Layer) */}
                    {showOverlays && !dahuaError && (
                      <div className="pointer-events-none absolute inset-0">
                        {farm.detections.map((det) => {
                          const bird = broilers.find((b) => b.id.replace("B-", "D") === det.id);
                          const isHuddling = det.behavior === "HUDDLING";
                          const isSelected = selectedBird?.id === bird?.id;

                          return (
                            <div
                              key={det.id}
                              style={{
                                left: `${(det.box.x / 640) * 100}%`,
                                top: `${(det.box.y / 360) * 100}%`,
                                width: `${(det.box.width / 640) * 100}%`,
                                height: `${(det.box.height / 360) * 100}%`,
                              }}
                              className={`pointer-events-auto absolute cursor-pointer rounded-sm border transition-all ${isSelected
                                  ? "border-2 border-[var(--cv-accent)] shadow-[0_0_12px_var(--cv-accent)]"
                                  : isHuddling
                                    ? "border border-[var(--status-amber)] bg-[rgba(251,191,36,0.12)]"
                                    : "border border-[var(--cv-accent)] bg-[rgba(163,230,53,0.08)]"
                                }`}
                              onClick={() => bird && setSelectedBird(bird)}
                            >
                              <div className="absolute -top-5 left-0 flex items-center gap-1 rounded bg-black/80 px-1 py-0.5 text-[9px] font-mono font-medium text-[var(--cv-accent-text)]">
                                <span>{det.id}</span>
                                {showConfidence && (
                                  <span className="text-[var(--text-tertiary)] tabular-nums">
                                    {(det.weightConfidence * 100).toFixed(0)}%
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Pen Environment Overlay (Bottom Left) */}
                    <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2">
                      <div className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-black/75 px-2.5 py-1 text-xs backdrop-blur-sm elevation-1">
                        <span className="text-[10px] text-[var(--text-tertiary)]">TEMP</span>
                        <span className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">
                          29.1°C
                        </span>
                        <span className="text-[var(--border-strong)]">|</span>
                        <span className="text-[10px] text-[var(--text-tertiary)]">RH</span>
                        <span className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">
                          63%
                        </span>
                      </div>
                    </div>

                    {/* Active Birds Scanned Count Badge (Bottom Right) */}
                    <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg border border-[var(--border-subtle)] bg-black/75 px-2.5 py-1 text-xs font-mono text-[var(--text-secondary)] backdrop-blur-sm">
                      <span className="text-[var(--cv-accent)] font-semibold tabular-nums">{totalBirds}</span> BIRDS MONITORED
                    </div>
                  </div>
                </div>
              )}

              {/* Feed 2: Microsoft Kinect 3D Depth Station */}
              {(layout === "dual" || layout === "kinect") && (
                <div className="relative flex flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] elevation-2">
                  {/* Viewport Header */}
                  <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[var(--brand)]" />
                      <span className="font-mono text-xs font-semibold tracking-wider text-[var(--text-primary)]">
                        CAM-02 : WEIGHING STATION
                      </span>
                      <span className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-tertiary)]">
                        Depth Station
                      </span>
                    </div>
                  </div>

                  {/* Video Viewport Container */}
                  <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
                    {!kinectError ? (
                      <img
                        src={KINECT_FEED_STREAM}
                        alt="Microsoft Kinect 3D depth sensor station feed"
                        className="h-full w-full object-contain"
                        onError={() => setKinectError(true)}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center p-6 text-center">
                        <div className="mb-2 rounded-full bg-[var(--status-blue-bg)] p-3 text-[var(--status-blue-text)]">
                          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="12 2 2 7 12 12 22 7 12 2" />
                            <polyline points="2 17 12 22 22 17" />
                            <polyline points="2 12 12 17 22 12" />
                          </svg>
                        </div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                          Depth Station Live Channel
                        </h3>
                        <p className="mt-1 max-w-xs text-xs text-[var(--text-secondary)]">
                          Kinect sensor stream is active at port 5000 for depth-to-weight estimation.
                        </p>
                        <button
                          type="button"
                          onClick={() => setKinectError(false)}
                          className="tactile-btn mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--brand)]"
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
                              onClick={() => setSelectedKinect(kd)}
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
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 flex flex-col gap-3">
            {/* Selected Target Inspection Box */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4 elevation-1">
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
                    className="tactile-btn text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
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
                    Click any detection bounding box on either stream to inspect bird telemetry.
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
                  className={`tactile-btn rounded px-1.5 py-0.5 text-[10px] font-mono ${nightModeActive
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
