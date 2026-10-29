import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState, useRef, useLayoutEffect, type ReactNode } from "react";
import { AppShell } from "@/components/farm/AppShell";
import { SampleBadge, SampleNotice } from "@/components/farm/SampleBadge";
import { getGrowthAnalytics } from "@/lib/farm/repository";
import { behaviorBreakdown } from "@/lib/farm/dataset";
import { HEAVY_RATIO, UNDERWEIGHT_RATIO, fmtW, rangeLabel, sampleForDay, type SampleFlock } from "@/lib/farm/sample";
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

export const Route = createFileRoute("/telemetry")({
  head: () => ({ meta: [{ title: "Analytics - Cerebroil" }] }),
  loader: () => getGrowthAnalytics(),
  component: AnalyticsPage,
});

type Tab = "growth" | "conditions";
type InsightLevel = "positive" | "warning" | "critical" | "info";
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
              fontSize="10"
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
          fontSize="10.5"
          fill="var(--text-tertiary)"
          fontWeight="600"
          transform={`rotate(-90, 10, ${TOP + plotH / 2})`}
        >
          {yLabel === "g" ? "Weight (g)" : yLabel}
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
                fontSize="10.5"
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
            xLabel === "Day" ? `Day ${hoveredPoint.x} Scan` : `${xLabel} ${hoveredPoint.x}`,
            `Actual: ${formatVal(hoveredPoint.y)}`,
            ...(hoveredTarget ? [`${targetLabel}: ${formatVal(hoveredTarget.y)}`, `Diff: ${deltaAmount} (${sign}${pctDelta}%)`] : []),
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
  unit = "birds",
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
        aria-label={`Breakdown of ${total} ${unit}. Focus or tap a segment for details.`}
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

/** The breed's weight on the last day, carried by how far ahead or behind the flock is now. */
function projectedHarvestG(sample: SampleFlock): number | null {
  const last = sample.farm.weight.curve.find((p) => p.day === sample.endDay)?.standardG;
  return last ? Math.round((last * sample.farm.weight.actualAvgG) / sample.standardG) : null;
}

/** What to do about feed on this day of the grow-out (usual stages: grower, then finisher, then withdrawal before catching). */
function feedAdvice(day: number, endDay: number): string {
  if (day >= endDay - 3)
    return `Harvest is close (Day ${endDay}). Confirm the catching date and plan the pre-harvest feed withdrawal with the farm manager. Keep drinking water available.`;
  if (day >= 25)
    return `Finisher feed is in use at Day ${day}. Feed conversion naturally rises with age, so keep checking it against the target and look for feed wastage.`;
  return `Grower feed is in use at Day ${day}. Plan the switch to Finisher pellet feed around Day 25 and keep the feeders and drinkers adjusted to the birds' height.`;
}

/** Share of birds within ±10% of the flock median, the Ross 308 uniformity check. */
function flockUniformity(sample: SampleFlock) {
  const median = sample.farm.cohorts[0]?.medianG ?? sample.farm.weight.actualAvgG;
  const lower = median * 0.9;
  const upper = median * 1.1;
  const within = sample.broilers.filter((b) => b.weightG >= lower && b.weightG <= upper).length;
  const pct = Math.round((within / sample.broilers.length) * 100);
  const grade =
    pct >= 85
      ? { letter: "A", label: "High Consistency", color: "var(--cv-accent)" }
      : pct >= 75
        ? { letter: "B", label: "Moderate Consistency", color: "var(--status-amber)" }
        : { letter: "C", label: "Low Consistency", color: "var(--status-red)" };
  return { median, lower, upper, within, pct, ...grade };
}

function UniformityChip({ sample }: { sample: SampleFlock }) {
  const u = flockUniformity(sample);
  return (
    <span
      className="rounded-full px-2.5 py-1 font-mono text-xs font-semibold"
      style={{ background: tint(u.color, 12), color: u.color, border: `1px solid ${tint(u.color, 25)}` }}
    >
      Uniformity: {u.pct}% · {u.label}
    </span>
  );
}

/** The six brackets, as shares of the breed standard for the day (so they mean the same on Day 16 and Day 40). */
const WEIGHT_BINS = [
  { id: "b1", from: 0,                to: 0.85,            statusText: "At-Risk",       color: "var(--status-red)" },
  { id: "b2", from: 0.85,             to: UNDERWEIGHT_RATIO, statusText: "Monitor",       color: "var(--status-amber)" },
  { id: "b3", from: UNDERWEIGHT_RATIO, to: 1,               statusText: "Optimal",       color: "var(--brand)" },
  { id: "b4", from: 1,                to: 1.08,            statusText: "On Standard",   color: "var(--brand)" },
  { id: "b5", from: 1.08,             to: HEAVY_RATIO,     statusText: "Optimal High",  color: "var(--brand)" },
  { id: "b6", from: HEAVY_RATIO,      to: Infinity,        statusText: "Heavy",         color: "var(--status-blue)" },
];

