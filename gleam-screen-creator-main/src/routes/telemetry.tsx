import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/farm/AppShell";
import { Icon } from "@/components/farm/Icon";
import { areaPath, linePath, points } from "@/lib/farm/chart";
import {
  STATUS_TONE,
  barWidth,
  formatConfidence,
  formatDateCaps,
  formatDateRange,
  formatGrams,
  formatMeasurement,
  formatNumber,
  formatPercent,
  formatScore,
  formatSignedPercent,
  statusLabel,
} from "@/lib/farm/format";
import { getGrowthAnalytics } from "@/lib/farm/repository";

const TITLE = "Growth & Weight Analytics | CereBroiler";
const DESC =
  "Estimated average weight versus breed standard, flock weight distribution and volumetric mass analysis.";

export const Route = createFileRoute("/telemetry")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
    ],
  }),
  loader: () => getGrowthAnalytics(),
  component: TelemetryPage,
});

const CHART_WIDTH = 1000;
const CHART_HEIGHT = 300;

/** Growth variance is judged against this band; the bar shows where it sits. */
const VARIANCE_TOLERANCE_PERCENT = 5;

function TelemetryPage() {
  const { cycle, weight, feed, flockStandardDeviationG, cohorts, volumetric } =
    Route.useLoaderData();

  const [showCalendar, setShowCalendar] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<"realtime" | "historical">("historical");

  const windowStart = new Date(cycle.windowStart);
  const windowEnd = new Date(cycle.windowEnd);
  const [calendarMonth, setCalendarMonth] = useState(windowStart.getMonth());
  const [calendarYear, setCalendarYear] = useState(windowStart.getFullYear());

  // Close calendar when clicking outside
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
      setShowCalendar(false);
    }
  }, []);

  useEffect(() => {
    if (showCalendar) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showCalendar, handleClickOutside]);

  const actual = weight.curve.map((point) => point.actualG);
  const standard = weight.curve.map((point) => point.standardG);
  // Shared value axis so the two curves stay directly comparable.
  const scale = {
    min: Math.min(...actual, ...standard),
    max: Math.max(...actual, ...standard),
    padding: 20,
  };
  const actualPoints = points(actual, CHART_WIDTH, CHART_HEIGHT, scale);
  const currentPoint = actualPoints[actualPoints.length - 1];
  const midPoint = actualPoints[Math.floor(actualPoints.length / 2)];

  const performance = [
    {
      label: "GROWTH VARIANCE",
      value: formatSignedPercent(weight.variancePercent),
      width: barWidth(
        VARIANCE_TOLERANCE_PERCENT + weight.variancePercent,
        VARIANCE_TOLERANCE_PERCENT * 2,
      ),
      note: `TRENDING_${statusLabel(weight.status)}`,
      barClass: "accent-gradient",
    },
    {
      label: "ESTIMATION CONFIDENCE",
      value: formatPercent(weight.estimationConfidencePercent, 0),
      width: barWidth(weight.estimationConfidencePercent, 100),
      note: "SENSOR_STABLE",
      barClass: "bg-accent-amber",
    },
  ];

  return (
    <AppShell>
      <div className="mb-stack-lg flex flex-col justify-between border-b border-outline-variant pb-stack-md md:flex-row md:items-end">
        <div>
          <nav className="mb-2 flex items-center gap-2">
            <span className="font-label-caps text-[10px] text-on-surface-variant">ANALYTICS</span>
            <Icon name="chevron_right" size={12} className="text-outline" />
            <span className="font-label-caps text-[10px] text-primary">GROWTH_WEIGHT</span>
          </nav>
          <h1 className="font-headline-md text-headline-md font-bold text-primary">
            Growth &amp; Weight Analytics
          </h1>
        </div>
        <div className="mt-4 flex gap-4 md:mt-0">
          <div className="relative" ref={calendarRef}>
            <button
              onClick={() => setShowCalendar((v) => !v)}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-outline-variant px-3 py-1.5 transition-colors hover:border-primary hover:bg-surface-container-high"
            >
              <Icon name="calendar_today" size={18} className="text-on-surface-variant" />
              <span className="whitespace-nowrap font-data-md text-data-md">
                {formatDateRange(cycle.windowStart, cycle.windowEnd)}
              </span>
              <Icon
                name="expand_more"
                size={16}
                className={`text-on-surface-variant transition-transform ${showCalendar ? "rotate-180" : ""}`}
              />
            </button>
            {showCalendar && (
              <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-2xl panel-gradient p-4">
                {/* Month nav */}
                <div className="mb-3 flex items-center justify-between">
                  <button
                    onClick={() => {
                      if (calendarMonth === 0) { setCalendarMonth(11); setCalendarYear((y) => y - 1); }
                      else setCalendarMonth((m) => m - 1);
                    }}
                    className="rounded-md p-1 text-on-surface-variant hover:bg-surface-container-high"
                  >
                    <Icon name="chevron_left" size={18} />
                  </button>
                  <span className="font-label-caps text-label-caps text-on-surface">
                    {new Date(calendarYear, calendarMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                  </span>
                  <button
                    onClick={() => {
                      if (calendarMonth === 11) { setCalendarMonth(0); setCalendarYear((y) => y + 1); }
                      else setCalendarMonth((m) => m + 1);
                    }}
                    className="rounded-md p-1 text-on-surface-variant hover:bg-surface-container-high"
                  >
                    <Icon name="chevron_right" size={18} />
                  </button>
                </div>
                {/* Day headers */}
                <div className="grid grid-cols-7 gap-0.5 text-center">
                  {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                    <span key={d} className="font-label-caps text-[9px] text-on-surface-variant py-1">{d}</span>
                  ))}
                </div>
                {/* Day grid */}
                <div className="grid grid-cols-7 gap-0.5 text-center">
                  {(() => {
                    const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
                    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
                    const cells = [];
                    for (let i = 0; i < firstDay; i++) cells.push(<span key={`e${i}`} />);
                    for (let d = 1; d <= daysInMonth; d++) {
                      const date = new Date(calendarYear, calendarMonth, d);
                      const inRange = date >= new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate()) &&
                                      date <= new Date(windowEnd.getFullYear(), windowEnd.getMonth(), windowEnd.getDate());
                      const isStart = date.getTime() === new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate()).getTime();
                      const isEnd = date.getTime() === new Date(windowEnd.getFullYear(), windowEnd.getMonth(), windowEnd.getDate()).getTime();
                      cells.push(
                        <span
                          key={d}
                          className={`flex h-8 w-8 items-center justify-center rounded-md text-[12px] font-data-md ${
                            isStart || isEnd
                              ? "bg-primary text-on-primary font-bold"
                              : inRange
                                ? "bg-primary/15 text-primary"
                                : "text-on-surface hover:bg-surface-container-high"
                          }`}
                        >
                          {d}
                        </span>
                      );
                    }
                    return cells;
                  })()}
                </div>
                {/* Range label */}
                <div className="mt-3 border-t border-outline-variant pt-2 text-center">
                  <span className="font-data-md text-[10px] text-on-surface-variant">
                    {formatDateRange(cycle.windowStart, cycle.windowEnd)}
                  </span>
                </div>
              </div>
            )}
          </div>
          <button className="flex items-center gap-2 rounded-lg bg-primary px-4 py-1.5 font-label-caps text-label-caps text-on-primary transition-colors hover:bg-on-primary-container">
            <Icon name="download" size={16} />
            Export Data
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-stack-md">
        <div className="relative col-span-12 h-[450px] overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest panel-gradient p-stack-md lg:col-span-8">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h2 className="mb-1 font-label-caps text-label-caps uppercase text-outline">
                Estimated Average Weight vs Breed Standard
              </h2>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 border border-accent-cyan" />
                  <span className="font-data-md text-data-md text-accent-cyan">
                    Actual Avg: {formatGrams(weight.actualAvgG)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 border border-outline-variant bg-outline-variant opacity-30" />
                  <span className="font-data-md text-data-md text-on-surface-variant">
                    Standard: {formatGrams(weight.standardG)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-0">
              <button
                onClick={() => setViewMode("realtime")}
                className={`rounded-l-md border px-3 py-1 font-label-caps text-[10px] transition-all hover:bg-surface-container-high ${
                  viewMode === "realtime"
                    ? "border-primary bg-primary/10 font-bold text-primary"
                    : "border-outline-variant text-on-surface-variant"
                }`}
              >
                REAL_TIME
              </button>
              <button
                onClick={() => setViewMode("historical")}
                className={`rounded-r-md border-y border-r px-3 py-1 font-label-caps text-[10px] transition-all hover:bg-surface-container-high ${
                  viewMode === "historical"
                    ? "border-primary bg-primary/10 font-bold text-primary"
                    : "border-outline-variant text-on-surface-variant"
                }`}
              >
                HISTORICAL
              </button>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-gutter bottom-gutter top-24 grid-bg opacity-20" />
          <div className="relative mt-4 h-[300px] w-full">
            <svg
              className="h-full w-full text-accent-cyan"
              preserveAspectRatio="none"
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            >
              <path
                d={linePath(standard, CHART_WIDTH, CHART_HEIGHT, scale)}
                className="stroke-outline"
                fill="none"
                strokeDasharray="4 2"
                strokeWidth="1.5"
              />
              <path
                d={linePath(actual, CHART_WIDTH, CHART_HEIGHT, scale)}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d={areaPath(actual, CHART_WIDTH, CHART_HEIGHT, scale)}
                fill="url(#growthGrad)"
                opacity="0.2"
              />
              <defs>
                <linearGradient id="growthGrad" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
              <circle cx={midPoint.x} cy={midPoint.y} fill="currentColor" r="4" />
              <circle cx={currentPoint.x} cy={currentPoint.y} fill="currentColor" r="4" />
            </svg>
            <div className="absolute bottom-0 left-0 flex w-full translate-y-full justify-between pt-2 font-data-md text-[10px] text-outline">
              {weight.curve.map((point) => (
                <span key={point.day}>DAY {String(point.day).padStart(2, "0")}</span>
              ))}
            </div>
          </div>
          <div className="absolute right-24 top-40 flex flex-col gap-1 rounded-lg border border-outline-variant bg-surface-container-high panel-gradient p-2 shadow-2xl">
            <div className="font-label-caps text-[10px] text-outline">CURRENT_STATE</div>
            <div className="font-data-md text-data-md text-primary">
              {formatSignedPercent(weight.variancePercent)} VARIANCE
            </div>
            <div className="my-1 h-px w-full bg-outline-variant" />
            <div className="font-data-md text-[11px] text-on-surface-variant">
              CONF: {formatPercent(weight.modelConfidence * 100)}
            </div>
          </div>
        </div>

        <div className="col-span-12 flex flex-col gap-stack-md lg:col-span-4">
          <div className="flex flex-1 flex-col justify-between rounded-xl border border-outline-variant bg-surface-container-lowest panel-gradient p-stack-md">
            <div>
              <h2 className="mb-4 font-label-caps text-label-caps uppercase text-outline">
                System Performance
              </h2>
              <div className="space-y-6">
                {performance.map((row) => (
                  <div key={row.label}>
                    <div className="mb-1 flex items-end justify-between">
                      <span className="font-label-caps text-[10px] text-on-surface-variant">
                        {row.label}
                      </span>
                      <span className="font-data-lg text-data-lg text-primary">{row.value}</span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-high">
                      <div
                        className={`h-full rounded-full ${row.barClass}`}
                        style={{ width: row.width }}
                      />
                    </div>
                    <div className="mt-1 text-right font-data-md text-[10px] text-outline">
                      {row.note}
                    </div>
                  </div>
                ))}
                <div className="border-t border-outline-variant pt-4">
                  <div className="flex items-center justify-between">
                    <span className="font-label-caps text-[10px] uppercase text-on-surface-variant">
                      Projected Yield Date
                    </span>
                    <span className="rounded-md bg-surface-container-high px-2 py-1 font-data-md text-data-md text-primary">
                      {formatDateCaps(cycle.projectedYieldDate)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-8 flex gap-4">
              <div className="flex-1 rounded-lg border border-outline-variant panel-gradient p-2">
                <div className="mb-1 font-label-caps text-[9px] text-outline">FCR_ESTIMATE</div>
                <div className="font-data-md text-data-md">{formatScore(feed.fcr)}</div>
              </div>
              <div className="flex-1 rounded-lg border border-outline-variant panel-gradient p-2">
                <div className="mb-1 font-label-caps text-[9px] text-outline">ADG_ESTIMATE</div>
                <div className="font-data-md text-data-md">{formatGrams(feed.adgG)}/d</div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 flex flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest panel-gradient lg:col-span-7">
          <div className="flex items-center justify-between border-b border-outline-variant p-gutter">
            <h2 className="font-label-caps text-label-caps uppercase text-primary">
              Flock Weight Distribution
            </h2>
            <span className="font-data-md text-[10px] text-outline">
              SAMPLES: {formatNumber(weight.sampleSize)} BIRDS · SD: ±{flockStandardDeviationG}g
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  {["Cohort_ID", "Min (g)", "Max (g)", "SD (±)", "Median (g)", "Status"].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={`px-gutter py-3 font-label-caps text-[10px] uppercase text-outline ${
                          i === 0 ? "text-left" : "text-right"
                        }`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="font-data-md text-[13px]">
                {cohorts.map((cohort) => {
                  const tone = STATUS_TONE[cohort.status];
                  return (
                    <tr
                      key={cohort.id}
                      className="border-b border-outline-variant transition-colors hover:bg-surface-container-high"
                    >
                      <td className="px-gutter py-3 text-on-surface">{cohort.id}</td>
                      <td className="px-gutter py-3 text-right text-on-surface-variant">
                        {formatGrams(cohort.minG, false)}
                      </td>
                      <td className="px-gutter py-3 text-right text-on-surface-variant">
                        {formatGrams(cohort.maxG, false)}
                      </td>
                      <td className="px-gutter py-3 text-right text-on-surface-variant">
                        {cohort.standardDeviationG}
                      </td>
                      <td className="px-gutter py-3 text-right text-primary">
                        {formatGrams(cohort.medianG, false)}
                      </td>
                      <td className="px-gutter py-3 text-right">
                        <span
                          className={`mr-2 inline-block h-2 w-2 rounded-full ${tone.dot}`}
                        />
                        <span className={`font-label-caps text-[10px] ${tone.text}`}>
                          {statusLabel(cohort.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="col-span-12 flex flex-col rounded-xl border border-outline-variant bg-surface-container-lowest panel-gradient p-stack-md lg:col-span-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-label-caps text-label-caps uppercase text-primary">
              Kinect Volumetric Analysis
            </h2>
            <span className="font-data-md text-[10px] text-outline">
              REF: {volumetric.sensorId}
            </span>
          </div>
          <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-outline-variant bg-background grid-bg">
            <div className="relative flex h-64 w-48 flex-col items-center justify-center rounded-full border-2 border-accent-cyan/20 backdrop-blur-[2px]">
              <div className="relative h-full w-full">
                <div className="absolute -right-12 -top-4 flex flex-col border-l border-accent-cyan pl-2">
                  <span className="font-label-caps text-[9px] text-outline">BREAST_WIDTH</span>
                  <span className="font-data-md text-[11px]">
                    {formatMeasurement(volumetric.breastWidthMm, "mm")}
                  </span>
                </div>
                <div className="absolute -left-16 top-1/2 flex flex-col border-r border-accent-cyan pr-2 text-right">
                  <span className="font-label-caps text-[9px] text-outline">TOTAL_LENGTH</span>
                  <span className="font-data-md text-[11px]">
                    {formatMeasurement(volumetric.totalLengthMm, "mm")}
                  </span>
                </div>
                <div className="absolute -bottom-4 right-1/4 flex flex-col border-t border-accent-cyan pt-2">
                  <span className="font-label-caps text-[9px] text-outline">DEPTH_Z</span>
                  <span className="font-data-md text-[11px]">
                    {formatMeasurement(volumetric.depthZMm, "mm")}
                  </span>
                </div>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-data-lg text-data-lg text-primary">
                    {formatGrams(volumetric.calculatedMassG)}
                  </span>
                  <span className="font-label-caps text-[9px] text-outline">CALCULATED_MASS</span>
                </div>
              </div>
            </div>
            <div className="absolute left-4 top-4 flex gap-2">
              <div className="h-2 w-2 animate-pulse bg-accent-cyan" />
              <span className="font-label-caps text-[10px] text-accent-cyan">
                LIDAR_SCANNING...
              </span>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-[11px]">
              <span className="font-label-caps uppercase text-outline">Sampled Cohort</span>
              <span className="font-data-md text-on-surface">
                {volumetric.cohortId}
                {volumetric.cohortHouseLabel ? ` / ${volumetric.cohortHouseLabel}` : ""}
              </span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="font-label-caps uppercase text-outline">Morphological Index</span>
              <span className="font-data-md text-on-surface">
                {formatScore(volumetric.morphologicalIndex)}
              </span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="font-label-caps uppercase text-outline">Density Ratio</span>
              <span className="font-data-md text-on-surface">
                {formatConfidence(volumetric.densityRatio)} g/cm³
              </span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="font-label-caps uppercase text-outline">Estimated Precision</span>
              <span className="font-data-md text-accent-teal">
                ± {formatPercent(volumetric.precisionPercent)}
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="h-12" />
    </AppShell>
  );
}
