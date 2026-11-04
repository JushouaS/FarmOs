import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { AppShell } from "@/components/farm/AppShell";
import { AxisLineChart, DonutChart, type ChartSeries } from "@/components/farm/charts";
import { getGrowthAnalytics } from "@/lib/farm/repository";
import {
  HEAVY_RATIO,
  UNDERWEIGHT_RATIO,
  fmtW,
  rangeLabel,
  weightBandFor,
  type WeightBand,
} from "@/lib/farm/weight-scale";
import { Activity, AlertTriangle, Check, Info, OctagonAlert, TrendingUp } from "lucide-react";
import { localeTag, tr } from "@/lib/i18n";

/*
 * Analytics — the flock's weight, feed, behaviour and house conditions.
 *
 * Two tabs, as before. What changed is where every number comes from: a weigh-in
 * somebody typed, a snapshot the vision service made, a sensor row that exists.
 * Nothing here is interpolated to fill a chart, and a section with no data says
 * what would fill it. The one target that is not a measurement — the Ross 308
 * standard — is drawn dashed and named as the standard every time it appears.
 */

export const Route = createFileRoute("/telemetry")({
  head: () => ({ meta: [{ title: tr("Analytics - Cerebroil") }] }),
  loader: () => getGrowthAnalytics(),
  component: AnalyticsPage,
});

// ---------------------------------------------------------------------------
// Shapes the API returns
// ---------------------------------------------------------------------------

type Tab = "growth" | "conditions";
type InsightLevel = "positive" | "warning" | "critical" | "info";

/** A day that was actually weighed, and the breed's target for that same day. */
interface MeasuredPoint {
  day: number;
  actualG: number;
  standardG: number;
}

/** The breed's target for a day. Never implies a bird was on a scale. */
interface StandardPoint {
  day: number;
  standardG: number;
}

/** One bird's typed weight for one grow-out day (entered in Flock Tracking). */
interface WeighIn {
  birdId: string;
  day: number;
  actualG: number;
  estimatedG: number | null;
  recordedAt: string;
}

/** A stored sensor reading, with the bounds it is judged against. */
interface Reading {
  parameter: string;
  value: number;
  unit: string;
  status: string | null;
  recordedAt: string | null;
  bounds: { label: string | null; lowerBound: number | null; upperBound: number | null };
}

/** One behaviour analysis and the judgement the API made of it. */
interface Snapshot {
  at: string;
  movement_index: number;
  movement_label: string | null;
  movement_status: string | null;
  huddling_risk: number;
  huddling_label: string | null;
  huddling_status: string | null;
  bird_count: number | null;
  evaluable_count: number | null;
  inactive_count: number | null;
  huddled_count: number | null;
  night: boolean;
  suppressed: boolean;
  reliable: boolean;
}

interface BehaviourReport {
  camera_id: string;
  night: boolean;
  timezone: string;
  latest: Snapshot | null;
  recent: Snapshot[];
  sustained: { inactivity: boolean; huddling: boolean; samples: number };
}

