import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useId, useMemo, useState, useRef, useLayoutEffect, type ReactNode } from "react";
import { AppShell } from "@/components/farm/AppShell";
import { getGrowthAnalytics } from "@/lib/farm/repository";
import { fetchLiveBehavior, fetchSensorHistory, fetchWeightSpread, type LiveBehavior, type SensorDay, type SensorHistory } from "@/lib/api-client";
import { HEAVY_RATIO, NO_SPREAD, UNDERWEIGHT_RATIO, buildFlockWeights, fmtW, rangeLabel, type FlockWeights, type WeightSpread } from "@/lib/farm/weights";
import {
  Sparkles,
  Cpu,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Scale,
  Check,
  Info,
  ChevronRight,
  Gauge,
  Layers,
  ArrowUpRight,
  Play,
  Activity,
  Calendar,
  OctagonAlert,
} from "lucide-react";
import { T, localeTag, tr } from "@/lib/i18n";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  GrowthAnalysisSection,
  type InsightLevel,
} from "@/components/farm/GrowthDiagnostics";

export const Route = createFileRoute("/telemetry")({
  head: () => ({ meta: [{ title: tr("Analytics - Cerebroil") }] }),
  loader: () => getGrowthAnalytics(),
  component: AnalyticsPage,
});

type Tab = "growth" | "conditions";
interface ChartSeries { x: number; y: number; }