function FlockWeightDistribution({ sample }: { sample: SampleFlock }) {
  const [hoveredBinId, setHoveredBinId] = useState<string | null>(null);

  const { broilers } = sample;
  const totalBirds = broilers.length;
  const stdG = sample.standardG;
  const u = flockUniformity(sample);
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
    { label: `Target Cohort (${rangeLabel(underG, heavyG)})`, count: broilers.filter((b) => b.weightG >= underG && b.weightG <= heavyG).length, color: "var(--brand)" },
    { label: `Underweight Cohort (< ${fmtW(underG)})`,         count: broilers.filter((b) => b.weightG < underG).length,                        color: "var(--status-amber)" },
    { label: `Heavy Tier (≥ ${fmtW(heavyG)})`,                 count: broilers.filter((b) => b.weightG > heavyG).length,                        color: "var(--status-blue)" },
  ];

  // Spread strip: min, median and max on one scale, with the ±10% band and the standard marked.
  const step = stdG < 1000 ? 25 : 50;
  const scaleLo = Math.floor((Math.min(minWeight, stdG) - step) / step) * step;
  const scaleHi = Math.ceil((Math.max(maxWeight, stdG) + step) / step) * step;
  const pos = (g: number) => Math.min(100, Math.max(0, ((g - scaleLo) / (scaleHi - scaleLo)) * 100));
  const markers = [
    { label: "Min",    g: minWeight, color: "var(--status-amber)" },
    { label: "Median", g: u.median,  color: "var(--brand)" },
    { label: "Max",    g: maxWeight, color: "var(--status-blue)" },
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
      <p className="label-section text-[11px]">{label}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-2xl font-bold" style={{ color }}>{value}</span>
        <span className="rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold" style={{ background: tint(tagColor, 15), color: tagColor }}>
          {tag}
        </span>
      </div>
      <p className="mt-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>{sub}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat("Min Scanned", `${minWeight} g`, "var(--status-amber)", lightest.id, "var(--status-red)", "Lightest bird")}
        {stat("Flock Median", `${u.median} g`, "var(--brand)", `${medianDelta >= 0 ? "+" : ""}${medianDelta} g`, "var(--brand)", `Ross 308 standard: ${stdG.toLocaleString()} g`)}
        {stat("Max Scanned", `${maxWeight} g`, "var(--status-blue)", heaviest.id, "var(--status-blue)", "Heaviest bird")}
        {stat("Flock Uniformity", `${u.pct}%`, u.color, `Grade ${u.letter}`, u.color, `${u.within}/${totalBirds} within ±10% of median`)}
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
                onMouseEnter={() => setHoveredBinId(bin.id)}
                onMouseLeave={() => setHoveredBinId(null)}
                className="cursor-default rounded-lg border px-3 py-2 transition-all duration-150"
                style={{
                  background: isHovered ? "var(--surface-sunken)" : "transparent",
                  borderColor: isHovered ? bin.color : "transparent",
                }}
              >
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {bin.label}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ background: tint(bin.color, 14), color: bin.color, border: `1px solid ${tint(bin.color, 35)}` }}
                    >
                      {bin.statusText}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-sm">
                    <span className="font-bold" style={{ color: bin.color }}>
                      {bin.count} {bin.count === 1 ? "bird" : "birds"}
                    </span>
                    <span className="tabular-nums text-xs" style={{ color: "var(--text-tertiary)" }}>({pct}%)</span>
                  </div>
                </div>

                <div className="relative h-5 overflow-hidden rounded-md" style={{ background: "var(--surface-raised)" }}>
                  <div
                    className="absolute inset-y-0 left-0 rounded-md transition-all duration-500"
                    style={{
                      width: `${fillWidth}%`,
                      background: `linear-gradient(90deg, ${tint(bin.color, 35)} 0%, ${bin.color} 100%)`,
                      boxShadow: isHovered ? `0 0 12px ${tint(bin.color, 40)}` : "none",
                    }}
                  />
                </div>

                {isHovered && bin.birds.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                    <span style={{ color: "var(--text-tertiary)" }}>Bird IDs:</span>
                    {bin.birds.map((id) => (
                      <span key={id} className="rounded px-1.5 py-0.5 font-bold" style={{ color: bin.color, background: tint(bin.color, 12) }}>
                        {id}
                      </span>
                    ))}
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
              <span className="label-section text-xs">Uniformity Index</span>
              <span className="flex items-center gap-1 font-mono text-sm font-bold" style={{ color: u.color }}>
                <CheckCircle2 className="h-4 w-4" /> Grade {u.letter}
              </span>
            </div>
            <div className="mb-1.5 flex justify-between font-mono text-sm">
              <span style={{ color: "var(--text-tertiary)" }}>Cohort Consistency</span>
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
            <p className="mt-1.5 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              Ross 308 threshold: &gt;85% (marked) for uniform processing line yield.
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
                  {c.count} {c.count === 1 ? "bird" : "birds"} ({Math.round((c.count / totalBirds) * 100)}%)
                </span>
              </div>
            ))}
          </div>

          <div className="border-t pt-4" style={{ borderColor: "var(--border-subtle)" }}>
            <p className="label-section text-xs">Weight Spread</p>
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
                className="absolute -top-6 -translate-x-1/2 whitespace-nowrap font-mono text-[11px]"
                style={{ left: `${pos(stdG)}%`, color: "var(--status-amber)" }}
              >
                Std {stdG.toLocaleString()} g
              </span>
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
                  <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>{m.label}</p>
                  <p className="text-xs font-bold" style={{ color: m.color }}>{m.g} g</p>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              Shaded band: ±10% of the median, {Math.round(u.lower)}–{Math.round(u.upper)} g.
            </p>
          </div>

          <p className="mt-auto border-t pt-4 text-xs leading-relaxed" style={{ borderColor: "var(--border-subtle)", color: "var(--text-tertiary)" }}>
            High flock uniformity correlates with balanced feeder access and consistent meat harvest margins at Day {sample.endDay}.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Diagnostics card: ready → processing → report ───────────────
 * The same card for Weight Growth and Flock Conditions. The caller supplies
 * the words and the report body; this owns the button, the progress and the
 * three states. */
