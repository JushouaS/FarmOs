import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/farm/AppShell";
import { Icon } from "@/components/farm/Icon";
import { activeIncident } from "@/lib/farm/dataset";
import {
  READING_VERDICT,
  STATUS_TONE,
  barWidth,
  formatDate,
  formatDateTimeUtc,
  formatDeltaVsBaseline,
  formatDuration,
  formatMb,
  formatMeasurement,
  formatRelative,
  formatScore,
  formatTimeUtc,
  formatWindow,
  statusLabel,
} from "@/lib/farm/format";
import { getMonitoringReport } from "@/lib/farm/repository";
import {
  fetchFeedbackAlerts,
  fetchSituationBriefing,
  type FeedbackAlert,
} from "@/lib/intelligence";

const TITLE = "Intelligence OS | CereBroiler Monitoring Report";
const DESC =
  "Formal auto-generated monitoring report on the current flock telemetry with grounded sensor, visual and reference evidence.";

// `head()` runs before loader data exists, so the social preview reads the
// dataset directly — the same still the evidence section renders.
const EVIDENCE_IMAGE = activeIncident().evidence.imageUrl;

export const Route = createFileRoute("/intelligence")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: EVIDENCE_IMAGE },
      { name: "twitter:image", content: EVIDENCE_IMAGE },
    ],
  }),
  loader: () => getMonitoringReport(),
  component: IntelligencePage,
});

/**
 * The engine grades its own findings on a narrower scale than the sensor
 * statuses, so triage severities keep their own tone map.
 */
const SEVERITY_STYLES: Record<
  FeedbackAlert["severity"],
  { icon: string; text: string; border: string }
> = {
  critical: { icon: "error", text: "text-error", border: "border-l-error" },
  warning: { icon: "warning", text: "text-accent-amber", border: "border-l-accent-amber" },
  nominal: { icon: "check_circle", text: "text-accent-teal", border: "border-l-accent-teal" },
};