interface Analytics {
  cycle: {
    label: string;
    day: number;
    startDay: number;
    endDay: number;
    startDate: string;
    projectedYieldDate: string;
  } | null;
  facility: { name: string } | null;
  houses: { id: string; label: string }[];
  weight: {
    actualAvgG: number | null;
    standardG: number | null;
    variancePercent: number;
    sampleSize: number | null;
    measuredDay: number | null;
    status: string;
    curve: MeasuredPoint[];
    standardCurve: StandardPoint[];
  };
  feed: {
    fcr: number | null;
    fcrTarget: number;
    adgG: number | null;
    cycleConsumedKg: number;
    series: number[];
  };
  water: { intakeLitresPerHour: number | null; status: string };
  cluster: { houseId: string; houseLabel: string; readings: Reading[] } | null;
  behaviour: BehaviourReport | null;
  weighIns: WeighIn[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** A tinted version of a colour that may be a CSS variable (hex-suffix tricks do not work on those). */
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** A stored timestamp in the reader's own locale, or null when there is none. */
function when(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(localeTag(), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** How a sensor's code reads on screen. Unknown codes show the code itself. */
function readingTitle(parameter: string): string {
  switch (parameter) {
    case "temperature":
      return tr("Temperature");
    case "humidity":
      return tr("Humidity");
    case "co2":
      return tr("CO2");
    case "nh3":
      return tr("Ammonia (NH3)");
    case "light":
      return tr("Light");
    case "airflow":
      return tr("Airflow");
    default:
      return parameter;
  }
}

function readingColor(parameter: string): string {
  switch (parameter) {
    case "temperature":
      return "var(--brand)";
    case "humidity":
      return "var(--status-blue)";
    case "nh3":
      return "var(--status-amber)";
    case "light":
      return "var(--status-amber)";
    default:
      return "var(--status-blue)";
  }
}

/**
 * What a set of typed weights looks like: the count, the ends, the middle and
 * the spread. The standard deviation is null for one bird, because one reading
 * has no spread — reporting 0 g would say the flock is perfectly uniform.
 */
function spreadOf(rows: WeighIn[]) {
  if (rows.length === 0) return null;
  const weights = rows.map((r) => r.actualG).sort((a, b) => a - b);
  const n = weights.length;
  const mean = weights.reduce((sum, v) => sum + v, 0) / n;
  const median = n % 2 === 1 ? weights[(n - 1) / 2]! : (weights[n / 2 - 1]! + weights[n / 2]!) / 2;
  const sd =
    n > 1 ? Math.sqrt(weights.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1)) : null;
  return { n, min: weights[0]!, max: weights[n - 1]!, mean, median, sd };
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function InsightCard({ level, title, body }: { level: InsightLevel; title: string; body: string }) {
  const cfg: Record<
    InsightLevel,
    { Icon: typeof Check; bg: string; border: string; title: string }
  > = {
    positive: {
      Icon: Check,
      bg: "var(--status-green-bg)",
      border: "var(--status-green-border)",
      title: "var(--status-green-text)",
    },
    warning: {
      Icon: AlertTriangle,
      bg: "var(--status-amber-bg)",
      border: "var(--status-amber-border)",
      title: "var(--status-amber-text)",
    },
    critical: {
      Icon: OctagonAlert,
      bg: "var(--status-red-bg)",
      border: "var(--status-red-border)",
      title: "var(--status-red-text)",
    },
    info: {
      Icon: Info,
      bg: "var(--status-blue-bg)",
      border: "var(--status-blue-border)",
      title: "var(--status-blue-text)",
    },
  };
  const c = cfg[level];
  return (
    <div
      className="flex gap-3 rounded-xl p-4"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{ background: c.border, color: "var(--text-inverse)" }}
      >
        <c.Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-semibold leading-snug" style={{ color: c.title }}>
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {body}
        </p>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="cb-card px-4 py-4 flex flex-col gap-1">
      <p className="label-section">{label}</p>
      <p
        className="font-mono text-lg font-bold leading-none mt-1"
        style={{ color: accent ?? "var(--cv-accent)" }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function ChartLegend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]"
      style={{ color: "var(--text-tertiary)" }}
    >
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {item.dashed ? (
            <span
              className="block h-0 w-6 border-t-2 border-dashed"
              style={{ borderColor: item.color }}
            />
          ) : (
            <span className="h-2.5 w-6 rounded-sm" style={{ background: item.color }} />
          )}
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** A reading against the range it is judged by. Drawn only when both ends are stored. */
function RangeBar({
  value,
  min,
  max,
  unit,
  color,
}: {
  value: number;
  min: number;
  max: number;
  unit: string;
  color: string;
}) {
  // A range with no width would divide by zero; the value then sits at the top
  // of a bar that cannot show a position anyway.
  const span = max - min;
  const pct = span === 0 ? 100 : Math.max(0, Math.min(100, ((value - min) / span) * 100));
  const inside = value >= min && value <= max;
  return (
    <div className="space-y-2">
      <div className="flex justify-between font-mono text-xs">
        <span style={{ color: "var(--text-tertiary)" }}>{`${min} ${unit}`}</span>
        <span className="font-bold text-sm" style={{ color: inside ? color : "var(--status-red)" }}>
          {`${value} ${unit}`}
        </span>
        <span style={{ color: "var(--text-tertiary)" }}>{`${max} ${unit}`}</span>
      </div>
      <div
        className="relative h-2.5 rounded-full overflow-hidden"
        style={{ background: "var(--surface-raised)" }}
      >
        <div
          className="absolute inset-y-0 rounded-full opacity-15"
          style={{ left: 0, right: 0, background: color }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: inside ? color : "var(--status-red)" }}
        />
      </div>
    </div>
  );
}

/** What a card says instead of a number, when nothing is stored. */
function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-xl border px-4 py-3 text-xs leading-relaxed"
      style={{
        background: "var(--surface-sunken)",
        borderColor: "var(--border-subtle)",
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </div>
  );
}

function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="label-section text-[11px] tracking-widest font-bold">
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// Weight growth
// ---------------------------------------------------------------------------

function GrowthTab({ data }: { data: Analytics }) {
  const { cycle, weight, weighIns } = data;
  const startDay = cycle?.startDay ?? 1;
  const endDay = cycle?.endDay ?? 45;
  const day = cycle?.day ?? startDay;

  const [range, setRange] = useState<"to-date" | "full">("to-date");
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number; targetY?: number } | null>(
    null,
  );

  const measuredSeries: ChartSeries[] = weight.curve.map((p) => ({ x: p.day, y: p.actualG }));
  const targetSeries: ChartSeries[] = weight.standardCurve.map((p) => ({
    x: p.day,
    y: p.standardG,
  }));
  const hasWeighIns = measuredSeries.length > 0;

  // To Date: the window start up to today (at least a week wide, so the first
  // day still has a line). Full Cycle: the whole grow-out, with the target
  // running ahead of the flock.
  const domainX: [number, number] =
    range === "full"
      ? [startDay, endDay]
      : [startDay, Math.min(endDay, Math.max(day, startDay + 7))];

  const averageG = weight.actualAvgG;
  const standardG = weight.standardG;
  const measuredDay = weight.measuredDay;
  const birdsWeighed = weight.sampleSize ?? (weighIns.length > 0 ? weighIns.length : null);
  const signedVariance = `${weight.variancePercent >= 0 ? "+" : ""}${weight.variancePercent.toFixed(1)}%`;
  const varianceColor = !hasWeighIns
    ? "var(--text-tertiary)"
    : weight.variancePercent >= 0
      ? "var(--status-green)"
      : weight.variancePercent > -5
        ? "var(--status-amber)"
        : "var(--status-red)";

  const stats = spreadOf(weighIns);
  // The breed's target on the last day of the grow-out: a target, not a forecast.
  const harvestTarget = weight.standardCurve.at(-1)?.standardG ?? null;
  const toDateLabel =
    day > startDay ? tr("Day {startDay}–{day}", { startDay, day }) : tr("Day {day}", { day });

  return (
    <div className="space-y-5">
      <div className="cb-card p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div
            className="rounded-xl p-3 border"
            style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}
          >
            <p className="label-section text-[10px]">{tr("Avg Weight")}</p>
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
              <span className="font-mono text-lg font-bold" style={{ color: "var(--cv-accent)" }}>
                {averageG === null ? "—" : fmtW(averageG)}
              </span>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              {averageG === null
                ? tr("No weigh-in this cycle")
                : tr("Weighed on Day {day}", { day: measuredDay ?? day })}
            </p>
          </div>

          <div
            className="rounded-xl p-3 border"
            style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}
          >
            <p className="label-section text-[10px]">{tr("vs Ross 308")}</p>
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
              <span className="font-mono text-lg font-bold" style={{ color: varianceColor }}>
                {averageG === null ? "—" : signedVariance}
              </span>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              {averageG === null || standardG === null
                ? tr("Nothing to compare yet")
                : tr("Against the {value} standard", { value: fmtW(standardG) })}
            </p>
          </div>

          <div
            className="rounded-xl p-3 border"
            style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}
          >
            <p className="label-section text-[10px]">{tr("Birds Weighed")}</p>
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
              <span className="font-mono text-lg font-bold" style={{ color: "var(--status-blue)" }}>
                {birdsWeighed ?? "—"}
              </span>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              {birdsWeighed === null
                ? tr("On the scale for that day")
                : tr("Typed for Day {day}", { day: measuredDay ?? day })}
            </p>
          </div>

          <div
            className="rounded-xl p-3 border"
            style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}
          >
            <p className="label-section text-[10px]">{tr("Spread")}</p>
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
              <span className="font-mono text-lg font-bold" style={{ color: "var(--brand)" }}>
                {stats?.sd != null ? `±${Math.round(stats.sd)} g` : "—"}
              </span>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              {stats?.sd != null
                ? rangeLabel(stats.min, stats.max)
                : tr("Needs two or more weigh-ins")}
            </p>
          </div>
        </div>