function DiagnosticsCard({
  title,
  description,
  chips,
  buttonLabel,
  processingTitle,
  steps,
  reportTitle,
  evaluated,
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
  children: ReactNode;
}) {
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
            setProcessedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
          }, 250);
          return 100;
        }
        setStepIdx(Math.min(steps.length - 1, Math.floor((next / 100) * steps.length)));
        return next;
      });
    }, 130);
  };

  return (
    <div className="cb-card p-5">
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
            <div className="flex items-center gap-2 pt-1 flex-wrap font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
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
            <div className="flex justify-between font-mono text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              <span>Step {stepIdx + 1} of {steps.length}</span>
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
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                  Generated at {processedAt ?? "just now"} · {evaluated}
                </p>
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
              <span>Re-run Analysis</span>
            </button>
          </div>

          {children}
        </div>
      )}
    </div>
  );
}

/* ── Weight growth report ────────────────────────────────────── */
function GrowthAnalysisSection({
  sample,
  avgW,
  stdW,
  wDelta,
  optPct,
  wd,
  total,
  day,
  variancePercent,
}: {
  sample: SampleFlock;
  avgW: number;
  stdW: number;
  wDelta: number;
  optPct: number;
  wd: { Optimal: number; Underweight: number; Overweight: number };
  total: number;
  day: number;
  variancePercent: number;
}) {
  const { farm, broilers, endDay } = sample;
  const above = variancePercent >= 0;
  const signedVar = `${above ? "+" : ""}${variancePercent}%`;
  const sd = farm.cohorts[0]?.standardDeviationG ?? 0;
  const lightest = broilers.reduce((a, b) => (b.weightG < a.weightG ? b : a));
  const harvestG = projectedHarvestG(sample);
  const lo = fmtW(stdW * UNDERWEIGHT_RATIO);
  const hi = fmtW(stdW * HEAVY_RATIO);
  return (
    <DiagnosticsCard
      title="Automated Growth Diagnostics & Trajectory"
      description={`Run multi-factor AI diagnostic on current ${total}-bird depth-scan telemetry, Ross 308 standard variance, cohort uniformity, and feed efficiency projections for Day ${endDay} harvest.`}
      chips={[`${total} Scans Ready`, `Day ${day} Cohort`, "Ross 308 Benchmark", `FCR ${farm.feed.fcr} Correlation`]}
      buttonLabel="Process & Analyze Growth"
      processingTitle="Processing Telemetry & Growth Curves..."
      steps={[
        `Ingesting ${total} depth-scan weight and morphometric records...`,
        `Benchmarking flock curve against Ross 308 Day ${day} standards (${signedVar} delta)...`,
        "Evaluating cohort uniformity & clustering at drinker lines...",
        "Synthesizing actionable harvest yield projections...",
      ]}
      reportTitle="Flock Growth Diagnostic Report"
      evaluated={`${total} Broiler Depth-Scans Evaluated`}
    >
          {/* Diagnostic Key Takeaway Scorecards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
              <p className="label-section text-[10px]">Growth Trajectory</p>
              <p className="font-mono text-base font-bold mt-0.5" style={{ color: above ? "var(--status-green)" : variancePercent > -5 ? "var(--status-amber)" : "var(--status-red)" }}>{signedVar}</p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{above ? "Above" : "Below"} Ross 308 standard</p>
            </div>

            <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
              <p className="label-section text-[10px]">Optimal Band</p>
              <p className="font-mono text-base font-bold mt-0.5" style={{ color: "var(--brand)" }}>{optPct}%</p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{wd.Optimal} / {total} birds on target</p>
            </div>

            <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
              <p className="label-section text-[10px]">At-Risk Cohort</p>
              <p className="font-mono text-base font-bold mt-0.5" style={{ color: wd.Underweight > 0 ? "var(--status-amber)" : "var(--status-green)" }}>
                {wd.Underweight} {wd.Underweight === 1 ? "Bird" : "Birds"}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {wd.Underweight > 0 ? `${lightest.id} (${lightest.weightG.toLocaleString()} g) flagged` : "No underweight birds"}
              </p>
            </div>

            <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
              <p className="label-section text-[10px]">Projected Harvest</p>
              <p className="font-mono text-base font-bold mt-0.5" style={{ color: "var(--cv-accent)" }}>
                {harvestG ? `${(harvestG / 1000).toFixed(2)} kg` : "—"}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>Estimated Day {endDay} harvest</p>
            </div>
          </div>

          {/* Detailed Insight Cards */}
          <div className="space-y-3">
            <InsightCard
              level={above ? "positive" : variancePercent > -5 ? "info" : "warning"}
              title={`Flock is ${Math.abs(variancePercent)}% ${above ? "above" : "below"} Ross 308 breed standard`}
              body={`Average weight of ${avgW} g at Day ${day} ${above ? "exceeds" : "is under"} the standard benchmark of ${stdW} g by ${Math.abs(wDelta)} g. ${above ? "Growth acceleration reflects optimal feed conversion and house environmental controls." : "Check feed access, water flow and house temperature."}`}
            />

            <InsightCard
              level={optPct >= 80 ? "positive" : "info"}
              title={`${optPct}% of birds in optimal weight range (${rangeLabel(stdW * UNDERWEIGHT_RATIO, stdW * HEAVY_RATIO)})`}
              body={`${wd.Optimal} of ${total} birds are clustered in the target growth bracket for Day ${day}. Standard deviation is ${sd <= avgW * 0.1 ? "low" : "moderate"} (±${sd} g), ${sd <= avgW * 0.1 ? "showing good flock uniformity" : "so keep an eye on the lighter birds"}.`}
            />

            {wd.Underweight > 0 && (
              <InsightCard
                level="warning"
                title={`${wd.Underweight} underweight ${wd.Underweight === 1 ? "bird" : "birds"} flagged for feeder access`}
                body={`Bird ${lightest.id} (${lightest.weightG.toLocaleString()} g) is currently ${Math.max(0, avgW - lightest.weightG)} g below the flock average. Telemetry indicates lower movement frequency near Zone CAM-01. Recommend adjusting drinker nipple height and confirming feed pan distribution.`}
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
                <p className="text-sm font-semibold leading-snug" style={{ color: "var(--brand)" }}>
                  Operational Recommendation for Day {day}
                </p>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {feedAdvice(day, endDay)}
                </p>
              </div>
            </div>
          </div>
    </DiagnosticsCard>
  );
}

/* ── Flock conditions report: feed, behavior and environment together ── */
interface EnvSensor {
  title: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  insight: { level: InsightLevel; title: string; body: string };
}

function ConditionsAnalysisSection({
  day,
  total,
  fcr,
  fcrTarget,
  adgG,
  movementIndex,
  huddlingRisk,
  aggressionEvents,
  inactive,
  huddling,
  inactPct,
  sensors,
}: {
  day: number;
  total: number;
  fcr: number;
  fcrTarget: number;
  adgG: number;
  movementIndex: number;
  huddlingRisk: number;
  aggressionEvents: number;
  inactive: number;
  huddling: number;
  inactPct: number;
  sensors: EnvSensor[];
}) {
  const fcrDelta = fcrTarget - fcr;
  const inRange = sensors.filter((e) => e.value >= e.min && e.value <= e.max);
  const outOfRange = sensors.filter((e) => e.value < e.min || e.value > e.max);

  // One plain recommendation, put together from whatever is off.
  const actions: string[] = [];
  if (huddling > 0) actions.push("check the drinker line and the ventilation where birds are huddling");
  if (inactPct > 20) actions.push("walk the house and inspect the inactive birds");
  if (fcr > fcrTarget) actions.push("review feed distribution and wastage");
  if (outOfRange.length > 0) actions.push(`bring ${outOfRange.map((e) => e.title.toLowerCase()).join(" and ")} back into range`);
  const recommendation =
    actions.length > 0
      ? `Next round: ${actions.join("; ")}.`
      : "Feed, behavior and the house environment are all on target. Keep the current feed, ventilation and lighting routine.";

  return (
    <DiagnosticsCard
      title="Automated Conditions Diagnostics"
      description="Run a multi-factor diagnostic across feed efficiency, flock behavior and house environment, and see how the three affect each other."
      chips={[`FCR ${fcr}`, `${total} Birds Scanned`, `${sensors.length} Sensors`, `Day ${day}`]}
      buttonLabel="Process & Analyze Conditions"
      processingTitle="Processing Feed, Behavior & Environment..."
      steps={[
        `Ingesting feed, water and daily-gain records (FCR ${fcr})...`,
        `Reading behavior telemetry for ${total} birds: movement, huddling and aggression...`,
        "Checking temperature, humidity and ammonia against their target bands...",
        "Cross-checking the three and drafting recommendations...",
      ]}
      reportTitle="Flock Conditions Diagnostic Report"
      evaluated={`${total} Birds · ${sensors.length} Sensors Evaluated`}
    >
      {/* Scorecards: one per area */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
          <p className="label-section text-[10px]">Feed Efficiency</p>
          <p className="font-mono text-base font-bold mt-0.5" style={{ color: fcr <= fcrTarget ? "var(--status-green)" : "var(--status-red)" }}>
            FCR {fcr}
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            {Math.abs(fcrDelta).toFixed(2)} {fcrDelta >= 0 ? "below" : "above"} the {fcrTarget} target
          </p>
        </div>

        <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
          <p className="label-section text-[10px]">Activity</p>
          <p className="font-mono text-base font-bold mt-0.5"
            style={{ color: inactPct > 30 ? "var(--status-red)" : inactPct > 20 ? "var(--status-amber)" : "var(--status-green)" }}>
            {(movementIndex * 100).toFixed(1)}%
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            Movement index · {inactive} of {total} birds inactive
          </p>
        </div>

        <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
          <p className="label-section text-[10px]">Huddling</p>
          <p className="font-mono text-base font-bold mt-0.5" style={{ color: huddling > 0 ? "var(--status-amber)" : "var(--status-green)" }}>
            {huddling} {huddling === 1 ? "Bird" : "Birds"}
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            Cluster risk {(huddlingRisk * 100).toFixed(0)}%
          </p>
        </div>

        <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
          <p className="label-section text-[10px]">Environment</p>
          <p className="font-mono text-base font-bold mt-0.5" style={{ color: outOfRange.length === 0 ? "var(--status-green)" : "var(--status-amber)" }}>
            {inRange.length} / {sensors.length}
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            {outOfRange.length === 0 ? "Sensors in their target band" : `${outOfRange.map((e) => e.title).join(", ")} out of range`}
          </p>
        </div>
      </div>

      {/* Findings, grouped by area */}
      <div className="space-y-4">
        <div className="space-y-3">
          <p className="label-section text-[11px] tracking-widest font-bold">Feed</p>
          <InsightCard level={fcr <= fcrTarget ? "positive" : "warning"}
            title={`FCR ${fcr} is ${Math.abs(fcrDelta).toFixed(2)} ${fcrDelta >= 0 ? "below" : "above"} target`}
            body={`FCR trending downward across 8 consecutive measurements (1.72 to ${fcr}), indicating ${fcrDelta >= 0 ? "improving" : "slipping"} feed efficiency as the flock matures.`} />
          <InsightCard level="positive"
            title={`Daily gain of ${adgG} g/day within normal range`}
            body={`Consistent with Ross 308 expectations at Day ${day}. Feed intake and weight gain ratio suggest a well-balanced diet and healthy gut function.`} />
          <InsightCard level="info"
            title="Water intake at 2.4 L/hr is nominal"
            body="Water-to-feed ratio is within the expected range. Adequate hydration supports digestion and maintains optimal FCR performance." />
        </div>

        <div className="space-y-3">
          <p className="label-section text-[11px] tracking-widest font-bold">Behavior</p>
          <InsightCard level={inactPct > 30 ? "critical" : "warning"}
            title={`${inactPct}% of birds show reduced daytime activity`}
            body={`${inactive} birds classified as inactive in the current scan. B-019 has been inactive for over 30 minutes and is flagged for manual inspection.`} />
          {huddling > 0 && (
            <InsightCard level="warning"
              title="B-013 and B-015 huddling detected, open incident"
              body="Cluster density exceeded threshold near the water drinker zone (CAM-01). Huddling has persisted for 80+ minutes. Inspect the drinker and increase ventilation." />
          )}
          <InsightCard level={aggressionEvents === 0 ? "positive" : "warning"}
            title={aggressionEvents === 0 ? "Zero aggression events detected" : `${aggressionEvents} aggression events detected`}
            body={aggressionEvents === 0
              ? `No pecking or aggressive interactions detected across ${total} birds. Pen density and lighting appear well-calibrated for this growth stage.`
              : "Pecking or aggressive interactions were detected. Check stocking density and lighting."} />
        </div>

        <div className="space-y-3">
          <p className="label-section text-[11px] tracking-widest font-bold">Environment</p>
          {sensors.map((e) => (
            <InsightCard key={e.title} level={e.insight.level} title={e.insight.title} body={e.insight.body} />
          ))}
        </div>
      </div>

      <div className="rounded-xl p-4 border flex items-start gap-3"
        style={{ background: "rgba(52, 211, 153, 0.05)", borderColor: "rgba(52, 211, 153, 0.25)" }}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
          style={{ background: "rgba(52, 211, 153, 0.2)", color: "var(--brand)" }}>
          <TrendingUp className="h-3.5 w-3.5" />
        </span>
        <div>
          <p className="text-sm font-semibold leading-snug" style={{ color: "var(--brand)" }}>
            Operational Recommendation
          </p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {recommendation}
          </p>
        </div>
      </div>
    </DiagnosticsCard>
  );
}

/* ── Insight Card ────────────────────────────────────────────── */
function InsightCard({ level, title, body }: { level: InsightLevel; title: string; body: string }) {
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

/* ── Range Bar ───────────────────────────────────────────────── */
function RangeBar({ value, min = 0, max, unit, color }: {
  value: number; min?: number; max: number; unit: string; color: string;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const ok = value >= min && value <= max;
  return (
    <div className="space-y-2">
      <div className="flex justify-between font-mono text-xs">
        <span style={{ color: "var(--text-tertiary)" }}>{min}{unit}</span>
        <span className="font-bold text-sm" style={{ color: ok ? color : "var(--status-red)" }}>{value}{unit}</span>
        <span style={{ color: "var(--text-tertiary)" }}>{max}{unit}</span>
      </div>
      <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: "var(--surface-raised)" }}>
        <div className="absolute inset-y-0 rounded-full opacity-15" style={{ left: 0, right: 0, background: color }} />
        <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: ok ? color : "var(--status-red)" }} />
      </div>
      <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>Optimal: {min}-{max}{unit}</p>
    </div>
  );
}

/* ── Stat Card ───────────────────────────────────────────────── */
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="cb-card px-4 py-4 flex flex-col gap-1">
      <p className="label-section">{label}</p>
      <p className="font-mono text-lg font-bold leading-none mt-1" style={{ color: accent ?? "var(--cv-accent)" }}>{value}</p>
      {sub && <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{sub}</p>}
    </div>
  );
}

