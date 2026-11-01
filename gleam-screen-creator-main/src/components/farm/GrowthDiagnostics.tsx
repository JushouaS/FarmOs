import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Cpu,
  Info,
  OctagonAlert,
  RotateCcw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { HEAVY_RATIO, UNDERWEIGHT_RATIO, fmtW, rangeLabel, type SampleFlock } from "@/lib/farm/sample";
import { localeTag, tr } from "@/lib/i18n";

/* The diagnostics card (ready, then processing, then a report) and the growth report built on it.
 * Analytics and the dashboard's Analyze Growth button both show it, so it lives here. */

export type InsightLevel = "positive" | "warning" | "critical" | "info";

/** The breed's weight on the last day, carried by how far ahead or behind the flock is now. */
export function projectedHarvestG(sample: SampleFlock): number | null {
  const last = sample.farm.weight.curve.find((p) => p.day === sample.endDay)?.standardG;
  return last ? Math.round((last * sample.farm.weight.actualAvgG) / sample.standardG) : null;
}

/** What to do about feed on this day of the grow-out (usual stages: grower, then finisher, then withdrawal before catching). */
function feedAdvice(day: number, endDay: number): string {
  if (day >= endDay - 3)
    return tr("Harvest is close (Day {endDay}). Confirm the catching date and plan the pre-harvest feed withdrawal with the farm manager. Keep drinking water available.", { endDay });
  if (day >= 25)
    return tr("Finisher feed is in use at Day {day}. Feed conversion naturally rises with age, so keep checking it against the target and look for feed wastage.", { day });
  return tr("Grower feed is in use at Day {day}. Plan the switch to Finisher pellet feed around Day 25 and keep the feeders and drinkers adjusted to the birds' height.", { day });
}


/* ── Diagnostics card: ready → processing → report ───────────────
 * The same card for Weight Growth and Flock Conditions. The caller supplies
 * the words and the report body; this owns the button, the progress and the
 * three states. */