        <div className="h-px w-full" style={{ background: "var(--border-subtle)" }} />

        <div>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                  {range === "to-date"
                    ? tr("Flock Growth Trajectory ({range})", { range: toDateLabel })
                    : tr("Full Cycle Growth Curve (Day {startDay}–{endDay})", { startDay, endDay })}
                </h2>
                <span
                  className="font-mono text-xs px-2.5 py-0.5 rounded-full font-semibold"
                  style={{
                    background: tint(varianceColor, 12),
                    color: varianceColor,
                    border: `1px solid ${tint(varianceColor, 30)}`,
                  }}
                >
                  {range === "to-date"
                    ? averageG === null
                      ? tr("Not weighed yet")
                      : tr("{variance} vs Standard", { variance: signedVariance })
                    : tr("Day {endDay} Ross 308 target: {value}", {
                        endDay,
                        value: harvestTarget === null ? "—" : fmtW(harvestTarget),
                      })}
                </span>
              </div>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {range === "to-date"
                  ? tr(
                      "Each dot is a day birds were on the scale. Hover or tap the curve for the weight and the target for that day.",
                    )
                  : tr(
                      "The breed standard from Day {startDay} to Day {endDay}, with the days actually weighed on it.",
                      { startDay, endDay },
                    )}
              </p>
            </div>

            <div className="flex w-full items-center flex-wrap gap-3 sm:w-auto">
              <div
                className="flex w-full rounded-lg p-0.5 border sm:w-auto"
                style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}
              >
                <button
                  onClick={() => setRange("to-date")}
                  className="tap flex-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 sm:flex-none"
                  style={
                    range === "to-date"
                      ? {
                          background: "var(--brand)",
                          color: "var(--text-inverse)",
                          fontWeight: 600,
                          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                        }
                      : { color: "var(--text-secondary)" }
                  }
                >
                  {tr("{range} (To Date)", { range: toDateLabel })}
                </button>
                <button
                  onClick={() => setRange("full")}
                  className="tap flex-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 sm:flex-none"
                  style={
                    range === "full"
                      ? {
                          background: "var(--brand)",
                          color: "var(--text-inverse)",
                          fontWeight: 600,
                          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                        }
                      : { color: "var(--text-secondary)" }
                  }
                >
                  {tr("Day {startDay}–{endDay} (Full Cycle)", { startDay, endDay })}
                </button>
              </div>

              <ChartLegend
                items={[
                  { color: "var(--brand)", label: tr("Weighed") },
                  { color: "var(--status-amber)", label: tr("Ross 308 standard"), dashed: true },
                ]}
              />
            </div>
          </div>

          {hasWeighIns ? (
            <>
              <div
                className="flex items-center gap-2 px-3 py-1 mb-3 rounded-lg border font-mono text-xs w-fit"
                style={{
                  background: "var(--surface-sunken)",
                  borderColor: hoverPoint ? "var(--brand)" : "var(--border-subtle)",
                  boxShadow: hoverPoint ? "0 0 10px rgba(52, 211, 153, 0.2)" : "none",
                  transition: "all 150ms ease",
                }}
              >
                <span style={{ color: "var(--text-tertiary)" }}>
                  {hoverPoint
                    ? `D${hoverPoint.x}:`
                    : tr("Latest (D{day}):", { day: measuredDay ?? day })}
                </span>
                <span className="font-bold text-sm" style={{ color: "var(--brand)" }}>
                  {hoverPoint ? fmtW(hoverPoint.y) : averageG === null ? "—" : fmtW(averageG)}
                </span>
                {hoverPoint?.targetY !== undefined && (
                  <span
                    className="font-semibold text-[11px]"
                    style={{
                      color:
                        hoverPoint.y >= hoverPoint.targetY
                          ? "var(--status-green)"
                          : "var(--status-amber)",
                    }}
                  >
                    {tr("({value}{delta} g vs Ross 308)", {
                      value: hoverPoint.y >= hoverPoint.targetY ? "+" : "",
                      delta: Math.round(hoverPoint.y - hoverPoint.targetY),
                    })}
                  </span>
                )}
              </div>

              <AxisLineChart
                series={measuredSeries}
                targets={targetSeries}
                domainX={domainX}
                color="var(--brand)"
                targetColor="var(--status-amber)"
                height={260}
                onHoverPoint={setHoverPoint}
              />
            </>
          ) : (
            <div className="space-y-4">
              <EmptyNote>
                {tr(
                  "No birds have been weighed this cycle, so only the Ross 308 standard is drawn.",
                )}{" "}
                {harvestTarget !== null && (
                  <>
                    {tr("The Ross 308 target for Day {endDay} is {value}.", {
                      endDay,
                      value: fmtW(harvestTarget),
                    })}{" "}
                  </>
                )}
                {tr("Weights typed in")}{" "}
                <Link
                  to="/flock-monitoring"
                  className="font-semibold"
                  style={{ color: "var(--brand)" }}
                >
                  {tr("Flock Tracking")}
                </Link>{" "}
                {tr("become the points on this chart.")}
              </EmptyNote>

              <AxisLineChart
                series={[]}
                targets={targetSeries}
                domainX={domainX}
                color="var(--brand)"
                targetColor="var(--status-amber)"
                height={260}
              />
            </div>
          )}
        </div>
      </div>

      <DistributionCard standardG={standardG} weighIns={weighIns} stats={stats} />
      <GrowthFindings data={data} stats={stats} />
    </div>
  );
}