function SectionHeading({
  index,
  title,
  meta,
  action,
}: {
  index: string;
  title: string;
  meta?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <div className="flex items-baseline gap-3">
        <span className="font-data-md text-data-md text-accent-cyan">{index}</span>
        <h2 className="font-label-caps text-label-caps uppercase tracking-widest text-primary">
          {title}
        </h2>
        {meta && (
          <span className="font-data-md text-[10px] uppercase text-on-surface-variant opacity-60">
            {meta}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

function IntelligencePage() {
  const { report, platform, facility, incident, findings, references, archive } =
    Route.useLoaderData();

  const briefingQuery = useQuery({
    queryKey: ["situation-briefing"],
    queryFn: () => fetchSituationBriefing(),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const alertsQuery = useQuery({
    queryKey: ["feedback-alerts"],
    queryFn: () => fetchFeedbackAlerts(),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const platformTone = STATUS_TONE[platform.status];
  const peak = incident.peak;
  const peakMax = Math.max(...peak.series);
  const masthead = [
    ["REPORT_ID", report.id],
    ["GENERATED", formatDateTimeUtc(report.generatedAt)],
    ["ENGINE", `${platform.llm} / ML_MODEL_${platform.mlModel}`],
    ["GROUNDING", report.groundingId],
  ];
  const archiveCards = archive.filter((entry) => !entry.featured);
  const featured = archive.find((entry) => entry.featured);

  return (
    <AppShell bare>
      <section className="flex flex-1 flex-col overflow-hidden bg-background">
        <div className="flex-1 overflow-y-auto px-6 py-10">
          <div className="mx-auto max-w-4xl">
            <h1 className="sr-only">CereBroiler Intelligence Monitoring Report</h1>

            <article className="overflow-hidden rounded-xl border border-outline-variant clinical-card">
              {/* Report masthead */}
              <header className="border-b border-outline-variant p-8">
                <div className="mb-6 flex items-center justify-between">
                  <span className="font-label-caps text-[10px] uppercase tracking-widest text-on-surface-variant">
                    {facility.name}
                  </span>
                  <span
                    className={`rounded-md border border-outline-variant bg-surface-container-high px-2 py-1 font-label-caps text-[9px] uppercase tracking-widest ${platformTone.text}`}
                  >
                    System {statusLabel(platform.status)}
                  </span>
                </div>
                <div className="mb-2 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg accent-gradient">
                    <Icon name="psychology" size={20} filled className="text-on-primary" />
                  </div>
                  <div>
                    <h2 className="font-headline-sm text-headline-sm text-primary">
                      Intelligence Monitoring Report
                    </h2>
                    <p className="font-label-caps text-label-caps text-on-surface-variant">
                      Automated flock surveillance — {facility.houseRange}
                    </p>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-outline-variant pt-4 md:grid-cols-4">
                  {masthead.map(([label, value]) => (
                    <div key={label}>
                      <span className="block font-label-caps text-[9px] uppercase tracking-widest text-on-surface-variant opacity-60">
                        {label}
                      </span>
                      <span className="font-data-md text-data-md text-primary">{value}</span>
                    </div>
                  ))}
                </div>
              </header>

              {/* 01 — Executive summary */}
              <section className="border-b border-outline-variant p-8">
                <SectionHeading
                  index="01"
                  title="Executive Summary"
                  meta="Auto-generated"
                  action={
                    <button
                      onClick={() => briefingQuery.refetch()}
                      disabled={briefingQuery.isFetching}
                      className="flex items-center gap-2 rounded-lg border border-outline-variant px-3 py-1.5 font-label-caps text-[10px] uppercase tracking-widest text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                      title="Regenerate summary"
                    >
                      <Icon
                        name="refresh"
                        size={14}
                        className={briefingQuery.isFetching ? "animate-spin" : ""}
                      />
                      Regenerate
                    </button>
                  }
                />
                {briefingQuery.isFetching ? (
                  <div className="flex items-center gap-3">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-accent-cyan" />
                    <span className="font-data-md text-data-md uppercase text-on-surface-variant">
                      {platform.llm} compiling situation briefing...
                    </span>
                  </div>
                ) : briefingQuery.isError ? (
                  <p className="font-body-md text-body-md leading-relaxed text-error">
                    {briefingQuery.error instanceof Error
                      ? briefingQuery.error.message
                      : "Briefing generation failed."}
                  </p>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap font-body-md text-body-md leading-relaxed text-on-surface-variant">
                      {briefingQuery.data?.briefing}
                    </p>
                    {briefingQuery.data && (
                      <p className="mt-4 font-data-md text-[10px] uppercase text-on-surface-variant opacity-50">
                        MODEL: {briefingQuery.data.model} | LATENCY:{" "}
                        {(briefingQuery.data.latencyMs / 1000).toFixed(1)}s
                      </p>
                    )}
                  </>
                )}
              </section>

              {/* 02 — Alert triage */}
              <section className="border-b border-outline-variant p-8">
                <SectionHeading
                  index="02"
                  title="Alert Triage"
                  meta={platform.llm}
                  action={
                    <button
                      onClick={() => alertsQuery.refetch()}
                      disabled={alertsQuery.isFetching}
                      className="p-1 text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
                      title="Re-run analysis"
                    >
                      <Icon
                        name="refresh"
                        size={14}
                        className={alertsQuery.isFetching ? "animate-spin" : ""}
                      />
                    </button>
                  }
                />
                {alertsQuery.isFetching ? (
                  <div className="flex items-center gap-3 rounded-lg border border-outline-variant bg-surface-container-lowest panel-gradient p-4">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-accent-cyan" />
                    <span className="font-data-md text-data-md uppercase text-on-surface-variant">
                      Running telemetry triage...
                    </span>
                  </div>
                ) : alertsQuery.isError ? (
                  <div className="rounded-lg border border-outline-variant border-l-2 border-l-error bg-surface-container-lowest p-4">
                    <p className="font-data-md text-data-md leading-snug text-error">
                      {alertsQuery.error instanceof Error
                        ? alertsQuery.error.message
                        : "Alert analysis failed."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {alertsQuery.data?.alerts.map((alert, i) => {
                      const style = SEVERITY_STYLES[alert.severity];
                      return (
                        <div
                          key={alert.title}
                          className={`rounded-lg border border-outline-variant border-l-2 ${style.border} bg-surface-container-lowest panel-gradient p-4`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Icon name={style.icon} size={14} className={style.text} />
                              <span
                                className={`font-label-caps text-[10px] uppercase tracking-wider ${style.text}`}
                              >
                                {alert.title}
                              </span>
                            </div>
                            <span className="font-data-md text-[10px] uppercase text-on-surface-variant opacity-60">
                              FINDING {String(i + 1).padStart(2, "0")} / {alert.severity}
                            </span>
                          </div>
                          <p className="mt-2 font-body-md text-[12px] leading-snug text-on-surface-variant">
                            {alert.detail}
                          </p>
                          <p className="mt-1 font-data-md text-[10px] uppercase leading-snug text-primary opacity-80">
                            RECOMMENDED ACTION: {alert.action}
                          </p>
                        </div>
                      );
                    })}
                    {alertsQuery.data && (
                      <p className="font-data-md text-[10px] uppercase text-on-surface-variant opacity-50">
                        MODEL: {alertsQuery.data.model} | {alertsQuery.data.latencyMs}ms
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* 03 — Sensor findings */}
              <section className="border-b border-outline-variant p-8">
                <SectionHeading index="03" title="Sensor Findings" meta="Environmental telemetry" />
                <div className="overflow-hidden rounded-lg border border-outline-variant">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-outline-variant bg-surface-container-high">
                        {["PARAMETER", "SOURCE", "READING", "BOUNDS", "STATUS"].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-2 font-label-caps text-[9px] uppercase tracking-widest text-on-surface-variant"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {findings.map((finding) => (
                        <tr
                          key={finding.id}
                          className="border-b border-outline-variant bg-surface-container-lowest last:border-b-0"
                        >
                          <td className="px-4 py-2.5 font-body-md text-[12px] text-primary">
                            {finding.parameter}
                          </td>
                          <td className="px-4 py-2.5 font-data-md text-[11px] text-on-surface-variant">
                            {finding.source}
                          </td>
                          <td className="px-4 py-2.5 font-data-md text-data-md text-primary">
                            {formatMeasurement(finding.value, finding.unit)}
                          </td>
                          <td className="px-4 py-2.5 font-data-md text-[11px] text-on-surface-variant">
                            {finding.boundsLabel}
                          </td>
                          <td
                            className={`px-4 py-2.5 font-label-caps text-[10px] tracking-wider ${
                              STATUS_TONE[finding.status].text
                            }`}
                          >
                            {READING_VERDICT[finding.status]}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-6 grid gap-6 md:grid-cols-2">
                  <div className="relative h-40 w-full overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest panel-gradient">
                    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
                      <div className="flex items-start justify-between">
                        <span className="font-data-md text-[18px] text-error">
                          {formatMeasurement(peak.value, peak.unit)}
                        </span>
                        <span className="font-data-md text-[10px] text-on-surface-variant">
                          NH3 PEAK | {formatDeltaVsBaseline(peak.value, peak.baseline)} vs Baseline
                        </span>
                      </div>
                      <div className="flex h-12 w-full items-end gap-[2px]">
                        {peak.series.map((value, i) => (
                          <div
                            key={i}
                            className={`flex-1 ${
                              value > peak.threshold
                                ? "bg-error"
                                : "bg-outline-variant opacity-20"
                            }`}
                            style={{ height: barWidth(value, peakMax) }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="self-center font-data-md text-data-md leading-relaxed text-on-surface-variant opacity-80">
                    Observation: sensor <span className="text-primary">{peak.sensorId}</span>{" "}
                    reported critical ammonia levels exceeding the {peak.threshold}{" "}
                    {peak.unit.toLowerCase()} threshold for{" "}
                    {formatDuration(incident.exceedanceMinutes)} during the {incident.houseLabel}{" "}
                    incident window ({formatWindow(incident.startedAt, incident.endedAt)}).{" "}
                    {incident.resolution}.
                  </p>
                </div>
              </section>

              {/* 04 — Visual evidence */}
              <section className="border-b border-outline-variant p-8">
                <SectionHeading index="04" title="Visual Evidence" meta={incident.evidence.clipId} />
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="group relative aspect-video w-full cursor-pointer overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
                    <img
                      src={incident.evidence.imageUrl}
                      alt="Night vision camera replay of poultry house with movement tracking overlays"
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-background/40 opacity-0 transition-opacity group-hover:opacity-100">
                      <Icon name="play_circle" size={40} filled className="text-primary" />
                    </div>
                    <div className="absolute left-2 top-2 rounded-md bg-error px-2 py-0.5 font-data-md text-[10px] text-on-error">
                      REPLAY: {formatTimeUtc(incident.evidence.capturedAt)}
                    </div>
                  </div>
                  <div className="self-center space-y-3">
                    <p className="font-data-md text-data-md leading-relaxed text-on-surface-variant opacity-80">
                      Exhibit A: camera unit{" "}
                      <span className="text-primary">{incident.evidence.cameraId}</span> flagged a{" "}
                      {incident.evidence.detectionLabel.toLowerCase().replace(/_/g, " ")} warning in
                      the {incident.houseLabel} replay at{" "}
                      {formatTimeUtc(incident.evidence.capturedAt)}, consistent with elevated
                      ammonia exposure.
                    </p>
                    <div className="flex items-center gap-4 font-data-md text-[10px] uppercase text-on-surface-variant opacity-60">
                      <span>
                        DETECTION CONF: {formatScore(incident.evidence.detectionConfidence)}
                      </span>
                      <span>SOURCE: CAMERA_AI</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* 05 — Reference standards */}
              <section className="p-8">
                <SectionHeading index="05" title="Reference Standards" meta="Cited literature" />
                <div className="space-y-4">
                  {references.map((reference) => (
                    <div
                      key={reference.id}
                      className="rounded-r-lg border-l-2 border-accent-cyan bg-surface-container panel-gradient p-4"
                    >
                      <p className="font-body-md text-body-md italic text-on-surface-variant">
                        "{reference.quote}"
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-label-caps text-[9px] text-primary">
                          {reference.id}
                        </span>
                        <Icon name="open_in_new" size={16} className="text-on-surface-variant" />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Report sign-off */}
              <footer className="flex flex-col gap-4 border-t border-outline-variant bg-surface-container-lowest p-8 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-label-caps text-[10px] uppercase tracking-widest text-on-surface-variant">
                    Compiled automatically by the Intelligence Engine
                  </p>
                  <p className="font-data-md text-[10px] uppercase text-on-surface-variant opacity-50">
                    No operator input | End of report {report.id}
                  </p>
                </div>
                <button className="rounded-lg border border-primary px-6 py-3 font-label-caps text-label-caps tracking-widest text-primary transition-all hover:bg-primary hover:text-on-primary">
                  GENERATE INCIDENT REPORT
                </button>
              </footer>
            </article>

            {/* Appendix — report archive */}
            <div className="mt-12">
              <div className="mb-8 flex items-end justify-between">
                <div>
                  <h3 className="font-headline-sm text-headline-sm text-primary">
                    Appendix — Report Archive
                  </h3>
                  <p className="font-label-caps text-label-caps text-on-surface-variant">
                    Scheduled analytical summaries
                  </p>
                </div>
                <button className="font-label-caps text-label-caps text-primary transition-all hover:underline">
                  VIEW ARCHIVE
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {archiveCards.map((entry) => (
                  <div
                    key={entry.id}
                    className="group cursor-pointer rounded-xl border border-outline-variant bg-surface-container-lowest panel-gradient p-4 transition-all hover:border-primary"
                  >
                    <div className="mb-4 flex items-start justify-between">
                      <Icon
                        name={entry.icon}
                        className="text-on-surface-variant transition-colors group-hover:text-primary"
                      />
                      <span className="rounded-md border border-outline-variant px-1 font-data-md text-[10px] text-on-surface-variant">
                        {entry.format}
                      </span>
                    </div>
                    <h4 className="mb-1 font-label-caps text-label-caps text-primary">
                      {entry.title}
                    </h4>
                    <p className="font-data-md text-data-md text-on-surface-variant opacity-60">
                      {formatDate(entry.generatedAt)} | {formatMb(entry.sizeMb)}
                    </p>
                  </div>
                ))}
                {featured && (
                  <div className="group relative col-span-2 cursor-pointer overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest panel-gradient p-4 transition-all hover:border-primary">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="mb-1 font-label-caps text-label-caps text-primary">
                          {featured.title}
                        </h4>
                        <p className="font-data-md text-data-md text-on-surface-variant opacity-60">
                          {featured.note ?? featured.format} | Generated{" "}
                          {formatRelative(featured.generatedAt, report.generatedAt)}
                        </p>
                      </div>
                      <Icon
                        name="arrow_forward_ios"
                        className="text-on-surface-variant group-hover:text-primary"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
