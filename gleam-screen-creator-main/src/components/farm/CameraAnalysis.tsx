import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, OctagonAlert, ScanSearch } from "lucide-react";
import { ApiError, scanCamera } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { DEFAULT_LIGHTING, isNightCycle, type LightingHours } from "@/lib/farm/dataset";
import {
  CHROME,
  buildFindings,
  findingText,
  overallSeverity,
  ui,
  type Finding,
  type ScanResult,
  type Severity,
} from "@/lib/analysis-insights";
import { localeTag, tr, useLanguage } from "@/lib/i18n";

/* Live Camera "Analysis": one button that analyzes the camera data, then shows
 * tips for the farmer, in the language of the whole system (Settings, or the
 * language menu in the top bar). What the scan can and cannot tell is described
 * in lib/analysis-insights.ts. */

const CAMERA_ID = "CAM-01";

const SEVERITY_STYLE: Record<Severity, { color: string; bg: string; border: string; Icon: typeof Info }> = {
  ok: { color: "var(--status-green-text)", bg: "var(--status-green-bg)", border: "var(--status-green-border)", Icon: CheckCircle2 },
  info: { color: "var(--status-blue-text)", bg: "var(--status-blue-bg)", border: "var(--status-blue-border)", Icon: Info },
  warn: { color: "var(--status-amber-text)", bg: "var(--status-amber-bg)", border: "var(--status-amber-border)", Icon: AlertTriangle },
  alert: { color: "var(--status-red-text)", bg: "var(--status-red-bg)", border: "var(--status-red-border)", Icon: OctagonAlert },
};

type ErrorKey = "err_unavailable" | "err_noFrame" | "err_session" | "err_generic";

function errorKeyFor(err: unknown): ErrorKey {
  if (err instanceof ApiError) {
    if (err.status === 401) return "err_session";
    // The API answers "vision_service_unavailable" when it cannot reach the camera
    // service, and "analyze_error" with a 503 when the service has no frame.
    if (err.message === "vision_service_unavailable") return "err_unavailable";
    if (err.status === 503) return "err_noFrame";
  }
  return "err_generic";
}

export function CameraAnalysis({ lighting = DEFAULT_LIGHTING }: { lighting?: LightingHours }) {
  const { refresh } = useAuth();
  const { lang } = useLanguage();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [scan, setScan] = useState<{ result: ScanResult; at: Date; findings: Finding[] } | null>(null);

  const run = async () => {
    if (scanning) return;
    setScanning(true);
    setError(null);
    try {
      let result: ScanResult;
      try {
        result = await scanCamera(CAMERA_ID);
      } catch (err) {
        // The 15 minute access session may have lapsed since the page loaded.
        if (err instanceof ApiError && err.status === 401 && (await refresh())) {
          result = await scanCamera(CAMERA_ID);
        } else {
          throw err;
        }
      }
      const at = new Date();
      setScan({ result, at, findings: buildFindings(result, isNightCycle(at, lighting)) });
    } catch (err) {
      setError(errorKeyFor(err));
    } finally {
      setScanning(false);
    }
  };

  const overall = scan ? overallSeverity(scan.findings) : null;
  const statusKey = overall === "alert" ? "status_alert" : overall === "warn" ? "status_warn" : "status_ok";

  return (
    <section
      aria-labelledby="analysis-title"
      className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4 elevation-1"
    >
      <div className="border-b border-[var(--border-subtle)] pb-2.5">
        <h2 id="analysis-title" className="label-section text-[11px] font-bold tracking-widest">
          {tr(CHROME.title)}
        </h2>
      </div>

      <div className="mt-3">
        {!scan && !scanning && (
          <p className="mb-3 text-xs leading-relaxed text-[var(--text-tertiary)]">{tr(CHROME.intro)}</p>
        )}

        <button
          type="button"
          onClick={run}
          disabled={scanning}
          className="tap flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:opacity-70"
        >
          {scanning ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ScanSearch className="h-4 w-4" aria-hidden="true" />
          )}
          {tr(scanning ? CHROME.scanning : scan ? CHROME.again : CHROME.scan)}
        </button>

        {error && (
          <p role="alert" className="mt-3 text-xs leading-relaxed" style={{ color: "var(--status-red-text)" }}>
            {tr(CHROME[error])}
          </p>
        )}
      </div>

      {scan && overall && (
        <div className="mt-4 space-y-3" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold"
              style={{
                color: SEVERITY_STYLE[overall].color,
                background: SEVERITY_STYLE[overall].bg,
                borderColor: SEVERITY_STYLE[overall].border,
              }}
            >
              {(() => {
                const { Icon } = SEVERITY_STYLE[overall];
                return <Icon className="h-3.5 w-3.5" aria-hidden="true" />;
              })()}
              {ui(lang, statusKey)}
            </span>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {ui(lang, "scannedAt", { time: scan.at.toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit" }) })}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-[var(--surface-raised)] p-2">
              <dt className="text-[10px] text-[var(--text-tertiary)]">{ui(lang, "movement")}</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                {((scan.result.behaviour?.movement_index ?? 0) * 100).toFixed(1)}%
              </dd>
            </div>
            <div className="rounded-lg bg-[var(--surface-raised)] p-2">
              <dt className="text-[10px] text-[var(--text-tertiary)]">{ui(lang, "areas")}</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                {scan.result.detection_count}
              </dd>
            </div>
          </dl>

          <ul className="space-y-2.5">
            {scan.findings.map((f) => {
              const text = findingText(lang, f);
              const { color, bg, border, Icon } = SEVERITY_STYLE[f.severity];
              return (
                <li key={f.id} className="rounded-lg border p-3" style={{ borderColor: border, background: bg }}>
                  <div className="flex items-start gap-2">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} aria-hidden="true" />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold leading-snug text-[var(--text-primary)]">{text.title}</h3>
                      {text.detail && (
                        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{text.detail}</p>
                      )}
                    </div>
                  </div>
                  {text.tips.length > 0 && (
                    <div className="mt-2 pl-6">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                        {ui(lang, "tips")}
                      </p>
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-[var(--text-secondary)]">
                        {text.tips.map((tip) => (
                          <li key={tip}>{tip}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">{ui(lang, "basis")}</p>
        </div>
      )}
    </section>
  );
}
