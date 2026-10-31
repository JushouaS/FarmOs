import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { formatUnit, type GrowthCardData, type GrowthPoint, type GrowthReading } from "@/lib/farm/growth";
import { tr } from "@/lib/i18n";

/* The dashboard's growth card: how heavy the birds are against the breed's
 * target weight, as a headline, a plain-language sentence and a chart with real
 * axes. The house readings (flock, temperature, humidity, ammonia) sit in a
 * small strip underneath, since weight is what this page is about.
 *
 * The card holds no figures, names or units of its own. Everything it shows
 * comes from `data` (see lib/farm/growth.ts for where each field is read from);
 * a field that is missing shows as "—". */

interface Props {
  data: GrowthCardData;
}

const kg = (g: number, digits = 2) => (g / 1000).toFixed(digits);

/** Where the flock stands against the target, in words and a status colour. */
function standing(variance: number): { label: string; tone: "green" | "amber" | "red" } {
  if (variance >= 2) return { label: tr("Ahead of target"), tone: "green" };
  if (variance >= -2) return { label: tr("On target"), tone: "green" };
  if (variance >= -5) return { label: tr("Slightly behind"), tone: "amber" };
  return { label: tr("Behind target"), tone: "red" };
}

/** A tick step that gives about five gridlines: 0.25, 0.5, 1 kg and so on. */
function niceStep(maxKg: number): number {
  const raw = maxKg / 5;
  return [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2].find((s) => s >= raw) ?? 2;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function useViewportHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return h;
}