/* ── Chart Legend ────────────────────────────────────────────── */
function ChartLegend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
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

  // The sample flock, moved to the grow-out day set in Settings.
  const analytics = Route.useLoaderData() as any;
  const sample = useMemo(() => sampleForDay(analytics), [analytics]);
  const { farm, broilers } = sample;
  const { day, startDay, endDay } = sample;

  const curve        = farm.weight.curve;
  const actualSeries = curve.filter((p) => p.actualG > 0).map((p) => ({ x: p.day, y: p.actualG }));
  const targetSeries = curve.map((p) => ({ x: p.day, y: p.standardG }));
  const fcrSeries    = farm.feed.series.map((v, i) => ({ x: i + 1, y: v }));
  const tempHistory  = [28.4, 28.9, 29.1, 29.5, 29.1, 28.8, 29.1].map((v, i) => ({ x: i + 1, y: v }));
  const humidHistory = [61, 62, 63, 64, 63, 62, 63].map((v, i) => ({ x: i + 1, y: v }));
  const nh3History   = [8, 9, 9, 10, 9, 9, 9].map((v, i) => ({ x: i + 1, y: v }));
  const envSensors = [
    {
      title: "Temperature", series: tempHistory, value: 29.1, min: 26, max: 32, unit: "°C",
      color: "var(--brand)",
      insight: { level: "positive" as InsightLevel, title: "Temperature within optimal range (26–32°C)",
        body: "Stable over 7 days with a minor peak of 29.5°C on Day 4. No corrective action required. Continue monitoring as ambient temperatures rise mid-afternoon." },
    },
    {
      title: "Humidity", series: humidHistory, value: 63, min: 50, max: 70, unit: "%",
      color: "var(--status-blue)",
      insight: { level: "positive" as InsightLevel, title: "Humidity steady at 63%, nominal",
        body: "Remained within the 50–70% target band. Slight upward creep from 61% to 63% is acceptable and correlates with increased bird respiration as body mass grows." },
    },
    {
      title: "Ammonia (NH3)", series: nh3History, value: 9, min: 0, max: 25, unit: " ppm",
      color: "var(--status-amber)",
      insight: { level: "info" as InsightLevel, title: "NH3 at 9 ppm, well below the 25 ppm alert threshold",
        body: "Levels are low and stable. A one-day spike to 10 ppm self-resolved, likely due to litter disturbance. Litter moisture and ventilation management are effective." },
    },
  ];

  // To Date: the start day up to today (at least a week wide, so the first day still has a line).
  // Full Cycle: the start day to the last day, with the target running ahead of the flock.
  const displayedActualSeries = actualSeries;
  const displayedTargetSeries = targetSeries;
  const domainX: [number, number] = growthRange === "full" ? [startDay, endDay] : [startDay, Math.min(endDay, Math.max(day, startDay + 7))];
  const harvestG = projectedHarvestG(sample);
  // "Day 16–23", or just "Day 16" on the day the window starts.
  const toDate = day > startDay ? `Day ${startDay}–${day}` : `Day ${day}`;
  const signedVariance = `${farm.weight.variancePercent >= 0 ? "+" : ""}${farm.weight.variancePercent}%`;
  const varianceColor = farm.weight.variancePercent >= 0 ? "var(--status-green)" : farm.weight.variancePercent > -5 ? "var(--status-amber)" : "var(--status-red)";

  const bd       = behaviorBreakdown(false);
  const wd       = sample.weightBreakdown;
  const total    = broilers.length;
  const inactPct = Math.round(((bd.Inactivity + bd.Huddling) / total) * 100);
  const optPct   = Math.round((wd.Optimal / total) * 100);
  const avgW     = farm.weight.actualAvgG;
  const stdW     = farm.weight.standardG;
  const wDelta   = avgW - stdW;
  const fcrDelta = farm.feed.fcrTarget - farm.feed.fcr;

  const tabs: { id: Tab; label: string }[] = [
    { id: "growth",     label: "Weight Growth"   },
    { id: "conditions", label: "Flock Conditions" },
  ];

  return (
    <AppShell>
      <SampleNotice>
        These charts and figures are built-in sample data for Day {farm.cycle.day}, not the live flock. The
        Dashboard's Growth card shows the live weight and cycle day.
      </SampleNotice>

      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>Analytics</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          <span className="font-semibold" style={{ color: "var(--brand)" }}>{farm.facility.name}</span>
          {" · "}{farm.facility.houses[0]?.label}{" · Day "}
          <span className="font-mono font-bold" style={{ color: "var(--cv-accent)" }}>{farm.cycle.day}</span>
          {` / ${endDay} `}
          <span style={{ color: "var(--text-tertiary)" }}>
            ({Math.round((farm.cycle.day / endDay) * 100)}% of grow-out)
          </span>
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
                <p className="label-section text-[10px]">Avg Weight</p>
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
                  <span className="font-mono text-lg font-bold" style={{ color: "var(--cv-accent)" }}>
                    {(avgW / 1000).toFixed(3)} kg
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded" style={{ background: "rgba(163, 230, 53, 0.15)", color: "var(--cv-accent)" }}>
                    Day {farm.cycle.day}
                  </span>
                </div>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{avgW} g · Day {farm.cycle.day}</p>
              </div>

              <div className="rounded-xl p-3 border transition-all duration-150"
                style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
                <p className="label-section text-[10px]">vs Ross 308</p>
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
                  <span className="font-mono text-lg font-bold" style={{ color: varianceColor }}>
                    {wDelta >= 0 ? "+" : ""}{wDelta} g
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded" style={{ background: tint(varianceColor, 15), color: varianceColor }}>
                    {signedVariance}
                  </span>
                </div>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                  {Math.abs(farm.weight.variancePercent)}% {farm.weight.variancePercent >= 0 ? "above" : "below"} standard
                </p>
              </div>

              <div className="rounded-xl p-3 border transition-all duration-150"
                style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
                <p className="label-section text-[10px]">Est. Confidence</p>
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
                  <span className="font-mono text-lg font-bold" style={{ color: "var(--brand)" }}>
                    {farm.weight.estimationConfidencePercent}%
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded" style={{ background: "rgba(52, 211, 153, 0.15)", color: "var(--brand)" }}>
                    Depth Scan
                  </span>
                </div>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>Depth-scan precision</p>
              </div>

              <div className="rounded-xl p-3 border transition-all duration-150"
                style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
                <p className="label-section text-[10px]">Sample Size</p>
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
                  <span className="font-mono text-lg font-bold" style={{ color: "var(--status-blue)" }}>
                    {farm.weight.sampleSize} / {total}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded" style={{ background: "rgba(59, 130, 246, 0.15)", color: "var(--status-blue)" }}>
                    93% Scanned
                  </span>
                </div>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>Birds weighed this scan</p>
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
                      {growthRange === "to-date" ? `Flock Growth Trajectory (${toDate})` : `Full Cycle Growth Curve (Day ${startDay}–${endDay})`}
                    </h2>
                    <span className="font-mono text-xs px-2.5 py-0.5 rounded-full font-semibold"
                      style={{
                        background: tint(varianceColor, 12),
                        color: varianceColor,
                        border: `1px solid ${tint(varianceColor, 30)}`,
                      }}>
                      {growthRange === "to-date"
                        ? `${signedVariance} vs Standard`
                        : `Day ${endDay} Harvest: ${harvestG ? (harvestG / 1000).toFixed(2) : "—"} kg`}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {growthRange === "to-date"
                      ? "Hover or tap along the curve to inspect daily weight, standard variance, and growth gain."
                      : `Day ${startDay} to Day ${endDay} projection with the Ross 308 standard target benchmark.`}
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
                      {`${toDate} (To Date)`}
                    </button>
                    <button
                      onClick={() => setGrowthRange("full")}
                      className="tap flex-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 sm:flex-none"
                      style={growthRange === "full"
                        ? { background: "var(--brand)", color: "var(--text-inverse)", fontWeight: 600, boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }
                        : { color: "var(--text-secondary)" }}
                    >
                      {`Day ${startDay}–${endDay} (Full Cycle)`}
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
                      {activeHoverPoint ? `D${activeHoverPoint.x}:` : `Latest (D${day}):`}
                    </span>
                    <span className="font-bold text-sm" style={{ color: "var(--brand)" }}>
                      {activeHoverPoint
                        ? activeHoverPoint.y >= 1000 ? `${(activeHoverPoint.y / 1000).toFixed(2)} kg` : `${activeHoverPoint.y} g`
                        : `${(avgW / 1000).toFixed(2)} kg`}
                    </span>
                    {activeHoverPoint?.targetY !== undefined && (
                      <span className="font-semibold text-[11px]" style={{
                        color: activeHoverPoint.y >= activeHoverPoint.targetY ? "var(--status-green)" : "var(--status-amber)"
                      }}>
                        ({activeHoverPoint.y >= activeHoverPoint.targetY ? "+" : ""}
                        {activeHoverPoint.y - activeHoverPoint.targetY}g vs Ross 308)
                      </span>
                    )}
                  </div>

                  <ChartLegend items={[
                    { color: "var(--brand)", label: "Actual Scan" },
                    { color: "var(--status-amber)", label: "Ross 308 Std", dashed: true },
                  ]} />
                </div>
              </div>

              <AxisLineChart
                series={displayedActualSeries}
                targets={displayedTargetSeries}
                domainX={domainX}
                color="var(--brand)"
                targetColor="var(--status-amber)"
                height={260}
                onHoverPoint={setActiveHoverPoint}
              />
            </div>
          </div>

          <div className="cb-card p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Flock Weight Distribution</h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  Birds sorted into brackets of the Ross 308 standard for Day {day}, from {total} depth-scans
                </p>
              </div>
              <UniformityChip sample={sample} />
            </div>
            <FlockWeightDistribution sample={sample} />
          </div>

          <GrowthAnalysisSection
            sample={sample}
            avgW={avgW}
            stdW={stdW}
            wDelta={wDelta}
            optPct={optPct}
            wd={wd}
            total={total}
            day={farm.cycle.day}
            variancePercent={farm.weight.variancePercent}
          />
        </div>
      )}

      {/* ── FLOCK CONDITIONS: feed, behavior and environment together ── */}
      {tab === "conditions" && (
        <div className="space-y-6">
          {/* Feed */}
          <section aria-labelledby="cond-feed" className="space-y-3">
            <h2 id="cond-feed" className="label-section text-[11px] tracking-widest font-bold">Feed & Water</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Current FCR"   value={String(farm.feed.fcr)} sub={`Target: ${farm.feed.fcrTarget}`}
                accent={farm.feed.fcr <= farm.feed.fcrTarget ? "var(--status-green)" : "var(--status-red)"} />
              <StatCard label="vs Target"     value={`${fcrDelta >= 0 ? "-" : "+"}${Math.abs(fcrDelta).toFixed(2)}`}
                sub={fcrDelta >= 0 ? "Below FCR target" : "Above FCR target"}
                accent={fcrDelta >= 0 ? "var(--status-green)" : "var(--status-red)"} />
              <StatCard label="Daily Gain"    value={`${farm.feed.adgG} g/day`} sub="Avg daily weight gain" />
              <StatCard label="Feed Consumed" value={`${farm.feed.cycleConsumedKg} kg`} sub="Cycle total to date" />
            </div>
            <div className="cb-card p-5">
              <div className="flex items-start justify-between flex-wrap gap-2 mb-4">
                <div>
                  <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>FCR Trend, Last 8 Measurements</h3>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    Lower = better efficiency · Target {farm.feed.fcrTarget} shown as dashed line
                  </p>
                </div>
                <ChartLegend items={[
                  { color: "var(--brand)", label: "FCR" },
                  { color: "var(--status-amber)", label: "Target", dashed: true },
                ]} />
              </div>
              <AxisLineChart series={fcrSeries}
                targets={fcrSeries.map((_, i) => ({ x: i + 1, y: farm.feed.fcrTarget }))}
                color="var(--brand)" targetColor="var(--status-amber)"
                xLabel="Scan" yLabel="FCR" yTickCount={5} height={180} targetLabel="Target" />
            </div>
          </section>

          {/* Behavior */}
          <section aria-labelledby="cond-behavior" className="space-y-3">
            <h2 id="cond-behavior" className="label-section text-[11px] tracking-widest font-bold">Behavior</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Movement Index" value={`${(farm.behavior.movementIndex * 100).toFixed(1)}%`} sub="Above 88% baseline" accent="var(--status-green)" />
              <StatCard label="Huddling Risk"  value={`${(farm.behavior.huddlingRisk * 100).toFixed(0)}%`} sub="Low cluster density" accent="var(--status-green)" />
              <StatCard label="Inactive Birds" value={`${bd.Inactivity} / ${total}`} sub={`${inactPct}% of flock`}
                accent={inactPct > 20 ? "var(--status-red)" : "var(--status-amber)"} />
              <StatCard label="Huddling"       value={`${bd.Huddling} birds`} sub="Cluster detected" accent="var(--status-amber)" />
            </div>
            <div className="cb-card p-5">
              <h3 className="mb-4 text-base font-bold" style={{ color: "var(--text-primary)" }}>
                Activity Classification, Current Scan
              </h3>
              <DonutChart segments={[
                { label: "Active",   value: bd.Active,     color: "var(--status-green)" },
                { label: "Inactive", value: bd.Inactivity, color: "var(--status-red)" },
                { label: "Huddling", value: bd.Huddling,   color: "var(--status-amber)" },
              ]} />
              <p className="mt-3 text-center text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                Point at a segment, or tap it, for the breakdown.
              </p>
            </div>
          </section>

          {/* Environment */}
          <section aria-labelledby="cond-env" className="space-y-3">
            <h2 id="cond-env" className="label-section text-[11px] tracking-widest font-bold">Environment</h2>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {envSensors.map((env) => (
                <div key={env.title} className="cb-card p-5">
                  <div className="flex items-start justify-between flex-wrap gap-2 mb-1">
                    <div>
                      <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{env.title}</h3>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        7-day history · Optimal: {env.min}–{env.max}{env.unit}
                      </p>
                    </div>
                    <span className="font-mono text-sm font-bold px-3 py-1 rounded-full"
                      style={{
                        color: env.color,
                        background: `${env.color}18`,
                        border: `1px solid ${env.color}40`,
                      }}>
                      Current: {env.value}{env.unit}
                    </span>
                  </div>
                  <div className="mt-4">
                    <AxisLineChart series={env.series} color={env.color} xLabel="Day"
                      yLabel={env.unit.trim()} yTickCount={4} height={150} />
                  </div>
                  <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <RangeBar value={env.value} min={env.min} max={env.max} unit={env.unit} color={env.color} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <ConditionsAnalysisSection
            day={farm.cycle.day}
            total={total}
            fcr={farm.feed.fcr}
            fcrTarget={farm.feed.fcrTarget}
            adgG={farm.feed.adgG}
            movementIndex={farm.behavior.movementIndex}
            huddlingRisk={farm.behavior.huddlingRisk}
            aggressionEvents={farm.behavior.aggressionEvents}
            inactive={bd.Inactivity}
            huddling={bd.Huddling}
            inactPct={inactPct}
            sensors={envSensors}
          />
        </div>
      )}
    </AppShell>
  );
}