/* ── Axis Line Chart with Interactive Hover & Crosshair ───────── */
function AxisLineChart({
  series,
  targets,
  color = "var(--brand)",
  targetColor = "var(--status-amber)",
  xLabel = "Day",
  yLabel = "g",
  yTickCount = 5,
  height = 200,
  domainX,
  domainY,
  onHoverPoint,
  targetLabel = "Ross 308",
}: {
  series: ChartSeries[];
  targets?: ChartSeries[];
  color?: string;
  targetColor?: string;
  xLabel?: string;
  yLabel?: string;
  yTickCount?: number;
  height?: number;
  domainX?: [number, number];
  domainY?: [number, number];
  onHoverPoint?: (pt: { x: number; y: number; targetY?: number } | null) => void;
  /** What the dashed line is called in the tooltip. */
  targetLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(900);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Layout effect: measure before the first paint, so a freshly mounted chart
  // (e.g. after switching tabs) never flashes at the 900px default width.
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const updateWidth = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        if (w > 0) setContainerWidth(w);
      }
    };
    updateWidth();
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setContainerWidth(Math.round(w));
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  if (series.length < 1) return null;
  // Draw at the container's real width so text stays at its true size on
  // phones (a wider viewBox would be scaled down and letterboxed).
  const W = Math.max(containerWidth, 260);
  const H = height;
  const narrow = W < 480;
  const LEFT = narrow ? 48 : 56, BOT = 34, RIGHT = narrow ? 12 : 24, TOP = 16;
  const plotW = W - LEFT - RIGHT, plotH = H - TOP - BOT;

  const allX = series.map((p) => p.x);
  const minX = domainX ? domainX[0] : Math.min(...allX);
  const maxX = domainX ? domainX[1] : Math.max(...allX);

  // Filter actual points and targets to visible X range
  const actualPts = series.filter((p) => p.y > 0 && p.x >= minX && p.x <= maxX);
  const visibleTargets = (targets ?? []).filter((p) => p.y > 0 && p.x >= minX && p.x <= maxX);

  // Determine nice max value based only on visible data to prevent compression
  const allY = [...actualPts.map((p) => p.y), ...visibleTargets.map((p) => p.y)];
  const rawMax = allY.length > 0 ? Math.max(...allY) : 100;

  const getNiceScale = (val: number) => {
    const padded = val * 1.14;
    if (padded <= 2) return Math.ceil(padded * 10) / 10;
    if (padded <= 10) return Math.ceil(padded);
    if (padded <= 40) return Math.ceil(padded / 5) * 5;
    if (padded <= 100) return Math.ceil(padded / 10) * 10;
    if (padded <= 500) return Math.ceil(padded / 50) * 50;
    if (padded <= 2000) return Math.ceil(padded / 200) * 200;
    return Math.ceil(padded / 500) * 500;
  };

  const minV = domainY ? domainY[0] : 0;
  const maxV = domainY ? domainY[1] : getNiceScale(rawMax);

  const xS = (x: number) => LEFT + ((x - minX) / (maxX - minX || 1)) * plotW;
  const yS = (v: number) => TOP + plotH - ((v - minV) / (maxV - minV || 1)) * plotH;

  const linePath = (pts: ChartSeries[]) =>
    pts.filter((p) => p.y > 0).map((p, i) => `${i === 0 ? "M" : "L"}${xS(p.x).toFixed(1)},${yS(p.y).toFixed(1)}`).join(" ");

  const last = actualPts[actualPts.length - 1]!, first = actualPts[0]!;
  const areaD = actualPts.length > 1
    ? `${linePath(actualPts)} L${xS(last.x).toFixed(1)},${(TOP + plotH).toFixed(1)} L${xS(first.x).toFixed(1)},${(TOP + plotH).toFixed(1)} Z`
    : "";

  const yTicks = Array.from({ length: yTickCount }, (_, i) => {
    const val = minV + ((maxV - minV) / (yTickCount - 1)) * i;
    const roundedVal = maxV <= 2 ? parseFloat(val.toFixed(2)) : Math.round(val);
    return { val: roundedVal, y: yS(roundedVal) };
  });

  const xTicks = actualPts.map((p) => ({ x: p.x, px: xS(p.x) }));
  const projTicks = visibleTargets
    .filter((p) => !actualPts.find((s) => s.x === p.x))
    .map((p) => ({ x: p.x, px: xS(p.x) }));
  const allXTicks = [...xTicks, ...projTicks].sort((a, b) => a.x - b.x);
  // Days are not evenly spaced (D1, D3 ... D9, D10, D12), so thinning by count
  // lets neighbours collide. Keep a label only if it is far enough from the
  // last one kept; the last tick always shows, and the hovered one wins over
  // its neighbours.
  const LABEL_GAP = 40;
  const labelled = new Set<number>();
  {
    let lastPx = -Infinity;
    for (const t of allXTicks) {
      if (t.px - lastPx >= LABEL_GAP) {
        labelled.add(t.x);
        lastPx = t.px;
      }
    }
    const lastTick = allXTicks[allXTicks.length - 1];
    if (lastTick && !labelled.has(lastTick.x)) {
      for (const t of allXTicks) if (labelled.has(t.x) && lastTick.px - t.px < LABEL_GAP) labelled.delete(t.x);
      labelled.add(lastTick.x);
    }
  }

  const gradId = `grad-${color.replace(/[^a-z0-9]/gi, "")}`;
  const clipId = `clip-${gradId}`;

  const hoveredPoint = hoverIdx !== null && actualPts[hoverIdx] ? actualPts[hoverIdx] : null;
  const hoveredTarget = hoveredPoint ? visibleTargets.find((t) => t.x === hoveredPoint.x) : null;

  const formatVal = (v: number) => {
    if (yLabel === "g") {
      return v >= 1000 ? `${(v / 1000).toFixed(2)} kg` : `${v} g`;
    }
    if (yLabel === "FCR") return v.toFixed(2);
    if (yLabel.includes("°C")) return `${v.toFixed(1)}°C`;
    if (yLabel.includes("%")) return `${Math.round(v)}%`;
    if (yLabel.includes("ppm")) return `${v} ppm`;
    return String(v);
  };

  const handlePointerMove = (e: React.MouseEvent<SVGSVGElement> | React.PointerEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    let svgX: number;
    try {
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        svgX = pt.matrixTransform(ctm.inverse()).x;
      } else {
        const rect = svg.getBoundingClientRect();
        svgX = ((e.clientX - rect.left) / (rect.width || 1)) * W;
      }
    } catch {
      const rect = svg.getBoundingClientRect();
      svgX = ((e.clientX - rect.left) / (rect.width || 1)) * W;
    }

    if (svgX < LEFT - 16 || svgX > LEFT + plotW + 16 || actualPts.length === 0) {
      setHoverIdx(null);
      onHoverPoint?.(null);
      return;
    }

    let closestIdx = 0;
    let minDist = Infinity;
    actualPts.forEach((p, idx) => {
      const dist = Math.abs(xS(p.x) - svgX);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = idx;
      }
    });

    setHoverIdx(closestIdx);
    const pt = actualPts[closestIdx];
    const tgt = visibleTargets.find((t) => t.x === pt.x);
    onHoverPoint?.({ x: pt.x, y: pt.y, targetY: tgt?.y });
  };

  const handlePointerLeave = () => {
    setHoverIdx(null);
    onHoverPoint?.(null);
  };

  return (
    <div ref={containerRef} className="relative w-full select-none">
      {/* touchAction pan-y keeps vertical page scrolling on touch screens;
          a tap or a sideways drag still scrubs the curve. */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair overflow-visible block"
        style={{ width: "100%", height: H, touchAction: "pan-y" }}
        onMouseMove={handlePointerMove}
        onPointerDown={handlePointerMove}
        onPointerMove={handlePointerMove}
        onMouseLeave={handlePointerLeave}
        onPointerLeave={handlePointerLeave}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="70%" stopColor={color} stopOpacity="0.06" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`stroke-${gradId}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.85" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="1" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x={LEFT} y={TOP} width={plotW} height={plotH} />
          </clipPath>
          <filter id={`glow-${gradId}`}>
            <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Chart background with subtle rounded border */}
        <rect
          x={LEFT}
          y={TOP}
          width={plotW}
          height={plotH}
          fill="var(--surface-sunken)"
          rx="6"
          opacity="0.4"
        />

        {/* Y grid lines + values */}
        {yTicks.map(({ val, y }) => (
          <g key={val}>
            <line
              x1={LEFT}
              x2={LEFT + plotW}
              y1={y}
              y2={y}
              stroke="var(--border-subtle)"
              strokeWidth={val === 0 ? "1.5" : "1"}
              strokeDasharray={val === 0 ? "" : "4,4"}
              opacity="0.7"
            />
            <text
              x={LEFT - 8}
              y={y + 3.5}
              textAnchor="end"
              fontSize="12"
              fill="var(--text-tertiary)"
              fontFamily="JetBrains Mono, monospace"
              fontWeight="500"
            >
              {yLabel === "g" && val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
            </text>
          </g>
        ))}

        {/* Y axis title */}
        <text
          x={10}
          y={TOP + plotH / 2}
          textAnchor="middle"
          fontSize="12"
          fill="var(--text-tertiary)"
          fontWeight="600"
          transform={`rotate(-90, 10, ${TOP + plotH / 2})`}
        >
          {yLabel === "g" ? tr("Weight (g)") : yLabel}
        </text>

        {/* Axes */}
        <line
          x1={LEFT}
          x2={LEFT + plotW}
          y1={TOP + plotH}
          y2={TOP + plotH}
          stroke="var(--border-default)"
          strokeWidth="1.5"
        />
        <line
          x1={LEFT}
          x2={LEFT}
          y1={TOP}
          y2={TOP + plotH}
          stroke="var(--border-default)"
          strokeWidth="1.5"
        />

        {/* X ticks */}
        {allXTicks.map(({ x, px }) => {
          const isHovered = hoveredPoint?.x === x;
          const hoverPx = hoveredPoint ? xS(hoveredPoint.x) : null;
          const showLabel =
            isHovered || (labelled.has(x) && (hoverPx === null || Math.abs(px - hoverPx) >= LABEL_GAP));
          return (
            <g key={x}>
              <line
                x1={px}
                x2={px}
                y1={TOP + plotH}
                y2={TOP + plotH + 5}
                stroke={isHovered ? color : "var(--border-default)"}
                strokeWidth={isHovered ? "2" : "1.5"}
              />
              {showLabel && (
                <text
                  x={px}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize={isHovered ? "10.5" : "10"}
                  fill={isHovered ? "var(--text-primary)" : "var(--text-tertiary)"}
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight={isHovered ? "700" : "500"}
                >
                  {xLabel === "Day" ? `D${x}` : x}
                </text>
              )}
            </g>
          );
        })}

        {/* Area fill */}
        {areaD && (
          <path
            d={areaD}
            fill={`url(#${gradId})`}
            clipPath={`url(#${clipId})`}
          />
        )}

        {/* Target dashed line (Ross 308) */}
        {visibleTargets.length > 1 && (
          <path
            d={linePath(visibleTargets)}
            fill="none"
            stroke={targetColor}
            strokeWidth="1.8"
            strokeDasharray="5,4"
            clipPath={`url(#${clipId})`}
            opacity="0.85"
          />
        )}

        {/* Actual solid line (Thick, vibrant, with glow filter) */}
        <path
          d={linePath(actualPts)}
          fill="none"
          stroke={`url(#stroke-${gradId})`}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          clipPath={`url(#${clipId})`}
          filter={`url(#glow-${gradId})`}
        />

        {/* Actual points */}
        {actualPts.map((p, i) => {
          const isHovered = hoveredPoint?.x === p.x;
          return (
            <g key={i}>
              <circle
                cx={xS(p.x)}
                cy={yS(p.y)}
                r={isHovered ? "6.5" : "4.5"}
                fill="var(--surface-card)"
                stroke={color}
                strokeWidth={isHovered ? "2.5" : "2"}
                className="transition-all duration-150"
              />
              <circle
                cx={xS(p.x)}
                cy={yS(p.y)}
                r={isHovered ? "3" : "2"}
                fill={color}
              />
            </g>
          );
        })}

        {/* Last value label if not hovering */}
        {actualPts.length > 0 && !hoveredPoint && (() => {
          const lp = actualPts[actualPts.length - 1]!;
          return (
            <g>
              {/* fill-box origin: without it the ping scales from the SVG's
                  top-left corner and the ring drifts out of the chart */}
              <circle cx={xS(lp.x)} cy={yS(lp.y)} r="9" fill={color} opacity="0.2" className="animate-ping"
                style={{ transformBox: "fill-box", transformOrigin: "center" }} />
              <text
                x={xS(lp.x)}
                y={yS(lp.y) - 10}
                textAnchor="middle"
                fontSize="12"
                fill={color}
                fontFamily="JetBrains Mono, monospace"
                fontWeight="700"
              >
                {formatVal(lp.y)}
              </text>
            </g>
          );
        })()}

        {/* Interaction capture overlay covering full plot area */}
        <rect
          x={LEFT - 12}
          y={TOP}
          width={plotW + 24}
          height={plotH + 20}
          fill="transparent"
          style={{ pointerEvents: "all", cursor: "crosshair" }}
        />

        {/* Hover Crosshair & In-Chart Floating Tooltip */}
        {hoveredPoint && (() => {
          const hX = xS(hoveredPoint.x);
          const hY = yS(hoveredPoint.y);
          const tY = hoveredTarget ? yS(hoveredTarget.y) : null;
          const delta = hoveredTarget ? Number((hoveredPoint.y - hoveredTarget.y).toFixed(2)) : 0;
          const pctDelta = hoveredTarget && hoveredTarget.y > 0 ? ((delta / hoveredTarget.y) * 100).toFixed(1) : "0";
          const sign = delta >= 0 ? "+" : "";
          const deltaAmount =
            yLabel === "g" ? `${sign}${delta} g` : yLabel === "FCR" ? `${sign}${delta.toFixed(2)}` : `${sign}${Number(delta.toFixed(1))}`;
          const rows = [
            xLabel === "Day" ? tr("Day {x} Scan", { x: hoveredPoint.x }) : `${tr(xLabel)} ${hoveredPoint.x}`,
            tr("Actual: {value}", { value: formatVal(hoveredPoint.y) }),
            ...(hoveredTarget ? [`${tr(targetLabel)}: ${formatVal(hoveredTarget.y)}`, tr("Diff: {deltaAmount} ({sign}{pctDelta}%)", { deltaAmount, sign, pctDelta })] : []),
          ];
          // About 6.2px per character in the 10px monospace font, plus padding.
          const tipW = Math.min(Math.max(150, Math.ceil(Math.max(...rows.map((r) => r.length)) * 6.2) + 34), plotW - 8);
          const tipH = hoveredTarget ? 84 : 48;
          let tipX = hX - tipW / 2;
          if (tipX < LEFT + 4) tipX = LEFT + 4;
          if (tipX + tipW > LEFT + plotW - 4) tipX = LEFT + plotW - tipW - 4;
          let tipY = hY - tipH - 12;
          if (tipY < TOP + 4) tipY = hY + 14;

          return (
            <g className="pointer-events-none">
              {/* Vertical crosshair line (x-line) */}
              <line
                x1={hX}
                x2={hX}
                y1={TOP}
                y2={TOP + plotH}
                stroke={color}
                strokeWidth="1.5"
                strokeDasharray="4 3"
                opacity="0.9"
              />
              {/* Horizontal crosshair line (faint) */}
              <line
                x1={LEFT}
                x2={LEFT + plotW}
                y1={hY}
                y2={hY}
                stroke={color}
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.35"
              />
              {/* Target point indicator if present */}
              {hoveredTarget && tY !== null && (
                <circle
                  cx={hX}
                  cy={tY}
                  r="4.5"
                  fill="var(--surface-card)"
                  stroke={targetColor}
                  strokeWidth="2"
                />
              )}
              {/* Pulsing ring on actual point */}
              <circle cx={hX} cy={hY} r="12" fill={color} opacity="0.22" className="animate-pulse" />
              <circle cx={hX} cy={hY} r="7" fill="var(--surface-card)" stroke={color} strokeWidth="2.5" />
              <circle cx={hX} cy={hY} r="3.5" fill={color} />

              {/* Floating Tooltip Box */}
              <g transform={`translate(${tipX.toFixed(1)}, ${tipY.toFixed(1)})`}>
                <rect
                  width={tipW}
                  height={tipH}
                  rx="8"
                  fill="var(--surface-card)"
                  stroke="var(--border-strong)"
                  strokeWidth="1.2"
                  filter="drop-shadow(0 4px 14px rgba(0,0,0,0.6))"
                />
                <line x1="8" x2={tipW - 8} y1="1" y2="1" stroke={color} strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />
                <text
                  x="10"
                  y="17"
                  fontSize="11"
                  fontWeight="700"
                  fill="var(--text-primary)"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {rows[0]}
                </text>
                <circle cx="15" cy="31" r="3" fill={color} />
                <text
                  x="23"
                  y="34"
                  fontSize="10"
                  fontWeight="600"
                  fill="var(--text-primary)"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {rows[1]}
                </text>
                {hoveredTarget && (
                  <>
                    <circle cx="15" cy="48" r="3" fill={targetColor} />
                    <text
                      x="23"
                      y="51"
                      fontSize="10"
                      fontWeight="500"
                      fill="var(--text-secondary)"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {rows[2]}
                    </text>
                    <text
                      x="23"
                      y="68"
                      fontSize="10"
                      fontWeight="700"
                      fill={delta >= 0 ? "var(--status-green)" : "var(--status-amber)"}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {rows[3]}
                    </text>
                  </>
                )}
              </g>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

/* ── Donut Chart ───────────────────────────────────────────────
 * No legend: point at a segment (or focus it with the keyboard, or tap it) and
 * a small card lists every slice, with the one you are on highlighted. The
 * centre shows the slice you are on, or the biggest one when idle. */
function DonutChart({
  segments,
  unit = tr("birds"),
}: {
  segments: { label: string; value: number; color: string }[];
  unit?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // The slice in use, and where the card goes (pixels inside the wrapper).
  const [active, setActive] = useState<{ label: string; x: number; y: number } | null>(null);

  // A tap on a touch screen keeps the card up; tapping anywhere else closes it.
  useEffect(() => {
    if (!active) return;
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setActive(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [active]);

  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  const CX = 100, CY = 100, R = 72, r = 48;
  const rows = segments.map((seg) => ({ ...seg, pct: Math.round((seg.value / total) * 100) }));
  const biggest = rows.reduce((a, b) => (b.value > a.value ? b : a));

  let cumAngle = -Math.PI / 2;
  const arcs = rows.filter((s) => s.value > 0).map((seg) => {
    const angle = (seg.value / total) * 2 * Math.PI;
    const startA = cumAngle, endA = cumAngle + angle;
    cumAngle = endA;
    const largeArc = angle > Math.PI ? 1 : 0;
    const x1 = CX + R * Math.cos(startA), y1 = CY + R * Math.sin(startA);
    const x2 = CX + R * Math.cos(endA),   y2 = CY + R * Math.sin(endA);
    const ix1 = CX + r * Math.cos(endA),  iy1 = CY + r * Math.sin(endA);
    const ix2 = CX + r * Math.cos(startA),iy2 = CY + r * Math.sin(startA);
    const mid = (startA + endA) / 2, midR = (R + r) / 2;
    return {
      ...seg,
      mid: { x: CX + midR * Math.cos(mid), y: CY + midR * Math.sin(mid) },
      d: `M${x1},${y1} A${R},${R} 0 ${largeArc},1 ${x2},${y2} L${ix1},${iy1} A${r},${r} 0 ${largeArc},0 ${ix2},${iy2} Z`,
    };
  });

  const shown = rows.find((row) => row.label === active?.label) ?? biggest;

  // Where the card sits: beside the pointer, kept inside the wrapper.
  const TIP_W = 196, TIP_H = 104;
  const wrapBox = wrapRef.current?.getBoundingClientRect();
  const tipLeft = active && wrapBox ? Math.max(0, Math.min(active.x + 14, wrapBox.width - TIP_W)) : 0;
  const tipTop = active && wrapBox ? (active.y + 14 + TIP_H > wrapBox.height ? Math.max(0, active.y - TIP_H - 10) : active.y + 14) : 0;

  const atPointer = (label: string, e: { clientX: number; clientY: number }) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (box) setActive({ label, x: e.clientX - box.left, y: e.clientY - box.top });
  };
  // For the keyboard: put the card on the slice itself.
  const atSlice = (label: string, mid: { x: number; y: number }) => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    const svg = svgRef.current?.getBoundingClientRect();
    if (!wrap || !svg) return;
    const k = svg.width / 200;
    setActive({ label, x: svg.left - wrap.left + mid.x * k, y: svg.top - wrap.top + mid.y * k });
  };

  return (
    <div ref={wrapRef} className="relative mx-auto w-full max-w-[240px]">
      <svg
        ref={svgRef}
        viewBox="0 0 200 200"
        className="w-full"
        role="group"
        aria-label={tr("Breakdown of {total} {unit}. Focus or tap a segment for details.", { total, unit })}
      >
        {arcs.map((arc) => {
          const on = active?.label === arc.label;
          return (
            <path
              key={arc.label}
              d={arc.d}
              fill={arc.color}
              opacity={active ? (on ? 1 : 0.4) : 0.9}
              stroke={on ? "var(--text-primary)" : "none"}
              strokeWidth="1.5"
              tabIndex={0}
              role="img"
              aria-label={`${arc.label}: ${arc.value} ${unit}, ${arc.pct}%`}
              className="cursor-pointer outline-none transition-opacity duration-150"
              onPointerEnter={(e) => atPointer(arc.label, e)}
              onPointerMove={(e) => e.pointerType === "mouse" && atPointer(arc.label, e)}
              onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
              onPointerDown={(e) => e.pointerType !== "mouse" && atPointer(arc.label, e)}
              onFocus={() => atSlice(arc.label, arc.mid)}
              onBlur={() => setActive(null)}
            />
          );
        })}
        <circle cx={CX} cy={CY} r={r - 2} fill="var(--surface-sunken)" pointerEvents="none" />
        <text x={CX} y={CY - 8} textAnchor="middle" fontSize="22" fontWeight="800" pointerEvents="none"
          fill="var(--text-primary)" fontFamily="JetBrains Mono, monospace">{shown.pct}%</text>
        <text x={CX} y={CY + 10} textAnchor="middle" fontSize="9" fontWeight="600" pointerEvents="none"
          fill="var(--text-tertiary)" letterSpacing="1">{shown.label.toUpperCase()}</text>
      </svg>

      {active && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-card)] p-2 shadow-lg"
          style={{ left: tipLeft, top: tipTop, width: TIP_W }}
        >
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-1"
              style={{ background: row.label === active.label ? "var(--surface-raised)" : "transparent" }}
            >
              <span className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} />
                {row.label}
              </span>
              <span className="font-mono text-xs font-bold tabular-nums" style={{ color: row.color }}>
                {row.value} {unit} · {row.pct}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Flock Weight Distribution ──────────────────────────────────
 * Every number here is worked out from the bird list and the breed standard
 * for the chosen day, so the bars, the cohort split, the uniformity score and
 * the header chip always agree, and they move when the day does. */

/** A tinted version of a colour that may be a CSS variable (hex-suffix tricks do not work on those). */
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** Share of birds within ±10% of the flock median, the Ross 308 uniformity check. */
function flockUniformity(flock: FlockWeights) {
  const median = flock.medianG ?? flock.avgG ?? 0;
  const lower = median * 0.9;
  const upper = median * 1.1;
  const within = flock.birds.filter((b) => b.weightG >= lower && b.weightG <= upper).length;
  const pct = flock.birds.length ? Math.round((within / flock.birds.length) * 100) : 0;
  const grade =
    pct >= 85
      ? { letter: "A", label: tr("High Consistency"), color: "var(--cv-accent)" }
      : pct >= 75
        ? { letter: "B", label: tr("Moderate Consistency"), color: "var(--status-amber)" }
        : { letter: "C", label: tr("Low Consistency"), color: "var(--status-red)" };
  return { median, lower, upper, within, pct, ...grade };
}

function UniformityChip({ flock }: { flock: FlockWeights }) {
  const u = flockUniformity(flock);
  return (
    <span
      className="rounded-full px-2.5 py-1 font-mono text-xs font-semibold"
      style={{ background: tint(u.color, 12), color: u.color, border: `1px solid ${tint(u.color, 25)}` }}
    >{tr("Uniformity: {pct}% · {label}", { pct: u.pct, label: u.label })}</span>
  );
}

/** The six brackets, as shares of the breed standard for the day (so they mean the same on Day 16 and Day 40). */
const WEIGHT_BINS = [
  { id: "b1", from: 0,                to: 0.85,            statusText: T("At-Risk"),       color: "var(--status-red)" },
  { id: "b2", from: 0.85,             to: UNDERWEIGHT_RATIO, statusText: T("Monitor"),       color: "var(--status-amber)" },
  { id: "b3", from: UNDERWEIGHT_RATIO, to: 1,               statusText: T("Optimal"),       color: "var(--brand)" },
  { id: "b4", from: 1,                to: 1.08,            statusText: T("On Standard"),   color: "var(--brand)" },
  { id: "b5", from: 1.08,             to: HEAVY_RATIO,     statusText: T("Optimal High"),  color: "var(--brand)" },
  { id: "b6", from: HEAVY_RATIO,      to: Infinity,        statusText: T("Heavy"),         color: "var(--status-blue)" },
];

function FlockWeightDistribution({ flock }: { flock: FlockWeights }) {
  const [hoveredBinId, setHoveredBinId] = useState<string | null>(null);
  // A short pause before a row reacts, so sweeping the pointer down the list does not make the rows flash one after another.
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverBin = (id: string | null) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoveredBinId(id), id === null ? 160 : 110);
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const broilers = flock.birds;
  const totalBirds = broilers.length;
  const stdG = flock.standardG ?? 0;
  const u = flockUniformity(flock);
  const lightest = broilers.reduce((a, b) => (b.weightG < a.weightG ? b : a));
  const heaviest = broilers.reduce((a, b) => (b.weightG > a.weightG ? b : a));
  const minWeight = lightest.weightG;
  const maxWeight = heaviest.weightG;
  const medianDelta = Math.round(u.median - stdG);

  const bins = WEIGHT_BINS.map((d) => {
    const lo = d.from * stdG;
    const hi = d.to * stdG;
    const birds = broilers.filter((b) => b.weightG >= lo && b.weightG < hi);
    const label =
      d.from === 0 ? `< ${fmtW(hi)}` : d.to === Infinity ? `≥ ${fmtW(lo)}` : rangeLabel(lo, hi);
    return { ...d, label, birds: birds.map((b) => b.id), count: birds.length };
  });
  const maxCount = Math.max(...bins.map((b) => b.count), 1);

  const underG = stdG * UNDERWEIGHT_RATIO;
  const heavyG = stdG * HEAVY_RATIO;
  const cohorts = [
    { label: tr("Target Cohort ({value})", { value: rangeLabel(underG, heavyG) }), count: broilers.filter((b) => b.weightG >= underG && b.weightG <= heavyG).length, color: "var(--brand)" },
    { label: tr("Underweight Cohort (< {value})", { value: fmtW(underG) }),         count: broilers.filter((b) => b.weightG < underG).length,                        color: "var(--status-amber)" },
    { label: tr("Heavy Tier (≥ {value})", { value: fmtW(heavyG) }),                 count: broilers.filter((b) => b.weightG > heavyG).length,                        color: "var(--status-blue)" },
  ];

  // Spread strip: min, median and max on one scale, with the ±10% band and the standard marked.
  const step = stdG < 1000 ? 25 : 50;
  const scaleLo = Math.floor((Math.min(minWeight, stdG) - step) / step) * step;
  const scaleHi = Math.ceil((Math.max(maxWeight, stdG) + step) / step) * step;
  const pos = (g: number) => Math.min(100, Math.max(0, ((g - scaleLo) / (scaleHi - scaleLo)) * 100));
  const markers = [
    { label: tr("Min"),    g: minWeight, color: "var(--status-amber)" },
    { label: tr("Median"), g: u.median,  color: "var(--brand)" },
    { label: tr("Max"),    g: maxWeight, color: "var(--status-blue)" },
  ];

  const stat = (
    label: string,
    value: string,
    color: string,
    tag: string,
    tagColor: string,
    sub: string,
  ) => (
    <div className="rounded-xl border p-4" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
      <p className="label-section text-xs">{label}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-2xl font-bold" style={{ color }}>{value}</span>
        <span className="rounded px-1.5 py-0.5 font-mono text-xs font-semibold" style={{ background: tint(tagColor, 15), color: tagColor }}>
          {tag}
        </span>
      </div>
      <p className="mt-1 text-xs" style={{ color: "var(--text-tertiary)" }}>{sub}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat(tr("Lightest weighed"), `${minWeight} g`, "var(--status-amber)", lightest.id, "var(--status-red)", tr("Lightest bird"))}
        {stat(tr("Flock Median"), `${u.median} g`, "var(--brand)", `${medianDelta >= 0 ? "+" : ""}${medianDelta} g`, "var(--brand)", tr("Ross 308 standard: {std} g", { std: stdG.toLocaleString() }))}
        {stat(tr("Heaviest weighed"), `${maxWeight} g`, "var(--status-blue)", heaviest.id, "var(--status-blue)", tr("Heaviest bird"))}
        {stat(tr("Flock Uniformity"), `${u.pct}%`, u.color, tr("Grade {letter}", { letter: u.letter }), u.color, tr("{within}/{total} within ±10% of median", { within: u.within, total: totalBirds }))}
      </div>

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        {/* Bars: the rows share the card height, so they fill it */}
        <div className="flex flex-col justify-between gap-1 lg:col-span-7">
          {bins.map((bin) => {
            const isHovered = hoveredBinId === bin.id;
            const pct = Math.round((bin.count / totalBirds) * 100);
            const fillWidth = bin.count === 0 ? 0 : Math.max((bin.count / maxCount) * 100, 4);

            return (
              <div
                key={bin.id}
                onMouseEnter={() => hoverBin(bin.id)}
                onMouseLeave={() => hoverBin(null)}
                className="cursor-default rounded-lg border px-3 py-2 transition-[background-color,border-color] duration-500 ease-out motion-reduce:transition-none"
                style={{
                  background: isHovered ? tint(bin.color, 8) : "transparent",
                  borderColor: isHovered ? tint(bin.color, 40) : "transparent",
                }}
              >
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {bin.label}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{ background: tint(bin.color, 14), color: bin.color, border: `1px solid ${tint(bin.color, 35)}` }}
                    >
                      {tr(bin.statusText)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-sm">
                    <span className="font-bold" style={{ color: bin.color }}>
                      {bin.count} {bin.count === 1 ? tr("bird") : tr("birds")}
                    </span>
                    <span className="tabular-nums text-xs" style={{ color: "var(--text-tertiary)" }}>({pct}%)</span>
                  </div>
                </div>

                <div className="relative h-5 overflow-hidden rounded-md" style={{ background: "var(--surface-raised)" }}>
                  <div
                    className="absolute inset-y-0 left-0 rounded-md transition-[width] duration-500 ease-out motion-reduce:transition-none"
                    style={{
                      width: `${fillWidth}%`,
                      background: `linear-gradient(90deg, ${tint(bin.color, 35)} 0%, ${bin.color} 100%)`,
                    }}
                  />
                </div>

                {/* The bird IDs open and close gently instead of popping in and pushing the rows around */}
                {bin.birds.length > 0 && (
                  <div
                    className="grid transition-[grid-template-rows,opacity] duration-500 ease-out motion-reduce:transition-none"
                    style={{ gridTemplateRows: isHovered ? "1fr" : "0fr", opacity: isHovered ? 1 : 0 }}
                    aria-hidden={!isHovered}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="flex flex-wrap items-center gap-1.5 pt-1.5 font-mono text-xs">
                        <span style={{ color: "var(--text-tertiary)" }}>{tr("Bird IDs:")}</span>
                        {bin.birds.map((id) => (
                          <span key={id} className="rounded px-1.5 py-0.5 font-bold" style={{ color: bin.color, background: tint(bin.color, 12) }}>
                            {id}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right: uniformity, cohorts and the weight spread */}
        <div
          className="flex flex-col gap-5 rounded-xl border p-5 lg:col-span-5"
          style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}
        >
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="label-section text-xs">{tr("Uniformity Index")}</span>
              <span className="flex items-center gap-1 font-mono text-sm font-bold" style={{ color: u.color }}>
                <CheckCircle2 className="h-4 w-4" /> {tr("Grade")} {u.letter}
              </span>
            </div>
            <div className="mb-1.5 flex justify-between font-mono text-sm">
              <span style={{ color: "var(--text-tertiary)" }}>{tr("Cohort Consistency")}</span>
              <span className="font-bold" style={{ color: u.color }}>{u.pct}%</span>
            </div>
            <div className="relative h-3 overflow-hidden rounded-full" style={{ background: "var(--surface-raised)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${u.pct}%`, background: `linear-gradient(90deg, ${tint(u.color, 45)} 0%, ${u.color} 100%)` }}
              />
              {/* the 85% line a processing line asks for */}
              <div className="absolute inset-y-0 w-px" style={{ left: "85%", background: "var(--text-secondary)" }} />
            </div>
            <p className="mt-1.5 text-xs" style={{ color: "var(--text-tertiary)" }}>
              {tr("Ross 308 threshold: >85% (marked) for uniform processing line yield.")}
            </p>
          </div>

          <div className="space-y-2.5 border-t pt-4" style={{ borderColor: "var(--border-subtle)" }}>
            {cohorts.map((c) => (
              <div key={c.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                  {c.label}
                </span>
                <span className="font-mono font-bold" style={{ color: c.color }}>
                  {c.count} {c.count === 1 ? tr("bird") : tr("birds")} ({Math.round((c.count / totalBirds) * 100)}%)
                </span>
              </div>
            ))}
          </div>

          <div className="border-t pt-4" style={{ borderColor: "var(--border-subtle)" }}>
            <p className="label-section text-xs">{tr("Weight Spread")}</p>
            <div className="relative mt-8 h-3 rounded-full" style={{ background: "var(--surface-raised)" }}>
              <div
                className="absolute inset-y-0 rounded-full"
                style={{
                  left: `${pos(u.lower)}%`,
                  width: `${pos(u.upper) - pos(u.lower)}%`,
                  background: tint("var(--cv-accent)", 25),
                }}
              />
              <div className="absolute -bottom-1 -top-1 w-px" style={{ left: `${pos(stdG)}%`, background: "var(--status-amber)" }} />
              <span
                className="absolute -top-6 -translate-x-1/2 whitespace-nowrap font-mono text-xs"
                style={{ left: `${pos(stdG)}%`, color: "var(--status-amber)" }}
              >{tr("Std {stdG} g", { stdG: stdG.toLocaleString() })}</span>
              {markers.map((m) => (
                <span
                  key={m.label}
                  className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                  style={{ left: `${pos(m.g)}%`, background: m.color, borderColor: "var(--surface-sunken)" }}
                />
              ))}
            </div>
            <div className="relative mt-2 h-9">
              {markers.map((m) => (
                <div
                  key={m.label}
                  className="absolute -translate-x-1/2 text-center font-mono leading-tight"
                  style={{ left: `${pos(m.g)}%` }}
                >
                  <p className="text-xs uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>{m.label}</p>
                  <p className="text-xs font-bold" style={{ color: m.color }}>{m.g} g</p>
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text-tertiary)" }}>{tr("Shaded band: ±10% of the median, {Math}–{Math2} g.", { Math: Math.round(u.lower), Math2: Math.round(u.upper) })}</p>
          </div>

          <p className="mt-auto border-t pt-4 text-xs leading-relaxed" style={{ borderColor: "var(--border-subtle)", color: "var(--text-tertiary)" }}>{tr("High flock uniformity correlates with balanced feeder access and consistent meat harvest margins at Day {endDay}.", { endDay: flock.endDay })}</p>
        </div>
      </div>
    </div>
  );
}

/* ── Range Bar ───────────────────────────────────────────────── */
/* ── Stat Card ───────────────────────────────────────────────── */
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="cb-card px-4 py-4 flex flex-col gap-1">
      <p className="label-section">{label}</p>
      <p className="font-mono text-lg font-bold leading-none mt-1" style={{ color: accent ?? "var(--cv-accent)" }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{sub}</p>}
    </div>
  );
}

/** A small "i" button on a figure. It opens a note saying what the figure measures, how, and where the number comes from. */
function Basis({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="tap -m-1 shrink-0 rounded-full p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
          aria-label={tr("How {title} is worked out", { title })}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2 border-[var(--border-default)] bg-[var(--surface-card)] p-3 text-xs leading-relaxed text-[var(--text-secondary)]">
        <p className="font-semibold text-[var(--text-primary)]">{tr("How {title} is worked out", { title })}</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The last readings of one sensor: a filled line in the sensor's own colour, the optimal range as a
 * dashed band with its limits on the left, the first and last day underneath, and a readout when a
 * point is hovered or touched.
 */
function MiniTrend({ values, labels, min, max, color, unit }: { values: number[]; labels: string[]; min: number; max: number; color: string; unit: string }) {
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  const pad = (Math.max(max, ...values) - Math.min(min, ...values)) * 0.12 || 1;
  const lo = Math.min(min, ...values) - pad;
  const hi = Math.max(max, ...values) + pad;
  const px = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const py = (v: number) => (1 - (v - lo) / (hi - lo)) * 100;
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(2)},${py(v).toFixed(2)}`).join(" ");
  const area = `${line} L${px(n - 1).toFixed(2)},100 L${px(0).toFixed(2)},100 Z`;
  const shown = hover ?? n - 1;
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover(Math.round(t * (n - 1)));
  };
  return (
    <div>
      <div className="flex gap-1.5">
        <div className="relative w-7 shrink-0 font-mono text-xs tabular-nums text-right" style={{ color: "var(--text-tertiary)" }} aria-hidden="true">
          <span className="absolute right-0 -translate-y-1/2" style={{ top: `${py(max)}%` }}>{max}</span>
          <span className="absolute right-0 -translate-y-1/2" style={{ top: `${py(min)}%` }}>{min}</span>
        </div>
        <div
          className="relative h-20 min-w-0 flex-1 touch-none cursor-crosshair"
          onPointerMove={move}
          onPointerDown={move}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`${values.map((v) => v + unit).join(", ")}`}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            <defs>
              <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.38" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <rect x="0" y={py(max)} width="100" height={Math.max(1, py(min) - py(max))} fill={color} opacity="0.1" />
            {[max, min].map((edge) => (
              <line key={edge} x1="0" x2="100" y1={py(edge)} y2={py(edge)} stroke={color} strokeOpacity="0.45" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={area} fill={`url(#${gid})`} />
            <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {hover !== null && <line x1={px(hover)} x2={px(hover)} y1="0" y2="100" stroke={color} strokeOpacity="0.5" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          </svg>
          {values.map((v, i) => (
            <span
              key={i}
              className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: `${px(i)}%`, top: `${py(v)}%`, background: color, opacity: i === shown ? 1 : 0.55 }}
            />
          ))}
          <span
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
            style={{ left: `${px(shown)}%`, top: `${py(values[shown]!)}%`, borderColor: color, background: tint(color, 25) }}
          />
          {hover !== null && (
            <span
              className="pointer-events-none absolute z-10 -translate-y-full whitespace-nowrap rounded-md border px-1.5 py-0.5 font-mono text-xs font-bold shadow-md"
              style={{
                left: `${Math.min(80, Math.max(20, px(hover)))}%`,
                top: `${Math.max(0, py(values[hover]!) - 12)}%`,
                transform: "translate(-50%, -100%)",
                background: "var(--surface-card)",
                borderColor: "var(--border-default)",
                color,
              }}
            >
              {labels[hover]} · {values[hover]}{unit}
            </span>
          )}
        </div>
      </div>
      <div className="mt-1 flex justify-between pl-[34px] font-mono text-xs" style={{ color: "var(--text-tertiary)" }} aria-hidden="true">
        <span>{labels[0]}</span>
        <span>{n > 1 ? labels[n - 1] : ""}</span>
      </div>
    </div>
  );
}

/** A value range that hugs the data (so a small change shows), in whole steps. Returns the range and how many ticks fit. */
function fitRange(values: number[], step: number): { domain: [number, number]; ticks: number } {
  let st = step;
  for (;;) {
    const lo = Math.round((Math.floor(Math.min(...values) / st) - 1) * st * 1000) / 1000;
    const hi = Math.round((Math.ceil(Math.max(...values) / st) + 1) * st * 1000) / 1000;
    const ticks = Math.round((hi - lo) / st) + 1;
    if (ticks <= 7) return { domain: [lo, hi], ticks };
    st *= 2;
  }
}

/* ── Chart Legend ────────────────────────────────────────────── */
function ChartLegend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs" style={{ color: "var(--text-tertiary)" }}>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {item.dashed
            ? <span className="block h-0 w-6 border-t-2 border-dashed" style={{ borderColor: item.color }} />
            : <span className="h-2.5 w-6 rounded-sm" style={{ background: item.color }} />}
          {item.label}
        </span>
      ))}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────── */
function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>("growth");
  const [growthRange, setGrowthRange] = useState<"to-date" | "full">("to-date");
  const [activeHoverPoint, setActiveHoverPoint] = useState<{ x: number; y: number; targetY?: number } | null>(null);

  // The overview (cycle, standard, measured weights) and the weights typed in for the newest day that has any.
  const analytics = Route.useLoaderData() as any;
  const [spread, setSpread] = useState<WeightSpread>(NO_SPREAD);
  useEffect(() => {
    void fetchWeightSpread().then(setSpread);
  }, []);
  const flock = useMemo(() => buildFlockWeights(analytics, spread), [analytics, spread]);
  const { day, startDay, endDay } = flock;

  // The measured days only; a day nobody weighed has no point. The dashed line is the breed standard for every day.
  const actualSeries = ((analytics?.weight?.curve ?? []) as { day: number; actualG: number }[])
    .filter((p) => p.actualG > 0)
    .map((p) => ({ x: p.day, y: p.actualG }));
  const targetSeries = ((analytics?.weight?.standardCurve ?? []) as { day: number; standardG: number }[]).map((p) => ({ x: p.day, y: p.standardG }));
  // The pen's air, from the DHT22 on the camera computer (stored once a minute), and the live behavior monitor.
  const [history, setHistory] = useState<SensorHistory | null>(null);
  const [monitor, setMonitor] = useState<LiveBehavior | null>(null);
  useEffect(() => {
    let stop = false;
    void fetchSensorHistory(7).then((h) => !stop && setHistory(h));
    void fetchLiveBehavior(false).then((b) => !stop && setMonitor(b));
    return () => {
      stop = true;
    };
  }, []);
  const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(localeTag(), { month: "short", day: "numeric" });
  const envSensors = [
    { title: tr("Temperature"), days: history?.temperature ?? [], min: 20, max: 32, unit: "°C", digits: 1, color: "var(--sensor-temp)" },
    { title: tr("Humidity"), days: history?.humidity ?? [], min: 50, max: 70, unit: "%", digits: 0, color: "var(--sensor-humidity)" },
  ];
  const monitorOn = monitor?.running ? monitor : null;
  const monitorBirds = monitorOn?.birds ?? 0;
  const monitorStill = monitorOn?.flock_inactive ? monitorBirds : (monitorOn?.inactive?.length ?? 0);
  const monitorHuddled = monitorOn?.huddle?.birds ?? 0;
  const monitorActive = Math.max(0, monitorBirds - monitorStill - monitorHuddled);

  // To Date: the start day up to today (at least a week wide, so the first day still has a line).
  // Full Cycle: the start day to the last day, with the target running ahead of the flock.
  const displayedActualSeries = actualSeries;
  const displayedTargetSeries = targetSeries;
  const domainX: [number, number] = growthRange === "full" ? [startDay, endDay] : [startDay, Math.min(endDay, Math.max(day, startDay + 7))];
  const harvestG = flock.projectedHarvestG;
  // "Day 16–23", or just "Day 16" on the day the window starts.
  const toDate = day > startDay ? tr("Day {startDay}–{day}", { startDay, day }) : tr("Day {day}", { day });
  const avgW = analytics?.weight?.actualAvgG != null ? Number(analytics.weight.actualAvgG) : null;
  const stdW = analytics?.weight?.standardG != null ? Number(analytics.weight.standardG) : null;
  const variancePercent = analytics?.weight?.variancePercent != null ? Number(analytics.weight.variancePercent) : null;
  const measuredDay = analytics?.weight?.measuredDay != null ? Number(analytics.weight.measuredDay) : null;
  const wDelta = avgW !== null && stdW !== null ? avgW - stdW : null;
  const signedVariance = variancePercent === null ? "—" : `${variancePercent >= 0 ? "+" : ""}${variancePercent.toFixed(1)}%`;
  const varianceColor =
    variancePercent === null ? "var(--text-tertiary)" : variancePercent >= 0 ? "var(--status-green)" : variancePercent > -5 ? "var(--status-amber)" : "var(--status-red)";
  const facilityName: string = analytics?.facility?.name ?? "";
  const houseLabel: string = analytics?.cluster?.houseLabel ?? "";

  const tabs: { id: Tab; label: string }[] = [
    { id: "growth",     label: tr("Weight Growth")   },
    { id: "conditions", label: tr("Flock Conditions") },
  ];

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>{tr("Analytics")}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          {facilityName && <span className="font-semibold" style={{ color: "var(--brand)" }}>{facilityName}</span>}
          {facilityName && houseLabel ? " · " : ""}{houseLabel}{tr(" · Day ")}
          <span className="font-mono font-bold" style={{ color: "var(--cv-accent)" }}>{day}</span>
          {` / ${endDay} `}
          <span style={{ color: "var(--text-tertiary)" }}>{tr("({Math}% of grow-out)", { Math: Math.round((day / endDay) * 100) })}</span>
        </p>
      </div>

      {/* Tabs */}
      {/* max-w-full lets the strip scroll sideways on phones instead of
          pushing the page wider than the screen */}
      <div className="mb-6 flex gap-1 w-fit max-w-full rounded-xl p-1 overflow-x-auto"
        style={{ background: "var(--surface-card)", border: "1px solid var(--border-subtle)" }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className="tap shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-all duration-150 sm:px-4"
            style={tab === t.id
              ? { background: "var(--brand)", color: "var(--text-inverse)", boxShadow: "0 1px 4px rgba(0,0,0,0.25)" }
              : { color: "var(--text-secondary)" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── WEIGHT GROWTH ── */}
      {tab === "growth" && (
        <div className="space-y-5">
          {/* Compiled as 1: Unified Telemetry KPIs & Full-Width Flock Growth Trajectory */}
          <div className="cb-card p-5 space-y-4">
            {/* Top Stat Strip: 4 Telemetry KPIs compiled into 1 cohesive row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl p-3 border transition-all duration-150"
                style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
                <p className="label-section text-xs">{tr("Avg Weight")}</p>
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
                  <span className="font-mono text-lg font-bold" style={{ color: "var(--cv-accent)" }}>{avgW !== null ? tr("{value} kg", { value: (avgW / 1000).toFixed(3) }) : "—"}</span>
                  {measuredDay !== null && <span className="text-xs font-mono px-1.5 py-0.2 rounded" style={{ background: "rgba(163, 230, 53, 0.15)", color: "var(--cv-accent)" }}>{tr("Day {day}", { day: measuredDay })}</span>}
                </div>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{avgW !== null && measuredDay !== null ? tr("{avgW} g · Day {day}", { avgW, day: measuredDay }) : tr("No weights typed in yet")}</p>
              </div>

              <div className="rounded-xl p-3 border transition-all duration-150"
                style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
                <p className="label-section text-xs">{tr("vs Ross 308")}</p>
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
                  <span className="font-mono text-lg font-bold" style={{ color: varianceColor }}>
                    {wDelta !== null ? `${wDelta >= 0 ? "+" : ""}${wDelta} g` : "—"}
                  </span>
                  {variancePercent !== null && (
                    <span className="text-xs font-mono px-1.5 py-0.2 rounded" style={{ background: tint(varianceColor, 15), color: varianceColor }}>
                      {signedVariance}
                    </span>
                  )}
                </div>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{variancePercent !== null ? tr("{Math}% {value} standard", { Math: Math.abs(variancePercent), value: variancePercent >= 0 ? tr("above") : tr("below") }) : tr("Needs a weighed bird")}</p>
              </div>

              <div className="rounded-xl p-3 border transition-all duration-150"
                style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
                <p className="label-section text-xs">{tr("Birds Weighed")}</p>
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
                  <span className="font-mono text-lg font-bold" style={{ color: "var(--status-blue)" }}>
                    {flock.birds.length}{flock.population ? ` / ${flock.population}` : ""}
                  </span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{tr("Typed in on Flock Tracking")}</p>
              </div>

              <div className="rounded-xl p-3 border transition-all duration-150"
                style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
                <p className="label-section text-xs">{tr("Spread")}</p>
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
                  <span className="font-mono text-lg font-bold" style={{ color: "var(--brand)" }}>
                    {flock.sdG !== null ? `±${flock.sdG} g` : "—"}
                  </span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{flock.sdG !== null ? tr("Standard deviation of the weights") : tr("Needs two weighed birds")}</p>
              </div>
            </div>

            {/* Subtle Divider */}
            <div className="h-px w-full" style={{ background: "var(--border-subtle)" }} />

            {/* Growth Trajectory Section */}
            <div>
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                      {growthRange === "to-date" ? tr("Flock Growth Trajectory ({toDate})", { toDate }) : tr("Full Cycle Growth Curve (Day {startDay}–{endDay})", { startDay, endDay })}
                    </h2>
                    <span className="font-mono text-xs px-2.5 py-0.5 rounded-full font-semibold"
                      style={{
                        background: tint(varianceColor, 12),
                        color: varianceColor,
                        border: `1px solid ${tint(varianceColor, 30)}`,
                      }}>
                      {growthRange === "to-date"
                        ? tr("{signedVariance} vs Standard", { signedVariance })
                        : tr("Day {endDay} Harvest: {value} kg", { endDay, value: harvestG ? (harvestG / 1000).toFixed(2) : "—" })}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {growthRange === "to-date"
                      ? tr("Hover or tap along the curve to inspect daily weight, standard variance, and growth gain.")
                      : tr("Day {startDay} to Day {endDay} projection with the Ross 308 standard target benchmark.", { startDay, endDay })}
                  </p>
                </div>

                <div className="flex w-full items-center flex-wrap gap-3 sm:w-auto">
                  {/* Range Switcher */}
                  <div className="flex w-full rounded-lg p-0.5 border sm:w-auto"
                    style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
                    <button
                      onClick={() => setGrowthRange("to-date")}
                      className="tap flex-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 sm:flex-none"
                      style={growthRange === "to-date"
                        ? { background: "var(--brand)", color: "var(--text-inverse)", fontWeight: 600, boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }
                        : { color: "var(--text-secondary)" }}
                    >
                      {tr("{toDate} (To Date)", { toDate })}
                    </button>
                    <button
                      onClick={() => setGrowthRange("full")}
                      className="tap flex-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 sm:flex-none"
                      style={growthRange === "full"
                        ? { background: "var(--brand)", color: "var(--text-inverse)", fontWeight: 600, boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }
                        : { color: "var(--text-secondary)" }}
                    >
                      {tr("Day {startDay}–{endDay} (Full Cycle)", { startDay, endDay })}
                    </button>
                  </div>

                  {/* Live Hover Readout Pill */}
                  <div className="flex items-center gap-2 px-3 py-1 rounded-lg border font-mono text-xs"
                    style={{
                      background: "var(--surface-sunken)",
                      borderColor: activeHoverPoint ? "var(--brand)" : "var(--border-subtle)",
                      boxShadow: activeHoverPoint ? "0 0 10px rgba(52, 211, 153, 0.2)" : "none",
                      transition: "all 150ms ease",
                    }}>
                    <span style={{ color: "var(--text-tertiary)" }}>
                      {activeHoverPoint ? `D${activeHoverPoint.x}:` : tr("Latest (D{day}):", { day: measuredDay ?? day })}
                    </span>
                    <span className="font-bold text-sm" style={{ color: "var(--brand)" }}>
                      {activeHoverPoint
                        ? activeHoverPoint.y >= 1000 ? tr("{value} kg", { value: (activeHoverPoint.y / 1000).toFixed(2) }) : `${activeHoverPoint.y} g`
                        : avgW !== null ? tr("{value} kg", { value: (avgW / 1000).toFixed(2) }) : "—"}
                    </span>
                    {activeHoverPoint?.targetY !== undefined && (
                      <span className="font-semibold text-xs" style={{
                        color: activeHoverPoint.y >= activeHoverPoint.targetY ? "var(--status-green)" : "var(--status-amber)"
                      }}>{tr("({value}{value2}g vs Ross 308)", { value: activeHoverPoint.y >= activeHoverPoint.targetY ? "+" : "", value2: activeHoverPoint.y - activeHoverPoint.targetY })}</span>
                    )}
                  </div>

                  <ChartLegend items={[
                    { color: "var(--brand)", label: tr("Weighed (average)") },
                    { color: "var(--status-amber)", label: tr("Ross 308 Std"), dashed: true },
                  ]} />
                </div>
              </div>

              {displayedActualSeries.length > 0 ? (
                <AxisLineChart
                  series={displayedActualSeries}
                  targets={displayedTargetSeries}
                  domainX={domainX}
                  color="var(--brand)"
                  targetColor="var(--status-amber)"
                  height={260}
                  onHoverPoint={setActiveHoverPoint}
                />
              ) : (
                <p className="py-12 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
                  {tr("No weight readings yet for this flock.")}
                </p>
              )}
            </div>
          </div>

          <div className="cb-card p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{tr("Flock Weight Distribution")}</h2>
                {flock.birds.length > 0 && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{tr("Birds sorted into brackets of the Ross 308 standard for Day {day}, from the {total} birds weighed", { day: flock.measuredDay ?? day, total: flock.birds.length })}</p>
                )}
              </div>
              {flock.birds.length >= 5 && <UniformityChip flock={flock} />}
            </div>
            {flock.birds.length > 0 && flock.standardG ? (
              <FlockWeightDistribution flock={flock} />
            ) : (
              <p className="py-8 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
                {tr("No bird weights have been typed in yet. Weigh a few birds, type their weights on Flock Tracking, and the growth report appears here.")}
              </p>
            )}
          </div>

          <GrowthAnalysisSection flock={flock} />
        </div>
      )}

      {/* ── FLOCK CONDITIONS: only what is measured. Feed and ammonia have no sensor, so they are not shown. ── */}
      {tab === "conditions" && (
        <div className="space-y-6">
          <section aria-labelledby="cond-behavior" className="space-y-3">
            <h2 id="cond-behavior" className="label-section text-xs tracking-widest font-bold">{tr("Behavior")}</h2>
            <div className="cb-card p-5">
              {monitorOn ? (
                <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-8">
                  <div className="flex w-full max-w-[300px] flex-col items-center gap-3">
                    <h3 className="self-start text-base font-bold" style={{ color: "var(--text-primary)" }}>
                      {tr("Activity Classification, Current Scan")}
                    </h3>
                    <DonutChart segments={[
                      { label: tr("Active"),   value: monitorActive, color: "var(--status-green)" },
                      { label: tr("Inactive"), value: monitorStill,  color: "var(--status-red)" },
                      { label: tr("Huddling"), value: monitorHuddled, color: "var(--status-amber)" },
                    ]} />
                    <p className="text-center text-xs" style={{ color: "var(--text-tertiary)" }}>
                      {tr("Point at a segment, or tap it, for the breakdown.")}
                    </p>
                  </div>
                  <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
                    {[
                      { label: tr("Active"),   value: monitorActive, color: "var(--status-green)" },
                      { label: tr("Inactive"), value: monitorStill,  color: "var(--status-red)" },
                      { label: tr("Huddling"), value: monitorHuddled, color: "var(--status-amber)" },
                    ].map((row) => (
                      <li key={row.label} className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} aria-hidden="true" />
                        {row.label} {row.value}
                      </li>
                    ))}
                    <li className="basis-full text-center" style={{ color: "var(--text-tertiary)" }}>{tr("{n} birds followed by the live monitor.", { n: monitorBirds })}</li>
                  </ul>
                </div>
              ) : (
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                  {tr("Behavior monitoring is off. Turn it on at the camera computer (LIVE_BEHAVIOR=1) to see this.")}
                </p>
              )}
            </div>
          </section>

          <section aria-labelledby="cond-env" className="space-y-3">
            <h2 id="cond-env" className="label-section text-xs tracking-widest font-bold">{tr("Environment")}</h2>
            <div className="cb-card overflow-hidden">
              <div className="grid sm:grid-cols-2">
                {envSensors.map((env, i) => {
                  const last: SensorDay | undefined = env.days[env.days.length - 1];
                  const round = (v: number) => Number(v.toFixed(env.digits));
                  const ok = last ? last.avg >= env.min && last.avg <= env.max : true;
                  const tone = ok ? "var(--status-green)" : "var(--status-red)";
                  return (
                    <div
                      key={env.title}
                      className={`flex min-w-0 flex-col justify-center gap-2 px-5 py-4 ${i === 0 ? "border-b sm:border-b-0 sm:border-r" : ""}`}
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="label-section">{env.title}</p>
                        <Basis title={env.title}>
                          <p>{tr("The average of the readings the house sensor stored on each day. The shaded band on the line is the acceptable range ({min}–{max}{unit}); the line shows the days that have readings.", { min: env.min, max: env.max, unit: env.unit })}</p>
                          {last && <p>{ok ? tr("The reading is inside the range.") : tr("The reading is outside the range.")}</p>}
                        </Basis>
                      </div>
                      {last ? (
                        <>
                          <p className="font-mono text-lg font-bold leading-none" style={{ color: env.color }}>{round(last.avg)}{env.unit}</p>
                          <MiniTrend
                            values={env.days.map((d) => round(d.avg))}
                            labels={env.days.map((d) => dayLabel(d.day))}
                            min={env.min} max={env.max} color={env.color} unit={env.unit}
                          />
                          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                            {tr("Average on {date} · lowest {lo}{unit}, highest {hi}{unit}", { date: dayLabel(last.day), lo: round(last.min), hi: round(last.max), unit: env.unit })}
                          </p>
                          <p className="flex flex-wrap items-center gap-x-1.5 text-xs" style={{ color: "var(--text-tertiary)" }}>
                            <span className="inline-flex items-center gap-1 font-semibold" style={{ color: tone }}>
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} aria-hidden="true" />
                              {ok ? tr("Within range") : tr("Out of range")}
                            </span>
                            <span>· {tr("Optimal: {min}-{max}{unit}", { min: env.min, max: env.max, unit: env.unit })}</span>
                          </p>
                        </>
                      ) : (
                        <p className="text-xs leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                          {tr("No readings yet. The sensor on the camera computer saves one every minute once it is connected.")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