export function DiagnosticsCard({
  title,
  description,
  chips,
  buttonLabel,
  processingTitle,
  steps,
  reportTitle,
  evaluated,
  autoRun,
  children,
}: {
  title: string;
  description: string;
  chips: string[];
  buttonLabel: string;
  processingTitle: string;
  steps: string[];
  reportTitle: string;
  evaluated: string;
  /** Start the analysis as soon as the card appears, and bring the card into view. */
  autoRun?: boolean;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [analysisState, setAnalysisState] = useState<"idle" | "processing" | "ready">("idle");
  const [progress, setProgress] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [processedAt, setProcessedAt] = useState<string | null>(null);
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; done?: ReturnType<typeof setTimeout> }>({});

  // Stop the timers if the person leaves the tab mid-run.
  useEffect(
    () => () => {
      clearInterval(timers.current.tick);
      clearTimeout(timers.current.done);
    },
    [],
  );

  const handleRunAnalysis = () => {
    clearInterval(timers.current.tick);
    clearTimeout(timers.current.done);
    setAnalysisState("processing");
    setProgress(0);
    setStepIdx(0);

    timers.current.tick = setInterval(() => {
      setProgress((prev) => {
        const next = prev + 14;
        if (next >= 100) {
          clearInterval(timers.current.tick);
          timers.current.done = setTimeout(() => {
            setAnalysisState("ready");
            setProcessedAt(new Date().toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit" }));
          }, 250);
          return 100;
        }
        setStepIdx(Math.min(steps.length - 1, Math.floor((next / 100) * steps.length)));
        return next;
      });
    }, 130);
  };

  const showCard = () => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rootRef.current?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  };

  // Started from a button elsewhere (the dashboard's Analyze Growth): run the analysis once, as the card appears, and show it.
  useEffect(() => {
    if (!autoRun) return;
    handleRunAnalysis();
    const frame = requestAnimationFrame(showCard);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The report is taller than the progress card, so show its top again once it has opened.
  const showedReport = useRef(false);
  useEffect(() => {
    if (autoRun && analysisState === "ready" && !showedReport.current) {
      showedReport.current = true;
      showCard();
    }
  }, [autoRun, analysisState]);

  return (
    <div ref={rootRef} className="cb-card scroll-mt-20 p-5">
      {/* ── STATE 1: IDLE / READY TO PROCESS ── */}
      {analysisState === "idle" && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-2">
          <div className="space-y-1.5 max-w-xl">
            <div className="flex items-start gap-2 sm:items-center">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{ background: "rgba(16, 185, 129, 0.15)", color: "var(--brand)" }}>
                <Cpu className="h-4 w-4" />
              </span>
              <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                {title}
              </h2>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {description}
            </p>
            <div className="flex items-center gap-2 pt-1 flex-wrap font-mono text-xs" style={{ color: "var(--text-tertiary)" }}>
              {chips.map((chip, i) => (
                <Fragment key={chip}>
                  {i > 0 && <span>·</span>}
                  <span className="px-2 py-0.5 rounded bg-surface-raised">{chip}</span>
                </Fragment>
              ))}
            </div>
          </div>

          <button
            onClick={handleRunAnalysis}
            className="tap w-full sm:w-auto shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
            style={{
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              color: "#ffffff",
              boxShadow: "0 2px 10px rgba(16, 185, 129, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.3)",
            }}
          >
            <Sparkles className="h-4 w-4" />
            <span>{buttonLabel}</span>
          </button>
        </div>
      )}

      {/* ── STATE 2: PROCESSING TELEMETRY ── */}
      {analysisState === "processing" && (
        <div className="py-6 flex flex-col items-center text-center space-y-4">
          <div className="relative flex items-center justify-center h-14 w-14">
            <div className="absolute inset-0 rounded-full border-2 border-dashed border-brand/40 animate-spin" />
            <div className="absolute inset-1 rounded-full border border-brand/20 animate-ping" />
            <div className="h-10 w-10 rounded-full flex items-center justify-center"
              style={{ background: "rgba(16, 185, 129, 0.15)", color: "var(--brand)" }}>
              <Activity className="h-5 w-5 animate-pulse" />
            </div>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {processingTitle}
            </h3>
            <p className="text-xs font-mono h-4" style={{ color: "var(--brand)" }}>
              {steps[stepIdx]}
            </p>
          </div>

          {/* Progress Track */}
          <div className="w-full max-w-md space-y-1">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--surface-raised)" }}>
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: `${progress}%`,
                  background: "linear-gradient(90deg, #10b981 0%, #34d399 100%)",
                }}
              />
            </div>
            <div className="flex justify-between font-mono text-xs" style={{ color: "var(--text-tertiary)" }}>
              <span>{tr("Step {value} of {length}", { value: stepIdx + 1, length: steps.length })}</span>
              <span>{progress}%</span>
            </div>
          </div>
        </div>
      )}

      {/* ── STATE 3: RESULTS REVEALED ── */}
      {analysisState === "ready" && (
        <div className="space-y-5 animate-in fade-in duration-300">
          {/* Header Action Bar */}
          <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b"
            style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full"
                style={{ background: "rgba(16, 185, 129, 0.15)", color: "var(--status-green)" }}>
                <CheckCircle2 className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-bold leading-none" style={{ color: "var(--text-primary)" }}>
                  {reportTitle}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{tr("Generated at {value} · {evaluated}", { value: processedAt ?? tr("just now"), evaluated })}</p>
              </div>
            </div>

            <button
              onClick={handleRunAnalysis}
              className="tap flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150 hover:bg-surface-raised active:scale-[0.98]"
              style={{
                background: "var(--surface-sunken)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-secondary)",
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{tr("Re-run Analysis")}</span>
            </button>
          </div>

          {children}
        </div>
      )}
    </div>
  );
}


