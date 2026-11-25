import { useEffect, useRef, useState } from "react";
import { fetchDayReadings, type DayReadings, type DaySeries } from "@/lib/api-client";
import { localeTag, tr } from "@/lib/i18n";

/**
 * The day in the pen: temperature and humidity through one day, from the DHT22 on the Raspberry Pi, in 10-minute steps.
 * Two charts, one per reading (degrees and percent never share an axis), each with the range it should sit in shaded.
 * A step without readings is a gap in the line, not a guess. Today up to now; the demo day while the recorded demo shows.
 */
export function DayReadingsCard() {
  const [data, setData] = useState<DayReadings | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetchDayReadings()
        .then((d) => live && (setData(d), setError(false)))
        .catch(() => live && setError(true));
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  const dayLabel = data
    ? new Date(`${data.day}T12:00:00`).toLocaleDateString(localeTag(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";

  return (
    <section aria-labelledby="day-title" className="cb-card mb-6 p-5 sm:p-6">
      <h2 id="day-title" className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        {tr("The day in the pen")}
      </h2>
      <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
        {data
          ? data.demo
            ? tr("Temperature and humidity through {day}, the recorded demo day, every 10 minutes", { day: dayLabel })
            : tr("Temperature and humidity today so far ({day}), every 10 minutes", { day: dayLabel })
          : tr("Temperature and humidity through the day, every 10 minutes")}
      </p>

      {error && (
        <p className="mt-4 text-sm" style={{ color: "var(--status-red-text)" }}>
          {tr("The day's readings could not be loaded.")}
        </p>
      )}
      {data && (
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <DayChart title={tr("Temperature")} unit="°C" series={data.temperature} decimals={1} />
          <DayChart title={tr("Humidity")} unit="%" series={data.humidity} decimals={0} />
        </div>
      )}
    </section>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

function DayChart({ title, unit, series, decimals }: { title: string; unit: string; series: DaySeries; decimals: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const { points, range, summary } = series;
  const height = 190;
  const m = { top: 12, right: 12, bottom: 26, left: 40 };
  const innerW = Math.max(10, width - m.left - m.right);
  const innerH = height - m.top - m.bottom;
  const fmt = (v: number) => `${v.toFixed(decimals)}${unit === "%" ? " %" : ` ${unit}`}`;

  const values = points.map((p) => p.value);
  const lo = Math.min(...values, range.lower ?? Infinity);
  const hi = Math.max(...values, range.upper ?? -Infinity);
  const pad = Math.max(1, (hi - lo) * 0.08);
  const yMin = unit === "%" ? Math.max(0, Math.floor((lo - pad) / 10) * 10) : Math.floor(lo - pad);
  const yMax = unit === "%" ? Math.min(100, Math.ceil((hi + pad) / 10) * 10) : Math.ceil(hi + pad);
  const x = (minute: number) => m.left + (minute / 1440) * innerW;
  const y = (v: number) => m.top + innerH - ((v - yMin) / Math.max(1e-6, yMax - yMin)) * innerH;
  const step = (yMax - yMin) / 4;
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + i * step);

  // A gap of more than 20 minutes breaks the line, so a missing hour is not drawn as if it had been measured.
  let path = "";
  points.forEach((p, i) => {
    const join = i > 0 && p.minute - points[i - 1]!.minute <= 20;
    path += `${join ? "L" : "M"}${x(p.minute).toFixed(1)},${y(p.value).toFixed(1)} `;
  });

  const shown = hover != null ? points[hover] : null;
  const outside = (v: number) => (range.lower != null && v < range.lower) || (range.upper != null && v > range.upper);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!points.length) return;
    const box = e.currentTarget.getBoundingClientRect();
    const minute = ((e.clientX - box.left - m.left) / innerW) * 1440;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i]!.minute - minute) < Math.abs(points[best]!.minute - minute)) best = i;
    setHover(best);
  };

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h3>
        {summary ? (
          <p className="text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
            {tr("Low {low} · Average {avg} · High {high}", { low: fmt(summary.min), avg: fmt(summary.avg), high: fmt(summary.max) })}
          </p>
        ) : null}
      </div>
      {range.lower != null && range.upper != null && (
        <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {tr("Shaded: the range it should stay in, {lower} to {upper}", { lower: fmt(range.lower), upper: fmt(range.upper) })}
        </p>
      )}

      <div ref={ref} className="relative mt-2 w-full" style={{ height }}>
        {!points.length ? (
          <div className="flex h-full items-center justify-center rounded-lg text-sm" style={{ color: "var(--text-tertiary)", background: "var(--surface-sunken)" }}>
            {tr("No readings yet for this day.")}
          </div>
        ) : width > 0 ? (
          <>
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={tr("{title} through the day: low {low}, average {avg}, high {high}", {
                title,
                low: fmt(summary!.min),
                avg: fmt(summary!.avg),
                high: fmt(summary!.max),
              })}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
              style={{ touchAction: "pan-y" }}
            >
              {range.lower != null && range.upper != null && (
                <rect
                  x={m.left}
                  width={innerW}
                  y={y(Math.min(yMax, range.upper))}
                  height={Math.max(0, y(Math.max(yMin, range.lower)) - y(Math.min(yMax, range.upper)))}
                  fill="var(--status-green-bg)"
                  opacity="0.7"
                />
              )}
              {yTicks.map((t) => (
                <g key={t}>
                  <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke="var(--border-subtle)" strokeWidth="1" />
                  <text x={m.left - 6} y={y(t) + 3.5} textAnchor="end" fontSize={11} fill="var(--text-tertiary)">
                    {t.toFixed(unit === "%" || step >= 1 ? 0 : 1)}
                  </text>
                </g>
              ))}
              {[0, 360, 720, 1080, 1440].map((mm) => (
                <text key={mm} x={x(mm)} y={height - 8} textAnchor={mm === 0 ? "start" : mm === 1440 ? "end" : "middle"} fontSize={11} fill="var(--text-tertiary)">
                  {mm === 1440 ? "24:00" : hhmm(mm)}
                </text>
              ))}
              <path d={path} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {shown && (
                <g>
                  <line x1={x(shown.minute)} x2={x(shown.minute)} y1={m.top} y2={m.top + innerH} stroke="var(--text-tertiary)" strokeWidth="1" strokeDasharray="3 3" />
                  <circle cx={x(shown.minute)} cy={y(shown.value)} r="5" fill="var(--surface-card)" stroke="var(--brand)" strokeWidth="2" />
                </g>
              )}
            </svg>
            {shown && (
              <div
                role="status"
                className="pointer-events-none absolute z-10 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-2 text-xs shadow-lg"
                style={{ left: Math.min(Math.max(0, x(shown.minute) - 70), Math.max(0, width - 150)), top: 0, width: 150 }}
              >
                <p className="font-semibold text-[var(--text-primary)]">{tr("{from} to {to}", { from: hhmm(shown.minute), to: hhmm(Math.min(1440, shown.minute + 10)) })}</p>
                <p className="mt-0.5 flex justify-between gap-2 text-[var(--text-secondary)]">
                  <span>{title}</span>
                  <span className="font-mono font-semibold tabular-nums text-[var(--text-primary)]">{fmt(shown.value)}</span>
                </p>
                <p className="text-[var(--text-tertiary)]">
                  {outside(shown.value) ? tr("Outside its range") : tr("Within its range")} · {tr("{n} readings", { n: shown.n })}
                </p>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
