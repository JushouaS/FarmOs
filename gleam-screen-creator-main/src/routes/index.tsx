import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/farm/AppShell";
import { Icon } from "@/components/farm/Icon";
import { areaPath, linePath } from "@/lib/farm/chart";
import {
  STATUS_TONE,
  formatConfidence,
  formatDuration,
  formatGrams,
  formatMeasurement,
  formatNumber,
  formatSigned,
  formatSignedPercent,
  formatTime,
  formatTimeUtc,
} from "@/lib/farm/format";
import { getOperationsOverview } from "@/lib/farm/repository";

const TITLE = "Command Center | CereBroiler Executive Operations";
const DESC =
  "Executive operations console: LLM flock summary, real-time activity index, alerts and sensor cluster status.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
    ],
  }),
  loader: () => getOperationsOverview(),
  component: Index,
});

const CHART_WIDTH = 800;
const CHART_HEIGHT = 320;
const SPARK_WIDTH = 300;
const SPARK_HEIGHT = 40;

function Index() {
  const {
    facility,
    cycle,
    platform,
    summary,
    activity,
    weight,
    flockStandardDeviationG,
    feed,
    alerts,
    cluster,
    lastAnomaly,
    minutesSinceLastAnomaly,
    report,
  } = Route.useLoaderData();

  // Shared value axis so the actual series and the baseline stay comparable.
  const scale = {
    min: Math.min(...activity.series, activity.baseline),
    max: Math.max(...activity.series, activity.baseline),
    padding: 24,
  };

  const feedStatus = feed.fcr <= feed.fcrTarget ? "nominal" : "deviation";
  const metrics = [
    {
      label: "AVG_WEIGHT (G)",
      delta: formatSignedPercent(weight.variancePercent),
      deltaClass: STATUS_TONE[weight.status].text,
      value: formatGrams(weight.actualAvgG, false),
      sub: `STD_DEV: ${flockStandardDeviationG}g`,
      series: weight.curve.map((point) => point.actualG),
    },
    {
      label: "FEED_CONVERSION (FCR)",
      delta: formatSigned(feed.fcrDelta),
      deltaClass: STATUS_TONE[feedStatus].text,
      value: feed.fcr.toFixed(2),
      sub: `TARGET: ${feed.fcrTarget.toFixed(2)}`,
      series: feed.series,
    },
  ];

  return (
    <AppShell>
      <section className="mb-stack-lg">
        <div className="clinical-card relative overflow-hidden border-l-4 border-l-accent-cyan p-6">
          <div className="absolute right-0 top-0 p-4 opacity-10">
            <Icon name="neurology" size={64} filled />
          </div>
          <div className="mb-2 flex items-center gap-2 font-label-caps text-label-caps text-on-surface-variant">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent-teal" />
            EXECUTIVE_SUMMARY_ENGINE ({platform.llm})
          </div>
          <h1 className="max-w-4xl font-headline-sm text-headline-sm leading-relaxed text-on-surface">
            Flock status is{" "}
            <span className="font-bold text-accent-cyan">
              {summary.status.charAt(0).toUpperCase() + summary.status.slice(1)}
            </span>
            . Last anomaly ({lastAnomaly.label}) logged{" "}
            {formatDuration(minutesSinceLastAnomaly)} ago. Weight gain is{" "}
            <span className="text-accent-cyan">
              {formatSignedPercent(weight.variancePercent)}
            </span>{" "}
            versus breed standard on day {cycle.day}. Environmental parameters in{" "}
            <span className="underline decoration-outline-variant underline-offset-4">
              {facility.houseRange}
            </span>{" "}
            are strictly within biological bounds.
          </h1>
          <div className="mt-4 flex gap-6">
            <div className="flex flex-col">
              <span className="font-label-caps text-label-caps text-on-surface-variant">
                CONFIDENCE_SCORE
              </span>
              <span className="font-data-md text-data-md text-primary">
                {formatConfidence(summary.confidence)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="font-label-caps text-label-caps text-on-surface-variant">
                LAST_SCAN
              </span>
              <span className="font-data-md text-data-md text-primary">
                {formatTimeUtc(report.lastScanAt, true)}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-stack-lg grid grid-cols-12 gap-gutter">
        <div className="clinical-card col-span-12 p-6 lg:col-span-8">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <h2 className="font-label-caps text-label-caps text-on-surface-variant">
                REAL_TIME_ACTIVITY_INDEX
              </h2>
              <div className="mt-1 font-headline-md text-headline-md text-primary">
                {formatNumber(activity.value, 1)}{" "}
                <span className="text-sm font-normal text-on-surface-variant">
                  {activity.unit}
                </span>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <span className="h-0.5 w-3 bg-accent-cyan" />
                <span className="font-label-caps text-[10px] text-on-surface-variant">ACTIVE</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-0.5 w-3 border-t border-dashed bg-outline-variant" />
                <span className="font-label-caps text-[10px] text-on-surface-variant">
                  BASELINE {formatNumber(activity.baseline)}
                </span>
              </div>
            </div>
          </div>
          <div className="relative h-[320px] w-full">
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between opacity-20">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="w-full border-t border-outline" />
              ))}
            </div>
            <svg
              className="h-full w-full text-accent-cyan"
              preserveAspectRatio="none"
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            >
              <path
                d={linePath(
                  [activity.baseline, activity.baseline],
                  CHART_WIDTH,
                  CHART_HEIGHT,
                  scale,
                )}
                className="stroke-outline"
                fill="none"
                strokeDasharray="4,2"
                strokeWidth="1.5"
              />
              <path
                d={linePath(activity.series, CHART_WIDTH, CHART_HEIGHT, scale)}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d={areaPath(activity.series, CHART_WIDTH, CHART_HEIGHT, scale)}
                fill="url(#chartGrad)"
              />
              <defs>
                <linearGradient id="chartGrad" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="mt-4 flex justify-between font-data-md text-[11px] text-on-surface-variant">
            {activity.axisLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>

        <div className="clinical-card col-span-12 flex flex-col overflow-hidden lg:col-span-4">
          <div className="flex items-center justify-between border-b border-outline-variant p-6">
            <h2 className="font-label-caps text-label-caps text-on-surface-variant">
              SYSTEM_ALERTS
            </h2>
            <Icon name="filter_list" size={16} />
          </div>
          <div className="flex-1 overflow-y-auto">
            {alerts.map((alert) => {
              const tone = STATUS_TONE[alert.severity];
              const isCritical = alert.severity === "critical";
              return (
                <div
                  key={alert.id}
                  className={`border-b border-l-2 border-outline-variant/30 p-4 ${
                    isCritical ? "alert-critical" : "border-l-on-surface-variant/30"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span
                      className={`font-label-caps text-[10px] ${
                        isCritical ? `font-bold ${tone.text}` : "text-on-surface-variant"
                      }`}
                    >
                      {alert.kind}
                    </span>
                    <span className="font-data-md text-[10px] text-on-surface-variant">
                      {formatTime(alert.raisedAt)}
                    </span>
                  </div>
                  <div
                    className={`mt-1 font-body-md text-body-md ${
                      isCritical ? "text-on-surface" : "text-on-surface-variant"
                    }`}
                  >
                    {alert.message}
                  </div>
                  {alert.actions && (
                    <div className="mt-2 flex gap-2">
                      {alert.actions.map((action, i) => (
                        <button
                          key={action}
                          className={`rounded-md border border-outline-variant px-2 py-0.5 font-label-caps text-[9px] transition-colors hover:bg-surface-container ${
                            i === 0 ? "text-on-surface" : "text-on-surface-variant"
                          }`}
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="clinical-card p-4">
            <div className="mb-4 flex items-start justify-between">
              <span className="font-label-caps text-label-caps text-on-surface-variant">
                {metric.label}
              </span>
              <span className={`font-data-md text-data-md ${metric.deltaClass}`}>
                {metric.delta}
              </span>
            </div>
            <div className="mb-4 flex items-baseline gap-2">
              <span className="font-data-lg text-data-lg text-primary">{metric.value}</span>
              <span className="font-data-md text-on-surface-variant">{metric.sub}</span>
            </div>
            <div className="h-10 w-full">
              <svg
                className="h-full w-full overflow-visible"
                viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
              >
                <path
                  d={linePath(metric.series, SPARK_WIDTH, SPARK_HEIGHT, { padding: 6 })}
                  className="stroke-accent-cyan"
                  fill="none"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
          </div>
        ))}
      </section>

      <section className="mt-stack-lg">
        <div className="clinical-card p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-label-caps text-label-caps text-on-surface-variant">
              SENSOR_CLUSTER_STATUS
            </h2>
            <span className="font-data-md text-[10px] text-on-surface-variant">
              {cluster.houseLabel.toUpperCase()}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-stack-md md:grid-cols-4 lg:grid-cols-6">
            {cluster.readings.map((reading) => (
              <div
                key={reading.code}
                className="rounded-lg border border-outline-variant/20 panel-gradient p-3"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${STATUS_TONE[reading.status].dot}`}
                  />
                  <span className="font-label-caps text-[10px] text-on-surface-variant">
                    {reading.code}
                  </span>
                </div>
                <div className="mt-1 font-data-md text-data-md text-primary">
                  {formatMeasurement(reading.value, reading.unit)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