/* ── Weight growth report ────────────────────────────────────── */
export function GrowthAnalysisSection({ sample, autoRun }: { sample: SampleFlock; autoRun?: boolean }) {
  const { farm, broilers, endDay } = sample;
  const wd = sample.weightBreakdown;
  const total = broilers.length;
  const optPct = Math.round((wd.Optimal / total) * 100);
  const avgW = farm.weight.actualAvgG;
  const stdW = farm.weight.standardG;
  const wDelta = avgW - stdW;
  const day = farm.cycle.day;
  const variancePercent = farm.weight.variancePercent;
  const above = variancePercent >= 0;
  const signedVar = `${above ? "+" : ""}${variancePercent}%`;
  const sd = farm.cohorts[0]?.standardDeviationG ?? 0;
  const lightest = broilers.reduce((a, b) => (b.weightG < a.weightG ? b : a));
  const harvestG = projectedHarvestG(sample);
  const lo = fmtW(stdW * UNDERWEIGHT_RATIO);
  const hi = fmtW(stdW * HEAVY_RATIO);
  return (
    <DiagnosticsCard
      title={tr("Automated Growth Diagnostics & Trajectory")}
      description={tr("Run multi-factor AI diagnostic on current {total}-bird depth-scan telemetry, Ross 308 standard variance, cohort uniformity, and feed efficiency projections for Day {endDay} harvest.", { total, endDay })}
      chips={[tr("{total} Scans Ready", { total }), tr("Day {day} Cohort", { day }), tr("Ross 308 Benchmark"), tr("FCR {fcr} Correlation", { fcr: farm.feed.fcr })]}
      buttonLabel={tr("Process & Analyze Growth")}
      processingTitle={tr("Processing Telemetry & Growth Curves...")}
      steps={[
        tr("Ingesting {total} depth-scan weight and morphometric records...", { total }),
        tr("Benchmarking flock curve against Ross 308 Day {day} standards ({signedVar} delta)...", { day, signedVar }),
        tr("Evaluating cohort uniformity & clustering at drinker lines..."),
        tr("Synthesizing actionable harvest yield projections..."),
      ]}
      reportTitle={tr("Flock Growth Diagnostic Report")}
      evaluated={tr("{total} Broiler Depth-Scans Evaluated", { total })}
      autoRun={autoRun}
    >
          {/* Diagnostic Key Takeaway Scorecards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
              <p className="label-section text-xs">{tr("Growth Trajectory")}</p>
              <p className="font-mono text-base font-bold mt-0.5" style={{ color: above ? "var(--status-green)" : variancePercent > -5 ? "var(--status-amber)" : "var(--status-red)" }}>{signedVar}</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{tr("{value} Ross 308 standard", { value: above ? tr("Above") : tr("Below") })}</p>
            </div>

            <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
              <p className="label-section text-xs">{tr("Optimal Band")}</p>
              <p className="font-mono text-base font-bold mt-0.5" style={{ color: "var(--brand)" }}>{optPct}%</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{tr("{Optimal} / {total} birds on target", { Optimal: wd.Optimal, total })}</p>
            </div>

            <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
              <p className="label-section text-xs">{tr("At-Risk Cohort")}</p>
              <p className="font-mono text-base font-bold mt-0.5" style={{ color: wd.Underweight > 0 ? "var(--status-amber)" : "var(--status-green)" }}>
                {wd.Underweight} {wd.Underweight === 1 ? tr("Bird") : tr("Birds")}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {wd.Underweight > 0 ? tr("{id} ({value} g) flagged", { id: lightest.id, value: lightest.weightG.toLocaleString() }) : tr("No underweight birds")}
              </p>
            </div>

            <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
              <p className="label-section text-xs">{tr("Projected Harvest")}</p>
              <p className="font-mono text-base font-bold mt-0.5" style={{ color: "var(--cv-accent)" }}>
                {harvestG ? tr("{value} kg", { value: (harvestG / 1000).toFixed(2) }) : "—"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{tr("Estimated Day {endDay} harvest", { endDay })}</p>
            </div>
          </div>

          {/* Detailed Insight Cards */}
          <div className="space-y-3">
            <InsightCard
              level={above ? "positive" : variancePercent > -5 ? "info" : "warning"}
              title={tr("Flock is {value}% {value2} Ross 308 breed standard", { value: Math.abs(variancePercent), value2: above ? tr("above") : tr("below") })}
              body={tr("Average weight of {avgW} g at Day {day} {value} the standard benchmark of {stdW} g by {value2} g. {value3}", { avgW, day, value: above ? tr("exceeds") : tr("is under"), stdW, value2: Math.abs(wDelta), value3: above ? tr("Growth acceleration reflects optimal feed conversion and house environmental controls.") : tr("Check feed access, water flow and house temperature.") })}
            />

            <InsightCard
              level={optPct >= 80 ? "positive" : "info"}
              title={tr("{optPct}% of birds in optimal weight range ({value})", { optPct, value: rangeLabel(stdW * UNDERWEIGHT_RATIO, stdW * HEAVY_RATIO) })}
              body={tr("{Optimal} of {total} birds are clustered in the target growth bracket for Day {day}. Standard deviation is {value} (±{sd} g), {value2}.", { Optimal: wd.Optimal, total, day, value: sd <= avgW * 0.1 ? tr("low") : tr("moderate"), sd, value2: sd <= avgW * 0.1 ? tr("showing good flock uniformity") : tr("so keep an eye on the lighter birds") })}
            />

            {wd.Underweight > 0 && (
              <InsightCard
                level="warning"
                title={tr("{Underweight} underweight {value} flagged for feeder access", { Underweight: wd.Underweight, value: wd.Underweight === 1 ? tr("bird") : tr("birds") })}
                body={tr("Bird {id} ({value} g) is currently {value2} g below the flock average. Telemetry indicates lower movement frequency near Zone CAM-01. Recommend adjusting drinker nipple height and confirming feed pan distribution.", { id: lightest.id, value: lightest.weightG.toLocaleString(), value2: Math.max(0, avgW - lightest.weightG) })}
              />
            )}

            <div className="rounded-xl p-4 border flex items-start gap-3"
              style={{
                background: "rgba(52, 211, 153, 0.05)",
                borderColor: "rgba(52, 211, 153, 0.25)",
              }}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{ background: "rgba(52, 211, 153, 0.2)", color: "var(--brand)" }}>
                <TrendingUp className="h-3.5 w-3.5" />
              </span>
              <div>
                <p className="text-sm font-semibold leading-snug" style={{ color: "var(--brand)" }}>{tr("Operational Recommendation for Day {day}", { day })}</p>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {feedAdvice(day, endDay)}
                </p>
              </div>
            </div>
          </div>
    </DiagnosticsCard>
  );
}


/* ── Insight Card ────────────────────────────────────────────── */
export function InsightCard({ level, title, body }: { level: InsightLevel; title: string; body: string }) {
  const cfg: Record<InsightLevel, { Icon: typeof Check; bg: string; border: string; title: string }> = {
    positive: { Icon: Check,         bg: "var(--status-green-bg)",  border: "var(--status-green-border)",  title: "var(--status-green-text)" },
    warning:  { Icon: AlertTriangle, bg: "var(--status-amber-bg)",  border: "var(--status-amber-border)",  title: "var(--status-amber-text)" },
    critical: { Icon: OctagonAlert,  bg: "var(--status-red-bg)",    border: "var(--status-red-border)",    title: "var(--status-red-text)" },
    info:     { Icon: Info,          bg: "var(--status-blue-bg)",   border: "var(--status-blue-border)",   title: "var(--status-blue-text)" },
  };
  const c = cfg[level];
  return (
    <div className="flex gap-3 rounded-xl p-4" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{ background: c.border, color: "var(--text-inverse)" }}>
        <c.Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-semibold leading-snug" style={{ color: c.title }}>{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{body}</p>
      </div>
    </div>
  );
}
