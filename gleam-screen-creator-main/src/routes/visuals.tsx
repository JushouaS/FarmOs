import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { AppShell, useAppShell } from "@/components/farm/AppShell";
import { Menu } from "lucide-react";
import { CameraAnalysis, type DemoScanSource } from "@/components/farm/CameraAnalysis";
import { setDemoWanted } from "@/lib/demo";
import { CameraDetectionsOverlay } from "@/components/farm/CameraDetectionsOverlay";
import { PiCsvHistoryPanel } from "@/components/farm/PiCsvHistoryPanel";
import { KinectDepthView } from "@/components/farm/KinectDepthView";
import { MjpegCameraFeed } from "@/components/farm/MjpegCameraFeed";
import { DEFAULT_LIGHTING, clock12, isNightCycle, type LightingHours } from "@/lib/farm/lighting";
import { getOperationsOverview } from "@/lib/farm/repository";
import { freshReading, silentFor } from "@/lib/farm/pen-sensors";
import { fetchLiveBehavior, visionStreamUrl, type CameraScan as ScanResult, type KinectChickens, type LiveBehavior } from "@/lib/api-client";
import { HEAVY_RATIO, UNDERWEIGHT_RATIO, fmtW, rangeLabel, standardForToday, weightCategoryFor } from "@/lib/farm/weights";
import { pictureArea, watchMinutes, watchSummary } from "@/lib/farm/stillness";
import { localeTag, tr } from "@/lib/i18n";

export const Route = createFileRoute("/visuals")({
  head: () => ({ meta: [{ title: tr("Live Vision - Cerebroil") }] }),
  loader: () => getOperationsOverview(),
  component: VisualsDashboardPage,
});

type ViewLayout = "dual" | "dahua" | "kinect";

/** One live reading with how it stands against its limits. */
function PenValue({ text, status }: { text: string; status: string }) {
  const label =
    status === "critical" ? (
      <span className="text-xs font-semibold text-[var(--status-red)]">{tr("(Critical)")}</span>
    ) : status === "warning" ? (
      <span className="text-xs font-semibold text-[var(--status-amber)]">{tr("(Warning)")}</span>
    ) : (
      <span className="text-xs font-semibold text-[var(--status-green)]">{tr("(Nominal)")}</span>
    );
  return (
    <span className="font-mono font-medium tabular-nums text-[var(--text-primary)] text-xs">
      {text} {label}
    </span>
  );
}

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
        aria-label={tr("Open menu")}
        aria-controls="app-sidenav"
      >
        <Menu className="h-5 w-5" />
      </button>
    </>
  );
}