/**
 * The per-bird spread of the day's weigh-ins, in three bands of the breed
 * standard. These are the birds somebody put on a scale — there is no other
 * source for a per-bird weight, and a camera estimate is not one.
 */
function DistributionCard({
  standardG,
  weighIns,
  stats,
}: {
  standardG: number | null;
  weighIns: WeighIn[];
  stats: ReturnType<typeof spreadOf>;
}) {
  if (weighIns.length === 0 || standardG === null) {
    return (
      <div className="cb-card p-5">
        <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
          {tr("Flock Weight Distribution")}
        </h2>
        <p className="text-xs mt-0.5 mb-3" style={{ color: "var(--text-secondary)" }}>
          {tr(
            "One bar per band of the Ross 308 standard, counted from the birds actually weighed.",
          )}
        </p>
        <EmptyNote>
          {tr("No birds have been weighed yet.")} {tr("Weights typed in")}{" "}
          <Link to="/flock-monitoring" className="font-semibold" style={{ color: "var(--brand)" }}>
            {tr("Flock Tracking")}
          </Link>{" "}
          {tr("appear here as the per-bird distribution.")}
        </EmptyNote>
      </div>
    );
  }

  const byBand: Record<WeightBand, number[]> = { Underweight: [], Optimal: [], Overweight: [] };
  for (const row of weighIns) byBand[weightBandFor(row.actualG, standardG)].push(row.actualG);

  const bands: { key: WeightBand; label: string; color: string }[] = [
    {
      key: "Underweight",
      label: tr("Under {value}", { value: fmtW(standardG * UNDERWEIGHT_RATIO) }),
      color: "var(--status-amber)",
    },
    {
      key: "Optimal",
      label: rangeLabel(standardG * UNDERWEIGHT_RATIO, standardG * HEAVY_RATIO),
      color: "var(--brand)",
    },
    {
      key: "Overweight",
      label: tr("Over {value}", { value: fmtW(standardG * HEAVY_RATIO) }),
      color: "var(--status-blue)",
    },
  ];

  const total = weighIns.length;
  // Share of birds within ±10% of the median, the Ross 308 uniformity check.
  const within = stats
    ? weighIns.filter((r) => r.actualG >= stats.median * 0.9 && r.actualG <= stats.median * 1.1)
        .length
    : 0;
  const uniformityPct = total > 0 ? Math.round((within / total) * 100) : 0;

  return (
    <div className="cb-card p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
            {tr("Flock Weight Distribution")}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {tr(
              "Birds sorted into bands of the Ross 308 standard for Day {day}, from {total} weigh-ins",
              {
                day: weighIns[0]!.day,
                total,
              },
            )}
          </p>
        </div>
        <span
          className="rounded-full px-2.5 py-1 font-mono text-xs font-semibold"
          style={{
            background: tint("var(--brand)", 12),
            color: "var(--brand)",
            border: `1px solid ${tint("var(--brand)", 25)}`,
          }}
        >
          {tr("Uniformity: {pct}%", { pct: uniformityPct })}
        </span>
      </div>

      <div className="space-y-3">
        {bands.map((band) => {
          const values = byBand[band.key];
          const share = total > 0 ? Math.round((values.length / total) * 100) : 0;
          return (
            <div key={band.key}>
              <div className="flex items-baseline justify-between gap-2 font-mono text-xs">
                <span style={{ color: "var(--text-secondary)" }}>{band.label}</span>
                <span className="font-bold" style={{ color: band.color }}>
                  {tr(values.length === 1 ? "{count} bird · {pct}%" : "{count} birds · {pct}%", {
                    count: values.length,
                    pct: share,
                  })}
                </span>
              </div>
              <div
                className="mt-1 h-2.5 rounded-full overflow-hidden"
                style={{ background: "var(--surface-raised)" }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${share}%`, background: band.color }}
                />
              </div>
              {values.length > 0 && (
                <p className="mt-1 font-mono text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                  {values
                    .sort((a, b) => a - b)
                    .map((v) => fmtW(v))
                    .join(" · ")}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {stats && (
        <div
          className="mt-4 pt-4 grid grid-cols-2 sm:grid-cols-4 gap-3"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <div>
            <p className="label-section text-[10px]">{tr("Lightest")}</p>
            <p
              className="font-mono text-sm font-bold mt-0.5"
              style={{ color: "var(--text-primary)" }}
            >
              {fmtW(stats.min)}
            </p>
          </div>
          <div>
            <p className="label-section text-[10px]">{tr("Median")}</p>
            <p
              className="font-mono text-sm font-bold mt-0.5"
              style={{ color: "var(--text-primary)" }}
            >
              {fmtW(stats.median)}
            </p>
          </div>
          <div>
            <p className="label-section text-[10px]">{tr("Heaviest")}</p>
            <p
              className="font-mono text-sm font-bold mt-0.5"
              style={{ color: "var(--text-primary)" }}
            >
              {fmtW(stats.max)}
            </p>
          </div>
          <div>
            <p className="label-section text-[10px]">{tr("Std deviation")}</p>
            <p
              className="font-mono text-sm font-bold mt-0.5"
              style={{ color: "var(--text-primary)" }}
            >
              {stats.sd == null ? "—" : `${Math.round(stats.sd)} g`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * What the weighed numbers say.
 *
 * Every card is gated on a figure that exists: no weigh-in, no claim about
 * growth. When there is nothing to say, the panel says which gap it is and
 * where the missing figure is entered.
 */
function GrowthFindings({ data, stats }: { data: Analytics; stats: ReturnType<typeof spreadOf> }) {
  const { weight, weighIns, cycle } = data;
  const endDay = cycle?.endDay ?? 45;
  const hasWeighIns = weight.actualAvgG !== null && weight.standardG !== null;

  const cards: ReactNode[] = [];

  if (hasWeighIns) {
    const above = weight.variancePercent >= 0;
    cards.push(
      <InsightCard
        key="variance"
        level={above ? "positive" : weight.variancePercent > -5 ? "info" : "warning"}
        title={tr("Flock is {pct}% {direction} the Ross 308 standard", {
          pct: Math.abs(weight.variancePercent).toFixed(1),
          direction: above ? tr("above") : tr("below"),
        })}
        body={tr("Average weight of {avg} at Day {day} against {standard} for that day.", {
          avg: fmtW(weight.actualAvgG!),
          day: weight.measuredDay ?? cycle?.day ?? 0,
          standard: fmtW(weight.standardG!),
        })}
      />,
    );
  }

  if (stats && weight.standardG !== null) {
    const optimal = weighIns.filter(
      (r) => weightBandFor(r.actualG, weight.standardG!) === "Optimal",
    ).length;
    cards.push(
      <InsightCard
        key="bands"
        level={optimal === stats.n ? "positive" : "info"}
        title={tr("{optimal} of {total} weighed birds are inside the target band", {
          optimal,
          total: stats.n,
        })}
        body={tr("The band is {range}. The rest are outside it: {under} under, {over} over.", {
          range: rangeLabel(weight.standardG * UNDERWEIGHT_RATIO, weight.standardG * HEAVY_RATIO),
          under: weighIns.filter(
            (r) => weightBandFor(r.actualG, weight.standardG!) === "Underweight",
          ).length,
          over: weighIns.filter((r) => weightBandFor(r.actualG, weight.standardG!) === "Overweight")
            .length,
        })}
      />,
    );

    const floor = weight.standardG * UNDERWEIGHT_RATIO;
    const lightest = [...weighIns].sort((a, b) => a.actualG - b.actualG)[0];
    if (lightest && lightest.actualG < floor) {
      cards.push(
        <InsightCard
          key="lightest"
          level="warning"
          title={tr("Bird {id} is under the {value} floor", {
            id: lightest.birdId,
            value: fmtW(floor),
          })}
          body={tr(
            "It weighed {weight}, {delta} g under that floor on Day {day}. Check feeder space and drinker height around it.",
            {
              weight: fmtW(lightest.actualG),
              delta: Math.round(floor - lightest.actualG),
              day: lightest.day,
            },
          )}
        />,
      );
    }
  }

  return (
    <div className="cb-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "rgba(16, 185, 129, 0.15)", color: "var(--brand)" }}
        >
          <TrendingUp className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-bold leading-none" style={{ color: "var(--text-primary)" }}>
            {tr("Growth Findings")}
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            {hasWeighIns
              ? tr("From the weigh-in on Day {day}", { day: weight.measuredDay ?? cycle?.day ?? 0 })
              : tr("Nothing weighed yet")}
          </p>
        </div>
      </div>

      {cards.length > 0 ? (
        cards
      ) : (
        <InsightCard
          level="info"
          title={tr("No weigh-in has been recorded for this cycle")}
          body={tr(
            "The growth curve follows the Ross 308 standard until somebody weighs birds. Enter weights for Day {day} in Flock Tracking: the average, the spread and the per-bird bands appear here straight after. Day {endDay} is the last day of the grow-out.",
            {
              day: cycle?.day ?? 0,
              endDay,
            },
          )}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flock conditions
// ---------------------------------------------------------------------------

function ConditionsTab({ data }: { data: Analytics }) {
  const { feed, water, cluster, behaviour } = data;

  return (
    <div className="space-y-6">
      <FeedSection feed={feed} water={water} />
      <BehaviourSection behaviour={behaviour} />
      <EnvironmentSection cluster={cluster} />
      <ConditionsFindings data={data} />
    </div>
  );
}

function FeedSection({ feed, water }: { feed: Analytics["feed"]; water: Analytics["water"] }) {
  const fcrSeries: ChartSeries[] = feed.series.map((value, i) => ({ x: i + 1, y: value }));
  const fcrDelta = feed.fcr === null ? null : feed.fcrTarget - feed.fcr;
  const nothingRecorded =
    feed.fcr === null &&
    feed.series.length === 0 &&
    feed.adgG === null &&
    water.intakeLitresPerHour === null;

  return (
    <section aria-labelledby="cond-feed" className="space-y-3">
      <SectionHeading id="cond-feed">{tr("Feed & Water")}</SectionHeading>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label={tr("Current FCR")}
          value={feed.fcr === null ? "—" : feed.fcr.toFixed(2)}
          sub={tr("Target: {target}", { target: feed.fcrTarget })}
          accent={
            feed.fcr === null
              ? "var(--text-tertiary)"
              : feed.fcr <= feed.fcrTarget
                ? "var(--status-green)"
                : "var(--status-red)"
          }
        />
        <StatCard
          label={tr("vs Target")}
          value={
            fcrDelta === null ? "—" : `${fcrDelta >= 0 ? "-" : "+"}${Math.abs(fcrDelta).toFixed(2)}`
          }
          sub={
            fcrDelta === null
              ? undefined
              : fcrDelta >= 0
                ? tr("Below FCR target")
                : tr("Above FCR target")
          }
          accent={
            fcrDelta === null
              ? "var(--text-tertiary)"
              : fcrDelta >= 0
                ? "var(--status-green)"
                : "var(--status-red)"
          }
        />
        <StatCard
          label={tr("Daily Gain")}
          value={feed.adgG === null ? "—" : tr("{adg} g/day", { adg: feed.adgG })}
          sub={tr("Avg daily weight gain")}
          accent={feed.adgG === null ? "var(--text-tertiary)" : undefined}
        />
        <StatCard
          label={tr("Feed Consumed")}
          value={feed.cycleConsumedKg > 0 ? tr("{kg} kg", { kg: feed.cycleConsumedKg }) : "—"}
          sub={tr("Cycle total to date")}
          accent={feed.cycleConsumedKg > 0 ? undefined : "var(--text-tertiary)"}
        />
        <StatCard
          label={tr("Water Intake")}
          value={
            water.intakeLitresPerHour === null
              ? "—"
              : tr("{value} L/h", { value: water.intakeLitresPerHour })
          }
          sub={
            water.intakeLitresPerHour === null
              ? tr("Nothing stored yet")
              : tr("Latest stored figure")
          }
          accent={water.intakeLitresPerHour === null ? "var(--text-tertiary)" : undefined}
        />
      </div>

      {nothingRecorded && (
        <EmptyNote>
          {tr(
            "No feed or water figures are recorded, and nothing in this system writes them yet. The cards above stay empty until a feed log exists.",
          )}
        </EmptyNote>
      )}

      {fcrSeries.length > 0 && (
        <div className="cb-card p-5">
          <div className="flex items-start justify-between flex-wrap gap-2 mb-4">
            <div>
              <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                {tr("FCR Trend, Last {count} Measurements", { count: fcrSeries.length })}
              </h3>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {tr("Lower = better efficiency · Target {target} shown as dashed line", {
                  target: feed.fcrTarget,
                })}
              </p>
            </div>
            <ChartLegend
              items={[
                { color: "var(--brand)", label: tr("FCR") },
                { color: "var(--status-amber)", label: tr("Target"), dashed: true },
              ]}
            />
          </div>
          <AxisLineChart
            series={fcrSeries}
            targets={fcrSeries.map((_, i) => ({ x: i + 1, y: feed.fcrTarget }))}
            color="var(--brand)"
            targetColor="var(--status-amber)"
            xLabel="Scan"
            yLabel="FCR"
            yTickCount={5}
            height={180}
            targetLabel="Target"
          />
        </div>
      )}
    </section>
  );
}

function BehaviourSection({ behaviour }: { behaviour: BehaviourReport | null }) {
  const snapshots = behaviour?.recent ?? [];
  // The newest frame is not always a frame the service could judge: a night
  // snapshot is suppressed on purpose, and showing its blank counts would read
  // as "nothing measured" while five usable frames sit behind it. So the cards
  // use the newest frame it *could* judge, and fall back to the newest one
  // only when every frame in the window was set aside.
  const latest = snapshots.find((s) => s.reliable && !s.suppressed) ?? behaviour?.latest ?? null;
  const nightSnapshots = snapshots.filter((s) => s.suppressed).length;

  return (
    <section aria-labelledby="cond-behavior" className="space-y-3">
      <SectionHeading id="cond-behavior">{tr("Behaviour")}</SectionHeading>

      {!latest ? (
        <EmptyNote>
          {tr(
            "No analysis snapshots yet. Analysis on the Live Camera page writes one, and the vision service records one every few minutes while the camera is reachable.",
          )}
        </EmptyNote>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label={tr("Birds Seen")}
              value={latest.bird_count === null ? "—" : String(latest.bird_count)}
              sub={tr("In the analysed frame")}
              accent={latest.bird_count === null ? "var(--text-tertiary)" : undefined}
            />
            <StatCard
              label={tr("Still Birds")}
              value={
                latest.inactive_count === null
                  ? "—"
                  : tr("{n} of {total}", {
                      n: latest.inactive_count,
                      total: latest.bird_count ?? 0,
                    })
              }
              sub={latest.movement_label ?? tr("Birds that did not move")}
              accent={
                latest.movement_status === "warning" ? "var(--status-amber)" : "var(--status-green)"
              }
            />
            <StatCard
              label={tr("Huddled")}
              value={latest.huddled_count === null ? "—" : String(latest.huddled_count)}
              sub={latest.huddling_label ?? tr("Outside feeder zones")}
              accent={
                latest.huddling_status === "critical" ? "var(--status-red)" : "var(--status-green)"
              }
            />
            <StatCard
              label={tr("Snapshots")}
              value={String(snapshots.length)}
              sub={
                nightSnapshots > 0
                  ? tr("{n} at night, not counted", { n: nightSnapshots })
                  : tr("In the rolling window")
              }
            />
          </div>

          <div className="cb-card p-5">
            <h3 className="mb-1 text-base font-bold" style={{ color: "var(--text-primary)" }}>
              {tr("Moving and Still, Latest Analysis")}
            </h3>
            <p className="mb-4 text-xs" style={{ color: "var(--text-secondary)" }}>
              {when(latest.at)
                ? tr("Analysed {when}", { when: when(latest.at)! })
                : tr("Analysed at an unrecorded time")}
            </p>

            {latest.reliable && latest.bird_count !== null && latest.inactive_count !== null ? (
              <>
                <DonutChart
                  segments={[
                    {
                      label: tr("Moving"),
                      value: Math.max(0, latest.bird_count - latest.inactive_count),
                      color: "var(--status-green)",
                    },
                    {
                      label: tr("Still"),
                      value: Math.min(latest.inactive_count, latest.bird_count),
                      color: "var(--status-red)",
                    },
                  ]}
                />
                <p
                  className="mt-3 text-center text-[11px]"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {tr(
                    "Point at a segment, or tap it, for the counts. Huddling is a shape, not a third group, so it is counted above instead.",
                  )}
                </p>
              </>
            ) : (
              <EmptyNote>
                {tr(
                  "The vision service did not judge that frame reliable enough to split into moving and still. The counts above are what it measured.",
                )}
              </EmptyNote>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function EnvironmentSection({ cluster }: { cluster: Analytics["cluster"] }) {
  const readings = cluster?.readings ?? [];

  return (
    <section aria-labelledby="cond-env" className="space-y-3">
      <SectionHeading id="cond-env">{tr("Environment")}</SectionHeading>
      {/* The cards are the camera's house, which is not always the house the
          header names: say which one, so a reading is never read as another
          house's. */}
      {cluster && (
        <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {tr("Sensors in {house}, the house on camera.", { house: cluster.houseLabel })}
        </p>
      )}

      {readings.length === 0 ? (
        <EmptyNote>{tr("No readings are stored for the house on camera.")}</EmptyNote>
      ) : (
        <>
          <EmptyNote>
            {tr(
              "Each sensor holds one stored reading, and nothing in this system logs them, so there is no history to plot — only the last value and the range it should sit in.",
            )}
          </EmptyNote>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {readings.map((reading) => {
              const color = readingColor(reading.parameter);
              const hasRange =
                reading.bounds.lowerBound !== null && reading.bounds.upperBound !== null;
              const recordedAt = when(reading.recordedAt);
              const inside =
                hasRange &&
                reading.value >= reading.bounds.lowerBound! &&
                reading.value <= reading.bounds.upperBound!;
              return (
                <div key={reading.parameter} className="cb-card p-5">
                  <div className="flex items-start justify-between flex-wrap gap-2 mb-1">
                    <div>
                      <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                        {readingTitle(reading.parameter)}
                      </h3>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        {reading.bounds.label ?? tr("No range stored")}
                      </p>
                    </div>
                    <span
                      className="font-mono text-sm font-bold px-3 py-1 rounded-full"
                      style={{
                        color: inside || !hasRange ? color : "var(--status-red)",
                        background: tint(inside || !hasRange ? color : "var(--status-red)", 10),
                        border: `1px solid ${tint(inside || !hasRange ? color : "var(--status-red)", 26)}`,
                      }}
                    >
                      {`${reading.value} ${reading.unit}`}
                    </span>
                  </div>

                  {hasRange && (
                    <div className="mt-4">
                      <RangeBar
                        value={reading.value}
                        min={reading.bounds.lowerBound!}
                        max={reading.bounds.upperBound!}
                        unit={reading.unit}
                        color={color}
                      />
                    </div>
                  )}

                  <p
                    className="mt-4 pt-4 text-[11px]"
                    style={{
                      color: "var(--text-tertiary)",
                      borderTop: "1px solid var(--border-subtle)",
                    }}
                  >
                    {recordedAt
                      ? tr("Recorded {when}", { when: recordedAt })
                      : tr("Time not recorded")}
                    {reading.status && reading.status !== "nominal" ? ` · ${reading.status}` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The conditions tab's conclusions.
 *
 * Two hard kinds of evidence: a reading outside its stored range, and a
 * behaviour finding the vision service sustained across its window. Everything
 * else is stated as an absence rather than filled in.
 */
function ConditionsFindings({ data }: { data: Analytics }) {
  const { feed, cluster, behaviour } = data;
  const readings = cluster?.readings ?? [];
  const sustained = behaviour?.sustained ?? null;
  const cards: ReactNode[] = [];

  for (const reading of readings) {
    const { lowerBound, upperBound } = reading.bounds;
    if (lowerBound === null || upperBound === null) continue;
    if (reading.value >= lowerBound && reading.value <= upperBound) continue;
    cards.push(
      <InsightCard
        key={`reading-${reading.parameter}`}
        level="warning"
        title={tr("{reading} is outside its stored range", {
          reading: readingTitle(reading.parameter),
        })}
        body={tr(
          "It reads {value} {unit} against {range}. Check the house before the next reading is taken.",
          {
            value: reading.value,
            unit: reading.unit,
            range: reading.bounds.label ?? rangeLabel(lowerBound, upperBound),
          },
        )}
      />,
    );
  }

  if (sustained && sustained.samples > 0) {
    if (sustained.inactivity) {
      cards.push(
        <InsightCard
          key="inactivity"
          level="warning"
          title={tr("Inactivity held across the last {n} daytime snapshots", {
            n: sustained.samples,
          })}
          body={tr(
            "That many frames in a row is a trend, not a moment. Walk the house and check feeder and drinker access before treating it as a welfare finding.",
          )}
        />,
      );
    }
    if (sustained.huddling) {
      cards.push(
        <InsightCard
          key="huddling"
          level="critical"
          title={tr("Huddling held for three or more consecutive snapshots")}
          body={tr(
            "A clump that does not dissolve points at cold or draught. Check ventilation and house temperature against the readings above.",
          )}
        />,
      );
    }
    if (!sustained.inactivity && !sustained.huddling) {
      cards.push(
        <InsightCard
          key="clear"
          level="positive"
          title={tr("No sustained inactivity or huddling in the last {n} daytime snapshots", {
            n: sustained.samples,
          })}
          body={tr(
            "Single frames can look worse than the flock is; these findings only count when they hold across the window.",
          )}
        />,
      );
    }
  } else if (behaviour) {
    cards.push(
      <InsightCard
        key="no-usable"
        level="info"
        title={tr("No daytime snapshot to judge behaviour by")}
        body={tr(
          "The window holds no analysis the vision service could use — night frames are set aside because a sleeping flock is not a still flock.",
        )}
      />,
    );
  }

  if (feed.fcr !== null) {
    const over = feed.fcr > feed.fcrTarget;
    cards.push(
      <InsightCard
        key="fcr"
        level={over ? "warning" : "positive"}
        title={
          over
            ? tr("Feed conversion is above the {target} target", { target: feed.fcrTarget })
            : tr("Feed conversion is at or below the {target} target", { target: feed.fcrTarget })
        }
        body={tr(
          "The latest stored figure reads {fcr}. Lower is better: every hundredth is feed the flock did not turn into weight.",
          {
            fcr: feed.fcr.toFixed(2),
          },
        )}
      />,
    );
  }

  return (
    <div className="cb-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "rgba(16, 185, 129, 0.15)", color: "var(--brand)" }}
        >
          <Activity className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-bold leading-none" style={{ color: "var(--text-primary)" }}>
            {tr("Findings")}
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            {tr(
              "Readings against their ranges, sustain-behaviour checks, and feed conversion when one is stored.",
            )}
          </p>
        </div>
      </div>

      {cards.length > 0 ? (
        cards
      ) : (
        <InsightCard
          level="info"
          title={tr("Nothing stored to draw a conclusion from")}
          body={tr(
            "No reading, no snapshot and no feed figure is available yet. Each card on this tab fills in on its own as soon as its source has a row.",
          )}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function AnalyticsPage() {
  const data = Route.useLoaderData() as unknown as Analytics;
  const [tab, setTab] = useState<Tab>("growth");

  const { cycle, facility, houses, weight, cluster, weighIns } = data;
  const endDay = cycle?.endDay ?? 45;
  const day = cycle?.day ?? null;

  // The newest stored reading decides how old the environment cards are.
  const newestReading = (cluster?.readings ?? [])
    .map((r) => r.recordedAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);

  const tabs: { id: Tab; label: string }[] = [
    { id: "growth", label: tr("Weight Growth") },
    { id: "conditions", label: tr("Flock Conditions") },
  ];

  return (
    <AppShell>
      <div className="mb-6">
        <h1
          className="font-display text-2xl font-bold tracking-tight"
          style={{ color: "var(--text-primary)" }}
        >
          {tr("Analytics")}
        </h1>

        {cycle ? (
          <>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              <span className="font-semibold" style={{ color: "var(--brand)" }}>
                {facility?.name ?? tr("This farm")}
              </span>
              {` · ${houses[0]?.label ?? tr("House")} · `}
              <span className="font-mono font-bold" style={{ color: "var(--cv-accent)" }}>
                {tr("Day {day}", { day: day ?? 0 })}
              </span>
              {` / ${endDay} `}
              <span style={{ color: "var(--text-tertiary)" }}>
                {tr("({pct}% of grow-out)", { pct: Math.round(((day ?? 0) / endDay) * 100) })}
              </span>
            </p>
            <p className="mt-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              {weight.measuredDay !== null && weight.actualAvgG !== null
                ? tr("Last weigh-in: Day {day}, {n} birds", {
                    day: weight.measuredDay,
                    n: weight.sampleSize ?? weighIns.length,
                  })
                : tr("No birds have been weighed this cycle")}
              {" · "}
              {newestReading
                ? tr("Readings recorded {when}", { when: when(newestReading)! })
                : tr("No readings stored")}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            {tr("No cycle is running yet.")}
          </p>
        )}
      </div>

      {!cycle ? (
        <EmptyNote>
          {tr(
            "Start a grow-out in Settings and this page fills in from the weigh-ins, camera analyses and readings the system records.",
          )}
        </EmptyNote>
      ) : (
        <>
          <div
            className="mb-6 flex gap-1 w-fit max-w-full rounded-xl p-1 overflow-x-auto"
            style={{ background: "var(--surface-card)", border: "1px solid var(--border-subtle)" }}
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className="tap shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-all duration-150 sm:px-4"
                style={
                  tab === t.id
                    ? {
                        background: "var(--brand)",
                        color: "var(--text-inverse)",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                      }
                    : { color: "var(--text-secondary)" }
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "growth" ? <GrowthTab data={data} /> : <ConditionsTab data={data} />}
        </>
      )}
    </AppShell>
  );
}