function GrowthChart({
  curve,
  standardCurve,
  firstDay,
  cycleLength,
  targetLabel,
}: {
  curve: GrowthPoint[];
  standardCurve: { day: number; standardG: number }[];
  /** The first day on the axis: the start day from Settings. */
  firstDay: number;
  cycleLength: number;
  targetLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  // On a wide window the chart takes the height the screen has left after the
  // page header and the rest of the card, so the card fills the screen instead
  // of leaving a gap; on a small one it keeps a fixed, readable height.
  const viewportH = useViewportHeight();
  const height =
    width >= 720 && viewportH > 0 ? Math.min(520, Math.max(280, viewportH - 470)) : width >= 560 ? 260 : 220;
  const fs = width >= 1000 ? 14 : width >= 900 ? 13 : 12;
  const m = { top: 30, right: 30, bottom: 70, left: 44 };
  const innerW = Math.max(0, width - m.left - m.right);
  const innerH = height - m.top - m.bottom;

  const lastDay = curve[curve.length - 1]?.day ?? 0;
  // The axis is the window: the start day to the last day of the grow-out.
  const minDay = Math.min(firstDay, curve[0]?.day ?? firstDay);
  const maxDay = Math.max(cycleLength, lastDay);
  const maxG = Math.max(...curve.flatMap((p) => [p.actualG, p.standardG]), ...standardCurve.map((p) => p.standardG));
  const step = niceStep(maxG / 1000);
  const yMax = Math.ceil((maxG / 1000) / step) * step;
  const yTicks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
  // A tick every 7 days from the first day, and always the last day; a week tick
  // too close to the last day gives way to it.
  // On the last day the window is one day wide: that day, in the middle.
  const xTicks =
    maxDay <= minDay
      ? [minDay]
      : [
          ...Array.from({ length: Math.floor((maxDay - minDay) / 7) + 1 }, (_, i) => minDay + i * 7).filter((d) => maxDay - d >= 3),
          maxDay,
        ];

  const x = (day: number) =>
    maxDay <= minDay ? m.left + innerW / 2 : m.left + ((day - minDay) / (maxDay - minDay)) * innerW;
  // On a narrow chart, drop a % label that would touch its later neighbour.
  const showPct = new Set<number>();
  let nextX = Infinity;
  for (let i = curve.length - 1; i >= 0; i--) {
    const px0 = x(curve[i]!.day);
    if (nextX - px0 >= 46) {
      showPct.add(curve[i]!.day);
      nextX = px0;
    }
  }
  const y = (g: number) => m.top + innerH - (g / 1000 / yMax) * innerH;
  const path = (pick: (p: GrowthPoint) => number) =>
    curve.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");

  const actualPath = path((p) => p.actualG);
  // The target runs the whole window; the actual line stops at today.
  const targetPath = standardCurve
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(p.standardG).toFixed(1)}`)
    .join(" ");
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  const area = `${actualPath} L${x(last.day).toFixed(1)},${y(0).toFixed(1)} L${x(first.day).toFixed(1)},${y(0).toFixed(1)} Z`;

  const shown = hover ?? picked;
  const shownPoint = shown != null ? curve[shown] : null;
  const diff = shownPoint ? ((shownPoint.actualG - shownPoint.standardG) / shownPoint.standardG) * 100 : 0;

  // The curve rises to the right, so the empty space is up and to the left of a
  // dot: the tooltip goes there, or up and to the right for the first dots.
  const tipW = 184;
  const tipH = 102;
  const px = shownPoint ? x(shownPoint.day) : 0;
  const py = shownPoint ? y(shownPoint.actualG) : 0;
  const tipLeft = shownPoint ? (px - tipW - 14 >= 0 ? px - tipW - 14 : Math.min(px + 14, Math.max(0, width - tipW))) : 0;
  const tipTop = Math.max(0, py - tipH);

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <>
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={tr("Average weight by day against the {targetLabel}. Day {day}: {value} kilograms, target {value2} kilograms.", { targetLabel, day: last.day, value: kg(last.actualG, 3), value2: kg(last.standardG, 3) })}
          >
            {/* Gridlines and weight axis */}
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={m.left} x2={width - m.right} y1={y(t * 1000)} y2={y(t * 1000)} stroke="var(--border-subtle)" strokeWidth="1" />
                <text x={m.left - 8} y={y(t * 1000) + 3.5} textAnchor="end" fontSize={fs} fill="var(--text-tertiary)">
                  {t % 1 === 0 ? t.toFixed(0) : t.toFixed(step < 0.1 ? 2 : 1)}
                </text>
              </g>
            ))}
            <text x={m.left - 8} y={m.top - 18} textAnchor="end" fontSize={fs - 1} fontWeight="600" fill="var(--text-tertiary)">
              {tr("kg")}
            </text>

            {/* Day axis */}
            {xTicks.map((d) => (
              <text key={d} x={x(d)} y={height - m.bottom + 18} textAnchor="middle" fontSize={fs} fill="var(--text-tertiary)">
                {d}
              </text>
            ))}
            {curve.filter((p) => showPct.has(p.day)).map((p) => {
              const d = ((p.actualG - p.standardG) / p.standardG) * 100;
              return (
                <text
                  key={`d${p.day}`}
                  x={Math.min(Math.max(x(p.day), m.left + 4), width - m.right + 6)}
                  y={height - m.bottom + 40}
                  textAnchor="middle"
                  fontSize={fs}
                  fontWeight="600"
                  fill={d >= -2 ? "var(--status-green-text)" : d >= -5 ? "var(--status-amber-text)" : "var(--status-red-text)"}
                >
                  {d >= 0 ? "+" : ""}
                  {d.toFixed(1)}%
                </text>
              );
            })}
            <text x={m.left + innerW / 2} y={height - 6} textAnchor="middle" fontSize={fs} fill="var(--text-tertiary)">
              {tr("Day of the flock")}
            </text>

            {/* Target and actual */}
            <path d={area} fill="var(--brand)" opacity="0.1" />
            <path d={targetPath || path((p) => p.standardG)} fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
            <path d={actualPath} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

            {/* One dot per weigh-in, each a hover, tap and keyboard target */}
            {curve.map((p, i) => {
              const isShown = shown === i;
              return (
                <g
                  key={p.day}
                  tabIndex={0}
                  role="img"
                  aria-label={tr("Day {day}: {value} kilograms, target {value2} kilograms", { day: p.day, value: kg(p.actualG, 3), value2: kg(p.standardG, 3) })}
                  className="cursor-pointer outline-none"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => setPicked((cur) => (cur === i ? null : i))}
                >
                  <circle cx={x(p.day)} cy={y(p.actualG)} r="16" fill="transparent" />
                  <circle
                    cx={x(p.day)}
                    cy={y(p.actualG)}
                    r={isShown ? 6 : curve.length > 14 ? 3 : 4.5}
                    fill="var(--surface-card)"
                    stroke="var(--brand)"
                    strokeWidth="2.5"
                  />
                </g>
              );
            })}

            {/* The latest weight, always labelled */}
            <text
              x={x(last.day) < m.left + 70 ? x(last.day) + 10 : x(last.day) - 10}
              y={y(last.actualG) - 12}
              textAnchor={x(last.day) < m.left + 70 ? "start" : "end"}
              fontSize={fs + 1}
              fontWeight="700"
              fill="var(--text-primary)"
              stroke="var(--surface-card)"
              strokeWidth="4"
              paintOrder="stroke"
            >{tr("{kg} kg", { kg: kg(last.actualG) })}</text>
          </svg>

          {shownPoint && (
            <div
              role="status"
              className="pointer-events-none absolute z-10 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-2 text-sm shadow-lg"
              style={{ left: tipLeft, top: tipTop, width: tipW }}
            >
              <p className="font-semibold text-[var(--text-primary)]">{tr("Day {day}", { day: shownPoint.day })}</p>
              <p className="mt-1 flex justify-between gap-2 text-[var(--text-secondary)]">
                <span>{tr("Actual")}</span>
                <span className="font-mono font-semibold tabular-nums text-[var(--text-primary)]">{tr("{kg} kg", { kg: kg(shownPoint.actualG, 3) })}</span>
              </p>
              <p className="flex justify-between gap-2 text-[var(--text-secondary)]">
                <span>{tr("Target")}</span>
                <span className="font-mono tabular-nums">{tr("{kg} kg", { kg: kg(shownPoint.standardG, 3) })}</span>
              </p>
              <p
                className="mt-1 text-right font-mono font-semibold tabular-nums"
                style={{ color: diff >= -2 ? "var(--status-green-text)" : diff >= -5 ? "var(--status-amber-text)" : "var(--status-red-text)" }}
              >
                {diff >= 0 ? "+" : ""}
                {diff.toFixed(1)}%
              </p>
            </div>
          )}
        </>
      )}

      {/* A table ignores the 1px sr-only width and widens the page on phones, so the wrapper hides it. */}
      <div className="sr-only">
      <table>
        <caption>{tr("Average weight by day against the {targetLabel}", { targetLabel })}</caption>
        <thead>
          <tr>
            <th>{tr("Day")}</th>
            <th>{tr("Actual (kg)")}</th>
            <th>{tr("Target (kg)")}</th>
          </tr>
        </thead>
        <tbody>
          {curve.map((p) => (
            <tr key={p.day}>
              <td>{p.day}</td>
              <td>{kg(p.actualG, 3)}</td>
              <td>{kg(p.standardG, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

type Tone = "green" | "amber" | "red";

function Small({ label, value, unit, note, tone }: { label: string; value: string; unit?: string; note?: string; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <dt className="label-section">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-lg font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
          {value}
        </span>
        {unit && (
          <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            {unit}
          </span>
        )}
      </dd>
      {note && (
        <dd className="mt-0.5 truncate font-mono text-xs" style={{ color: tone ? `var(--status-${tone}-text)` : "var(--text-tertiary)" }}>
          {note}
        </dd>
      )}
    </div>
  );
}

/** A sensor reading as a cell: its value, its unit as stored, and its status as the pipeline set it. */
function ReadingCell({ label, reading }: { label: string; reading: GrowthReading }) {
  const has = reading.value != null;
  const words =
    reading.status === "nominal" ? tr("Within range")
    : reading.status === "warning" ? tr("Check")
    : reading.status === "critical" ? tr("Out of range")
    : reading.status === "deviation" ? tr("Deviation")
    : null;
  const tone: Tone | undefined =
    reading.status === "nominal" ? "green"
    : reading.status === "warning" || reading.status === "deviation" ? "amber"
    : reading.status === "critical" ? "red"
    : undefined;
  return (
    <Small
      label={label}
      value={has ? String(reading.value) : "—"}
      unit={has ? formatUnit(reading.unit) : undefined}
      note={has ? [words, reading.range].filter(Boolean).join(" · ") || undefined : tr("No reading yet")}
      tone={has ? tone : undefined}
    />
  );
}

export function GrowthCard({ data }: Props) {
  const { curve, standardCurve, actualG, standardG, variancePercent, cycleLength, cycleStart, cycleDay: day, flock } = data;
  const targetLabel = data.standardName ? `${data.standardName} target` : "target";
  const has = actualG != null && standardG != null && curve.length > 0;
  const state = variancePercent != null ? standing(variancePercent) : null;
  const toneColor = state
    ? {
        green: ["var(--status-green-text)", "var(--status-green-bg)", "var(--status-green-border)"],
        amber: ["var(--status-amber-text)", "var(--status-amber-bg)", "var(--status-amber-border)"],
        red: ["var(--status-red-text)", "var(--status-red-bg)", "var(--status-red-border)"],
      }[state.tone]
    : null;
  const gap = has ? Math.round(Math.abs(actualG! - standardG!)) : 0;
  const dayText = day != null ? tr(" for day {day}", { day }) : "";

  return (
    <section aria-labelledby="growth-title" className="cb-card mb-6 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="growth-title" className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {tr("Growth")}
          </h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>{tr("Average weight vs {targetLabel}{value}", { targetLabel, value: day != null ? tr(" · Day {day} of {cycleLength}", { day, cycleLength }) : "" })}</p>
        </div>
        <Link
          to="/telemetry"
          className="tap inline-flex shrink-0 items-center justify-end text-sm font-semibold hover:underline"
          style={{ color: "var(--brand)" }}
        >
          {tr("Full Analytics →")}
        </Link>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* The answer, in words; on a wide screen the small stats sit at the bottom, level with the chart's baseline */}
        <div className="min-w-0 lg:flex lg:flex-col">
          <p className="label-section">{tr("Average weight")}</p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-4xl font-bold tabular-nums" style={{ color: "var(--cv-accent)" }}>
              {has ? kg(actualG!, 3) : "—"}
            </span>
            <span className="text-lg" style={{ color: "var(--text-tertiary)" }}>
              {tr("kg")}
            </span>
          </p>
          {state && toneColor && variancePercent != null && (
            <span
              className="mt-2 inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold"
              style={{ color: toneColor[0], background: toneColor[1], borderColor: toneColor[2] }}
            >
              {state.label} · {variancePercent >= 0 ? "+" : ""}
              {variancePercent.toFixed(1)}%
            </span>
          )}
          {has && (
            <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {gap === 0
                ? tr("Right on the {targetLabel} of {value} kg{dayText}.", { targetLabel, value: kg(standardG!, 3), dayText })
                : tr("{gap} g {value} than the {targetLabel} of {value2} kg{dayText}.", { gap, value: actualG! >= standardG! ? tr("heavier") : tr("lighter"), targetLabel, value2: kg(standardG!, 3), dayText })}
            </p>
          )}

          <dl className="mt-4 grid gap-2.5 border-t pt-3 lg:mt-auto" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-sm" style={{ color: "var(--text-tertiary)" }}>{tr("Estimate confidence")}</dt>
              <dd className="font-mono text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {data.confidencePercent != null ? `${Math.round(data.confidencePercent)}%` : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-sm" style={{ color: "var(--text-tertiary)" }}>{tr("Birds weighed")}</dt>
              <dd className="font-mono text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {data.sampleSize != null ? data.sampleSize.toLocaleString() : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-sm" style={{ color: "var(--text-tertiary)" }}>{tr("Feed conversion")}</dt>
              <dd className="font-mono text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {data.fcr != null ? data.fcr.toFixed(2) : "—"}
              </dd>
            </div>
          </dl>
        </div>

        {/* The chart */}
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            <span className="inline-flex items-center gap-2">
              <svg width="22" height="8" aria-hidden="true">
                <line x1="1" y1="4" x2="21" y2="4" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
              {tr("Actual weight")}
            </span>
            <span className="inline-flex items-center gap-2">
              <svg width="22" height="8" aria-hidden="true">
                <line x1="1" y1="4" x2="21" y2="4" stroke="var(--text-tertiary)" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
              </svg>
              {targetLabel[0]!.toUpperCase() + targetLabel.slice(1)}
            </span>
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              {tr("The % under each day is how far above (+) or below (−) target the birds were")}
            </span>
          </div>
          {curve.length > 0 ? (
            <GrowthChart curve={curve} standardCurve={standardCurve} firstDay={cycleStart} cycleLength={cycleLength} targetLabel={targetLabel} />
          ) : (
            <p className="py-10 text-center text-base" style={{ color: "var(--text-tertiary)" }}>
              {tr("No weight readings yet for this flock.")}
            </p>
          )}
        </div>
      </div>

      {/* House readings, kept small */}
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t pt-4 sm:grid-cols-4" style={{ borderColor: "var(--border-subtle)" }}>
        <Small
          label={tr("Flock")}
          value={flock.total != null ? flock.total.toLocaleString() : "—"}
          unit={flock.total != null ? tr("birds") : undefined}
          note={flock.active != null && flock.inactive != null ? tr("{active} active · {inactive} inactive", { active: flock.active, inactive: flock.inactive }) : undefined}
        />
        <ReadingCell label={tr("Temperature")} reading={data.temperature} />
        <ReadingCell label={tr("Humidity")} reading={data.humidity} />
        <ReadingCell label={tr("Ammonia NH₃")} reading={data.ammonia} />
      </dl>
    </section>
  );
}