export function VisualsDashboardPage() {
  const overview = Route.useLoaderData() as any;
  // The breed standard for today, to sort the weighed birds into under, optimal and over.
  const standardG = standardForToday(overview) ?? 0;
  // The pen's real air from the DHT22, when it has reported in the last few minutes. The page asks again
  // every 30 seconds so the numbers keep up.
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => void router.invalidate(), 30_000);
    return () => window.clearInterval(timer);
  }, [router]);
  const penTemperature = freshReading(overview, "temperature");
  const penHumidity = freshReading(overview, "humidity");
  // A sensor that worked and then went quiet is "offline", not just "no reading": someone should look at its wires.
  const quietFor = (parameter: "temperature" | "humidity") => {
    const ms = silentFor(overview, parameter);
    if (ms === null) return null;
    const min = Math.round(ms / 60_000);
    if (min < 60) return tr("{n} min", { n: min });
    const hours = Math.round(min / 60);
    return hours < 48 ? tr("{n} h", { n: hours }) : tr("{n} days", { n: Math.round(hours / 24) });
  };
  const noReading = (parameter: "temperature" | "humidity") => {
    const ago = quietFor(parameter);
    return ago ? (
      <span className="font-mono text-xs text-[var(--status-amber)]">{tr("Sensor offline · last reading {ago} ago", { ago })}</span>
    ) : (
      <span className="font-mono text-xs text-[var(--text-tertiary)]">{tr("No reading")}</span>
    );
  };
  // When the day starts and the night starts comes from Settings.
  const lighting: LightingHours = overview?.lighting ?? DEFAULT_LIGHTING;
  const [layout, setLayout] = useState<ViewLayout>("dual");
  // A camera picture is one long connection. When the API restarts, the camera computer restarts or the network drops
  // for a moment, the browser leaves the picture frozen and never asks again. So every 10 seconds the page asks whether
  // the camera path works and, when it works again after being away, opens the pictures anew.
  const [streamKey, setStreamKey] = useState(0);
  // Set when the CCTV feed cannot reach the camera service at all; the panel then says so, with a Retry button.
  const [dahuaError, setDahuaError] = useState(false);
  // Demo video (thesis demo day): each panel loops a recording from public/demo/ instead of its live camera. A panel
  // whose file is missing keeps its live view. On by default whenever the files are there (demo day); turning it off
  // is remembered in this browser only.
  const [demoOn, setDemoOn] = useState(true);
  const [demoFiles, setDemoFiles] = useState<{ behavior: boolean; weight: boolean }>({ behavior: false, weight: false });
  useEffect(() => {
    try {
      setDemoOn(localStorage.getItem("cerebroil.demoVideo") !== "0");
    } catch {}
    const has = (url: string) =>
      fetch(url, { method: "HEAD", cache: "no-store" })
        .then((r) => r.ok && (r.headers.get("content-type") ?? "").startsWith("video/"))
        .catch(() => false);
    void Promise.all([has(DEMO_VIDEOS.behavior.src), has(DEMO_VIDEOS.weight.src)]).then(([behavior, weight]) =>
      setDemoFiles({ behavior, weight }),
    );
  }, []);
  const toggleDemo = () => {
    setDemoOn((on) => {
      setDemoWanted(!on);
      window.dispatchEvent(new Event("cerebroil-demo-changed"));
      return !on;
    });
  };
  const demoBehavior = demoOn && demoFiles.behavior;
  // Analyze data in demo mode: the camera computer's scan of the second the CAM-01 demo video is showing.
  const demoScanNow: DemoScanSource = async () => {
    const video = document.querySelector<HTMLVideoElement>('video[data-demo="behavior"]');
    const data = await loadDemoScans();
    if (!video || !data || !data.scans.length) return null;
    const i = Math.min(data.scans.length - 1, Math.max(0, Math.floor(video.currentTime) - data.first_second));
    const result = data.scans[i];
    return { result, at: new Date(result.recorded_at) };
  };
  const demoWeight = demoOn && demoFiles.weight;
  useEffect(() => {
    const healthUrl = visionStreamUrl("CAM-01").replace(/[/]visual[/]stream[/].*$/, "/visual/health");
    let away = false;
    const check = async () => {
      try {
        const res = await fetch(healthUrl, { cache: "no-store", credentials: "include" });
        if (res.status === 401) return;                       // not signed in: nothing to learn
        if (!res.ok) throw new Error("camera path is down");
        if (away) {
          away = false;
          setDahuaError(false);
          setStreamKey((k) => k + 1);
        }
      } catch {
        away = true;
      }
    };
    const timer = window.setInterval(() => void check(), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  // The clock drives the day/night cycle: day is 05:00 to 16:59, and birds
  // count as sleeping the rest of the time (isNightCycle). Null until mounted so the server render and
  // the first client render match.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // While the behavior demo plays, the clock is the recording's: its start plus how far the video has played, so the
    // day/night label matches the picture instead of the time the demo is being shown.
    const tick = () => {
      const video = document.querySelector<HTMLVideoElement>('video[data-demo="behavior"]');
      setNow(video ? new Date(DEMO_BEHAVIOR_START + Math.floor(video.currentTime) * 1000) : new Date());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  const nightModeActive = now ? isNightCycle(now, lighting) : false;

  // What the page shows comes from real sources only: the Kinect weights, the live behavior monitor and the DHT22.
  const [flock, setFlock] = useState<KinectChickens | null>(null);
  const [liveBehavior, setLiveBehavior] = useState<LiveBehavior | null>(null);
  useEffect(() => {
    let stop = false;
    const ask = async () => {
      const answer = await fetchLiveBehavior(nightModeActive);
      if (!stop) setLiveBehavior(answer);
    };
    void ask();
    const timer = window.setInterval(() => void ask(), 10_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [nightModeActive]);

  // Set after mount so the server render never tries to open a camera connection.
  const [feedOrigin, setFeedOrigin] = useState<string | null>(null);
  useEffect(() => {
    setFeedOrigin(window.location.origin);
  }, []);

  // The camera service's address, only for the "not answering" message. VITE_VISION_ORIGIN names the Pi (e.g.
  // http://192.168.1.20:5000); on a public https address the visitor is not on the farm's network, so the message
  // names the address they are using, never the camera computer's private one.
  const feedHost = !feedOrigin
    ? "port 5000"
    : feedOrigin.startsWith("https:")
      ? feedOrigin.replace(/^https?:\/\//, "")
      : ((import.meta.env.VITE_VISION_ORIGIN as string | undefined)?.trim().replace(/\/+$/, "") ||
          `${new URL(feedOrigin).hostname}:5000`).replace(/^https?:\/\//, "");

  const containerRef = useRef<HTMLDivElement>(null);

  // Birds the Kinect weighed in its newest picture, sorted into under, optimal and over the standard for the day.
  const weighed =
    standardG > 0 && flock?.ok && flock.birds && Date.now() / 1000 - (flock.at ?? 0) < 15 ? flock.birds.filter((b) => b.weightG != null) : [];
  const weightCounts = { Underweight: 0, Optimal: 0, Overweight: 0 };
  for (const b of weighed) weightCounts[weightCategoryFor(b.weightG as number, standardG)]++;
  const weighedAverage = flock?.weight?.meanG ?? (weighed.length ? Math.round(weighed.reduce((n, b) => n + (b.weightG as number), 0) / weighed.length) : 0);

  // What the live monitor sees: birds followed, birds that stayed still, and birds huddled.
  const monitor = liveBehavior?.running ? liveBehavior : null;
  const monitorBirds = monitor?.birds ?? 0;
  const monitorStill = monitor?.flock_inactive ? monitorBirds : (monitor?.inactive?.length ?? 0);
  const monitorHuddled = monitor?.huddle?.birds ?? 0;
  const monitorActive = Math.max(0, monitorBirds - monitorStill - monitorHuddled);
  // Early warnings before the inactivity alert: birds still for 5 and 15 minutes (none at night: they rest).
  const watch = watchSummary(monitor);
  const [watchFirst, watchSecond] = watchMinutes(monitor);

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
                {tr("Live Camera Feeds")}
              </h1>
            </div>

            <div className="hidden h-4 w-px bg-[var(--border-default)] xl:block" />

            {/* Farm & Pen Info Tag */}
            <div className="hidden items-center gap-1.5 text-xs text-[var(--text-secondary)] xl:flex">
              <span className="rounded bg-[var(--surface-raised)] px-2 py-0.5 font-medium">
                {overview?.cluster?.houseLabel ?? ""}
              </span>
              <span className="text-[var(--text-tertiary)]">/</span>
              <span>{overview?.facility?.name ?? ""}</span>
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
                aria-label={tr("Dual camera split layout")}
              >
                <span className="sm:hidden">{tr("Split")}</span>
                <span className="hidden sm:inline">{tr("Split (Dual)")}</span>
              </button>
              <button
                type="button"
                onClick={() => setLayout("dahua")}
                aria-pressed={layout === "dahua"}
                className={`tactile-btn tap flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:flex-none ${layout === "dahua"
                    ? "bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                aria-label={tr("Dahua overhead view only")}
              >
                <span className="sm:hidden">{tr("Dahua")}</span>
                <span className="hidden sm:inline">{tr("Dahua CCTV")}</span>
              </button>
              <button
                type="button"
                onClick={() => setLayout("kinect")}
                aria-pressed={layout === "kinect"}
                className={`tactile-btn tap flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:flex-none ${layout === "kinect"
                    ? "bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                aria-label={tr("Kinect 3D depth view only")}
              >
                <span className="sm:hidden">{tr("Kinect")}</span>
                <span className="hidden sm:inline">{tr("Kinect 3D")}</span>
              </button>
            </div>

            {/* Demo video: loops the recordings in public/demo/ in place of the live cameras */}
            {(demoFiles.behavior || demoFiles.weight) && (
              <button
                type="button"
                onClick={toggleDemo}
                aria-pressed={demoOn}
                className={`tactile-btn tap flex h-8 shrink-0 items-center rounded-lg border px-2.5 text-xs font-medium ${demoOn
                    ? "border-[var(--brand)] bg-[var(--surface-raised)] text-[var(--text-primary)]"
                    : "border-[var(--border-default)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                title={demoOn ? tr("Back to the live cameras") : tr("Play the recorded demo videos")}
              >
                {demoOn ? tr("Demo video: on") : tr("Demo video")}
              </button>
            )}

            {/* Fullscreen Trigger Button */}
            <button
              type="button"
              onClick={handleFullscreenToggle}
              className="tactile-btn tap flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              title={tr("Toggle Fullscreen")}
              aria-label={tr("Toggle Fullscreen")}
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
                        {tr("CAM-01 : BROILERS BEHAVIOR")}
                      </span>
                    </div>
                  </div>

                  {/* Video Viewport Container — 16:9 box when the page scrolls,
                      fills the available height in the lg workspace */}
                  <div className="relative flex aspect-video min-h-60 items-center justify-center overflow-hidden bg-black lg:aspect-auto lg:min-h-0 lg:flex-1">
                    {demoBehavior ? (
                      <DemoClip video={DEMO_VIDEOS.behavior} name="behavior" />
                    ) : !dahuaError ? (
                      <>
                        {feedOrigin && (
                          <MjpegCameraFeed
                            key={`dahua-${streamKey}`}
                            src={`${visionStreamUrl("CAM-01")}?k=${streamKey}`}
                            alt={tr("Live camera feed of the broilers' behavior")}
                            className="h-full w-full object-contain"
                            onUnreachable={() => setDahuaError(true)}
                          />
                        )}
                        <CameraDetectionsOverlay cameraId="CAM-01" />
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center px-6 pt-4 pb-12 text-center">
                        <div className="mb-2 rounded-full bg-[var(--status-amber-bg)] p-3 text-[var(--status-amber-text)]">
                          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                          </svg>
                        </div>
                        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                          {tr("Vision service not reachable")}
                        </h2>
                        <p className="mt-1 max-w-xs text-xs text-[var(--text-secondary)]">{tr("Nothing is answering at {feedHost}. Start cerebroil-stream, then retry.", { feedHost })}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setDahuaError(false);
                            setStreamKey((k) => k + 1);
                          }}
                          className="tactile-btn tap mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--brand)]"
                        >
                          {tr("Retry Connection")}
                        </button>
                      </div>
                    )}
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
                        {tr("CAM-02 : WEIGHING STATION")}
                      </span>
                    </div>
                  </div>

                  {/* Video Viewport Container — 16:9 box when the page scrolls,
                      fills the available height in the lg workspace */}
                  <div className="relative flex aspect-video min-h-60 items-center justify-center overflow-hidden bg-black lg:aspect-auto lg:min-h-0 lg:flex-1">
                    {/* While the bridge is not running the view keeps asking for it, so this needs no button. It never
                        shows a stand-in picture: the camera service's simulated depth image is not the weighing station. */}
                    {demoWeight ? (
                      <DemoClip video={DEMO_VIDEOS.weight} name="weight" />
                    ) : (
                    <KinectDepthView onFlock={setFlock} fallback={
                      <div className="flex flex-col items-center justify-center px-6 pt-4 pb-12 text-center">
                        <div className="mb-2 rounded-full bg-[var(--status-blue-bg)] p-3 text-[var(--status-blue-text)]">
                          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <polygon points="12 2 2 7 12 12 22 7 12 2" />
                            <polyline points="2 17 12 22 22 17" />
                            <polyline points="2 12 12 17 22 12" />
                          </svg>
                        </div>
                        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{tr("Kinect is not connected")}</h2>
                        <p className="mt-1 max-w-xs text-xs text-[var(--text-secondary)]">
                          {tr("The Kinect picture and the bird weights appear when the Kinect bridge is running on the computer it is plugged into. This page keeps trying.")}
                        </p>
                      </div>
                    } />
                    )}
                  </div>
                </div>
              )}
            </div>
          </main>

          {/* Right Inspector & Analytics Drawer Panel */}
          {/* Stacks under the feeds below lg (2-up on tablets), docks right from lg */}
          <aside className="grid gap-3 border-t border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 sm:grid-cols-2 sm:p-4 lg:flex lg:w-72 lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:border-t-0 lg:border-l lg:p-3">
            <CameraAnalysis lighting={lighting} demoScan={demoBehavior ? demoScanNow : undefined} />

            {/* What the live monitor on the camera computer sees. It is off until LIVE_BEHAVIOR=1 is set there. */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4 elevation-1">
              <div className="flex items-center justify-between pb-2.5 border-b border-[var(--border-subtle)]">
                <span className="label-section text-xs tracking-widest font-bold">{tr("Behavior Breakdown")}</span>
                <time
                  dateTime={now?.toISOString()}
                  title={tr("Local time. Day runs from {value} until {value2}, night is the rest. It is {value3} now.", { value: clock12(lighting.dayStart), value2: clock12(lighting.nightStart), value3: nightModeActive ? tr("night") : tr("day") })}
                  className="-my-2 rounded bg-[var(--surface-raised)] px-1.5 py-0.5 font-mono text-xs tabular-nums text-[var(--text-secondary)]"
                >
                  {now
                    ? `${now.toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${nightModeActive ? tr("Night") : tr("Day")}`
                    : "--:--:--"}
                </time>
              </div>

              {monitor ? (
                <div className="mt-3.5 space-y-3 text-xs">
                  {[
                    { label: tr("Active / Standing"), n: monitorActive, text: "text-[var(--text-primary)]", bar: "bg-[var(--status-green)]" },
                    { label: tr("Inactivity Alert"), n: monitorStill, text: "text-[var(--status-red)]", bar: "bg-[var(--status-red)]" },
                    { label: tr("Huddling Cluster"), n: monitorHuddled, text: "text-[var(--status-amber)]", bar: "bg-[var(--status-amber)]" },
                  ].map((row) => (
                    <div key={row.label}>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-[var(--text-secondary)]">{row.label}</span>
                        <span className={`font-mono font-semibold tabular-nums ${row.text}`}>{row.n}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[var(--surface-raised)] overflow-hidden">
                        <div
                          className={`h-full ${row.bar} transition-all duration-300`}
                          style={{ width: `${monitorBirds ? (row.n / monitorBirds) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {watch && (
                    <section aria-label={tr("Still for a while")} className="border-t border-[var(--border-subtle)] pt-3">
                      <p className="mb-2 font-semibold text-[var(--text-primary)]">{tr("Still for a while")}</p>
                      {monitor?.night || nightModeActive ? (
                        <p className="text-[var(--text-tertiary)]">{tr("Night: still birds are resting, so none is on this list.")}</p>
                      ) : (
                        <>
                          <div className="flex justify-between">
                            <span className="text-[var(--text-secondary)]">{tr("Still {n}+ min", { n: watchSecond })}</span>
                            <span className="font-mono font-semibold tabular-nums text-[var(--status-amber-text)]">{watch.orange.length}</span>
                          </div>
                          {watch.orange.length > 0 && (
                            <ul className="mt-1 space-y-0.5 text-[var(--text-secondary)]">
                              {watch.orange.slice(0, 4).map((w) => (
                                <li key={w.id}>
                                  {tr("{place} of the picture, {m} min", { place: tr(pictureArea(w.at)), m: Math.floor(w.still_seconds / 60) })}
                                </li>
                              ))}
                              {watch.orange.length > 4 && <li>{tr("and {n} more", { n: watch.orange.length - 4 })}</li>}
                            </ul>
                          )}
                          <div className="mt-2 flex justify-between">
                            <span className="text-[var(--text-secondary)]">{tr("Still {n}+ min", { n: watchFirst })}</span>
                            <span className="font-mono font-semibold tabular-nums text-[var(--text-primary)]">{watch.all.length}</span>
                          </div>
                          <p className="mt-2 leading-relaxed text-[var(--text-tertiary)]">
                            {tr("Not an alert yet. A bird still for 30 minutes raises an Inactivity Alert.")}
                          </p>
                        </>
                      )}
                    </section>
                  )}
                  <p className="text-xs text-[var(--text-tertiary)]">{tr("{n} birds followed by the live monitor.", { n: monitorBirds })}</p>
                </div>
              ) : (
                <p className="mt-3.5 text-xs leading-relaxed text-[var(--text-tertiary)]">
                  {tr("Behavior monitoring is off. Turn it on at the camera computer (LIVE_BEHAVIOR=1) to see this.")}
                </p>
              )}
            </div>

            {/* The birds the Kinect weighed in its newest picture, against the standard weight for the day. */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4 elevation-1">
              <span className="label-section text-xs tracking-widest font-bold flex items-center gap-2 pb-2.5 border-b border-[var(--border-subtle)]">
                {tr("Weight Classification")}
              </span>

              {weighed.length > 0 ? (
                <>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-[var(--surface-raised)] p-3">
                      <div className="text-xs font-semibold text-[var(--status-amber)]">{tr("Under")}</div>
                      <div className="mt-1 font-mono text-xl font-bold tabular-nums text-[var(--text-primary)]">{weightCounts.Underweight}</div>
                      <div className="text-xs text-[var(--text-tertiary)] mt-0.5">&lt;{fmtW(standardG * UNDERWEIGHT_RATIO)}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-raised)] p-3">
                      <div className="text-xs font-semibold text-[var(--brand)]">{tr("Optimal")}</div>
                      <div className="mt-1 font-mono text-xl font-bold tabular-nums text-[var(--text-primary)]">{weightCounts.Optimal}</div>
                      <div className="text-xs text-[var(--text-tertiary)] mt-0.5">{rangeLabel(standardG * UNDERWEIGHT_RATIO, standardG * HEAVY_RATIO)}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--surface-raised)] p-3">
                      <div className="text-xs font-semibold text-[var(--status-blue)]">{tr("Over")}</div>
                      <div className="mt-1 font-mono text-xl font-bold tabular-nums text-[var(--text-primary)]">{weightCounts.Overweight}</div>
                      <div className="text-xs text-[var(--text-tertiary)] mt-0.5">&gt;{fmtW(standardG * HEAVY_RATIO)}</div>
                    </div>
                  </div>
                  <p className="mt-2.5 text-xs text-[var(--text-secondary)]">
                    {tr("{n} birds weighed from the Kinect picture. Average {avg} g.", { n: weighed.length, avg: weighedAverage })}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                    {flock?.weight?.errorPercent != null
                      ? tr("Rough estimate: one bird can be off by about {pct}%", { pct: flock.weight.errorPercent })
                      : tr("Experimental estimate; verify against a scale.")}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-xs leading-relaxed text-[var(--text-tertiary)]">
                  {tr("No weights yet. They appear when the Kinect picture is open and chickens are in view.")}
                </p>
              )}
            </div>

            {/* The pen's air, from the DHT22 on the camera computer. With no recent reading it says so, never a made-up number. */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4 elevation-1">
              <span className="label-section text-xs tracking-widest font-bold flex items-center gap-2 pb-2.5 border-b border-[var(--border-subtle)]">
                {tr("Pen Sensor Telemetry")}
              </span>

              <div className="mt-3 space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-secondary)] text-xs">{tr("Temperature:")}</span>
                  {penTemperature ? (
                    <PenValue text={`${penTemperature.value.toFixed(1)}°C`} status={penTemperature.status} />
                  ) : (
                    noReading("temperature")
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-secondary)] text-xs">{tr("Humidity:")}</span>
                  {penHumidity ? (
                    <PenValue text={`${Math.round(penHumidity.value)}%`} status={penHumidity.status} />
                  ) : (
                    noReading("humidity")
                  )}
                </div>
              </div>
            </div>

            <PiCsvHistoryPanel />
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

/* ── Demo video (thesis demo day) ────────────────────────────────────────────────────────────────
 * Recordings shown in place of the live cameras. The behavior clip is the system's own output on a real pen
 * recording (packages/vision/tools/make_demo_video.py): every box, bird number, huddle and inactive bird was
 * drawn by the tracker, not by hand. The files are not in git; put them in public/demo/. */
// The Analyze data scans for the behavior clip, one per second (cerebroil-stream/make_scan_demo.py).
let demoScans: Promise<{ first_second: number; scans: (ScanResult & { recorded_at: string })[] } | null> | null = null;
function loadDemoScans() {
  demoScans ??= fetch("/demo/behavior_scans.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return demoScans;
}

/** When the behavior demo clip starts: 12 Nov 2026, 11:30 farm time. */
const DEMO_BEHAVIOR_START = Date.parse("2026-11-12T11:30:00+08:00");

const DEMO_VIDEOS = {
  behavior: { src: "/demo/behavior.mp4", label: "Recorded demo · 12 Nov 2026, 11:30 to 11:45 · real speed" },
  weight: { src: "/demo/weight.mp4", label: "Recorded demo · Kinect clips, 11 to 16 Nov 2026 · half speed · weights are size estimates" },
} as const;

function DemoClip({ video, name }: { video: { src: string; label: string }; name: string }) {
  return (
    <>
      <video
        src={video.src}
        data-demo={name}
        className="h-full w-full object-contain"
        autoPlay
        muted
        loop
        playsInline
        controls={false}
        aria-label={tr(video.label)}
      />
      <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/70 px-2 py-1 text-[11px] font-medium text-white">
        {tr(video.label)}
      </span>
    </>
  );
}
