import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useLayoutEffect } from "react";
import { AppShell } from "@/components/farm/AppShell";
import { getGrowthAnalytics } from "@/lib/farm/repository";
import { broilers, farm, behaviorBreakdown, weightBreakdown } from "@/lib/farm/dataset";
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
} from "lucide-react";

export const Route = createFileRoute("/telemetry")({
  head: () => ({ meta: [{ title: "Analytics - Cerebroil" }] }),
  loader: () => getGrowthAnalytics(),
  component: AnalyticsPage,
});

type Tab = "growth" | "feed" | "behavior" | "environment";
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

  if (series.length < 2) return null;
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
  // Thin the labels so each gets ~30px; the last one always shows.
  const labelEvery = Math.max(1, Math.ceil((allXTicks.length * 30) / plotW));

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
        {allXTicks.map(({ x, px }, i) => {
          const isHovered = hoveredPoint?.x === x;
          const isLast = i === allXTicks.length - 1;
          // Skip a label that would crowd the always-shown last label.
          const showLabel =
            isHovered ||
            isLast ||
            (i % labelEvery === 0 && allXTicks.length - 1 - i >= labelEvery);
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
          const tipW = 152;
          const tipH = hoveredTarget ? 66 : 48;
          let tipX = hX - tipW / 2;
          if (tipX < LEFT + 4) tipX = LEFT + 4;
          if (tipX + tipW > LEFT + plotW - 4) tipX = LEFT + plotW - tipW - 4;
          let tipY = hY - tipH - 12;
          if (tipY < TOP + 4) tipY = hY + 14;

          const delta = hoveredTarget ? hoveredPoint.y - hoveredTarget.y : 0;
          const pctDelta = hoveredTarget && hoveredTarget.y > 0 ? ((delta / hoveredTarget.y) * 100).toFixed(1) : "0";

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
                  {xLabel === "Day" ? `Day ${hoveredPoint.x} Scan` : `${xLabel} ${hoveredPoint.x}`}
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
                  Actual: {formatVal(hoveredPoint.y)}
                </text>
                {hoveredTarget && (
                  <>
                    <circle cx="15" cy="48" r="3" fill={targetColor} />
                    <text
                      x="23"
                      y="51"
                      fontSize="9.5"
                      fontWeight="500"
                      fill="var(--text-secondary)"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      Ross 308: {formatVal(hoveredTarget.y)}
                    </text>
                    <text
                      x={tipW - 10}
                      y="51"
                      textAnchor="end"
                      fontSize="9"
                      fontWeight="700"
                      fill={delta >= 0 ? "var(--status-green)" : "var(--status-amber)"}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {delta >= 0 ? `+${delta}g` : `${delta}g`} ({delta >= 0 ? `+${pctDelta}%` : `${pctDelta}%`})
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

/* ── Donut Chart ─────────────────────────────────────────────── */
function DonutChart({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;
  const CX = 100, CY = 100, R = 72, r = 48;
  let cumAngle = -Math.PI / 2;
  const arcs = segments.filter((s) => s.value > 0).map((seg) => {
    const angle = (seg.value / total) * 2 * Math.PI;
    const startA = cumAngle, endA = cumAngle + angle;
    cumAngle = endA;
    const largeArc = angle > Math.PI ? 1 : 0;
    const x1 = CX + R * Math.cos(startA), y1 = CY + R * Math.sin(startA);
    const x2 = CX + R * Math.cos(endA),   y2 = CY + R * Math.sin(endA);
    const ix1 = CX + r * Math.cos(endA),  iy1 = CY + r * Math.sin(endA);
    const ix2 = CX + r * Math.cos(startA),iy2 = CY + r * Math.sin(startA);
    return {
      ...seg, pct: Math.round((seg.value / total) * 100),
      d: `M${x1},${y1} A${R},${R} 0 ${largeArc},1 ${x2},${y2} L${ix1},${iy1} A${r},${r} 0 ${largeArc},0 ${ix2},${iy2} Z`,
    };
  });
  return (
    <svg viewBox="0 0 200 200" className="w-full max-w-[200px]">
      {arcs.map((arc) => <path key={arc.label} d={arc.d} fill={arc.color} opacity="0.9" />)}
      <circle cx={CX} cy={CY} r={r - 2} fill="var(--surface-sunken)" />
      <text x={CX} y={CY - 8} textAnchor="middle" fontSize="22" fontWeight="800"
        fill="var(--text-primary)" fontFamily="JetBrains Mono, monospace">{arcs[0]?.pct ?? 0}%</text>
      <text x={CX} y={CY + 10} textAnchor="middle" fontSize="9" fontWeight="600"
        fill="var(--text-tertiary)" letterSpacing="1">{arcs[0]?.label.toUpperCase()}</text>
    </svg>
  );
}

/* ── Improved Flock Weight Distribution ───────────────────────── */
function FlockWeightDistribution() {
  const [hoveredBinId, setHoveredBinId] = useState<string | null>(null);

  const minWeight = Math.min(...broilers.map((b) => b.weightG));
  const maxWeight = Math.max(...broilers.map((b) => b.weightG));
  const medianWeight = farm.cohorts[0]?.medianG ?? 1340;
  const totalBirds = broilers.length;

  // Uniformity calculation: % of birds within +/- 10% of median (Ross 308 benchmark standard)
  const lower10 = medianWeight * 0.9;
  const upper10 = medianWeight * 1.1;
  const uniformBirds = broilers.filter((b) => b.weightG >= lower10 && b.weightG <= upper10).length;
  const uniformityPct = Math.round((uniformBirds / totalBirds) * 100);

  const bins = [
    {
      id: "b1",
      label: "< 1.1 kg",
      bracket: "< 1,100 g",
      category: "Underweight Cohort",
      count: broilers.filter((b) => b.weightG < 1100).length,
      birds: broilers.filter((b) => b.weightG < 1100).map((b) => b.id),
      color: "var(--status-red)",
      statusText: "At-Risk",
      isAlert: true,
    },
    {
      id: "b2",
      label: "1.1 – 1.2 kg",
      bracket: "1,100 – 1,199 g",
      category: "Low-Growth Tier",
      count: broilers.filter((b) => b.weightG >= 1100 && b.weightG < 1200).length,
      birds: broilers.filter((b) => b.weightG >= 1100 && b.weightG < 1200).map((b) => b.id),
      color: "var(--status-amber)",
      statusText: "Monitor",
      isAlert: false,
    },
    {
      id: "b3",
      label: "1.2 – 1.3 kg",
      bracket: "1,200 – 1,299 g",
      category: "Target Cohort",
      count: broilers.filter((b) => b.weightG >= 1200 && b.weightG < 1300).length,
      birds: broilers.filter((b) => b.weightG >= 1200 && b.weightG < 1300).map((b) => b.id),
      color: "var(--brand)",
      statusText: "Optimal",
      isAlert: false,
    },
    {
      id: "b4",
      label: "1.3 – 1.4 kg",
      bracket: "1,300 – 1,399 g",
      category: "Ross 308 Standard Peak",
      count: broilers.filter((b) => b.weightG >= 1300 && b.weightG < 1400).length,
      birds: broilers.filter((b) => b.weightG >= 1300 && b.weightG < 1400).map((b) => b.id),
      color: "var(--brand)",
      statusText: "Standard Peak",
      isPeak: true,
      isAlert: false,
    },
    {
      id: "b5",
      label: "1.4 – 1.5 kg",
      bracket: "1,400 – 1,499 g",
      category: "High-Yield Tier",
      count: broilers.filter((b) => b.weightG >= 1400 && b.weightG < 1500).length,
      birds: broilers.filter((b) => b.weightG >= 1400 && b.weightG < 1500).map((b) => b.id),
      color: "var(--brand)",
      statusText: "Optimal High",
      isAlert: false,
    },
    {
      id: "b6",
      label: "≥ 1.5 kg",
      bracket: "≥ 1,500 g",
      category: "Advanced Growth",
      count: broilers.filter((b) => b.weightG >= 1500).length,
      birds: broilers.filter((b) => b.weightG >= 1500).map((b) => b.id),
      color: "var(--status-blue)",
      statusText: "Heavy",
      isAlert: false,
    },
  ];

  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const activeBin = bins.find((b) => b.id === hoveredBinId);

  return (
    <div className="space-y-4">
      {/* Compact Top Stat Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
          <p className="label-section text-[10px]">Min Scanned</p>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
            <span className="font-mono text-base font-bold" style={{ color: "var(--status-amber)" }}>{minWeight} g</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded" style={{ background: "rgba(239, 68, 68, 0.15)", color: "var(--status-red)" }}>B-023</span>
          </div>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>Underweight cohort</p>
        </div>

        <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
          <p className="label-section text-[10px]">Flock Median</p>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
            <span className="font-mono text-base font-bold" style={{ color: "var(--brand)" }}>{medianWeight} g</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded" style={{ background: "rgba(52, 211, 153, 0.15)", color: "var(--brand)" }}>+40g</span>
          </div>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>Ross 308 standard: 1,300g</p>
        </div>

        <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
          <p className="label-section text-[10px]">Max Scanned</p>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
            <span className="font-mono text-base font-bold" style={{ color: "var(--status-blue)" }}>{maxWeight} g</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded" style={{ background: "rgba(59, 130, 246, 0.15)", color: "var(--status-blue)" }}>B-028</span>
          </div>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>Heavy cohort peak</p>
        </div>

        <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
          <p className="label-section text-[10px]">Flock Uniformity</p>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 mt-0.5">
            <span className="font-mono text-base font-bold" style={{ color: "var(--cv-accent)" }}>{uniformityPct}%</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded" style={{ background: "rgba(163, 230, 53, 0.15)", color: "var(--cv-accent)" }}>Grade A</span>
          </div>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>24/28 within ±10% median</p>
        </div>
      </div>

      {/* Balanced 2-Column Responsive Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Left Column: Polished Distribution Bars (7 cols) */}
        <div className="lg:col-span-7 space-y-2">
          {bins.map((bin) => {
            const isHovered = hoveredBinId === bin.id;
            const pct = Math.round((bin.count / totalBirds) * 100);
            const fillWidth = Math.max((bin.count / maxCount) * 100, 6);

            return (
              <div
                key={bin.id}
                onMouseEnter={() => setHoveredBinId(bin.id)}
                onMouseLeave={() => setHoveredBinId(null)}
                className="group relative rounded-lg p-2 transition-all duration-150 border cursor-default"
                style={{
                  background: isHovered ? "var(--surface-sunken)" : "transparent",
                  borderColor: isHovered ? bin.color : "transparent",
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                      {bin.label}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{
                        background: `${bin.color}15`,
                        color: bin.color,
                        border: `1px solid ${bin.color}35`,
                      }}>
                      {bin.statusText}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="font-bold" style={{ color: bin.color }}>
                      {bin.count} {bin.count === 1 ? "bird" : "birds"}
                    </span>
                    <span className="text-[11px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                      ({pct}%)
                    </span>
                  </div>
                </div>

                {/* Modern Track & Fill */}
                <div className="relative h-4 rounded-md overflow-hidden" style={{ background: "var(--surface-raised)" }}>
                  <div
                    className="absolute inset-y-0 left-0 rounded-md transition-all duration-500 flex items-center"
                    style={{
                      width: `${fillWidth}%`,
                      background: `linear-gradient(90deg, ${bin.color}40 0%, ${bin.color} 100%)`,
                      boxShadow: isHovered ? `0 0 12px ${bin.color}60` : "none",
                    }}
                  />
                </div>

                {/* Hover Bird Tags Pill */}
                {isHovered && bin.birds.length > 0 && (
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[10px] font-mono animate-in fade-in duration-150">
                    <span style={{ color: "var(--text-tertiary)" }}>Bird IDs:</span>
                    {bin.birds.map((id) => (
                      <span key={id} className="px-1.5 py-0.2 rounded bg-surface-raised font-bold" style={{ color: bin.color }}>
                        {id}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right Column: Uniformity & Cohort Card (5 cols) */}
        <div className="lg:col-span-5 rounded-xl p-4 border flex flex-col justify-between"
          style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="label-section text-[11px]">Uniformity Index</span>
              <span className="flex items-center gap-1 font-mono text-xs font-bold" style={{ color: "var(--cv-accent)" }}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Grade A
              </span>
            </div>

            {/* Visual Gauge Bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between font-mono text-xs">
                <span style={{ color: "var(--text-tertiary)" }}>Cohort Consistency</span>
                <span className="font-bold" style={{ color: "var(--cv-accent)" }}>{uniformityPct}%</span>
              </div>
              <div className="relative h-3 rounded-full overflow-hidden" style={{ background: "var(--surface-raised)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${uniformityPct}%`,
                    background: "linear-gradient(90deg, #10b981 0%, #a3e635 100%)",
                  }}
                />
              </div>
              <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                Ross 308 threshold: &gt;85% required for uniform processing line yield.
              </p>
            </div>

            {/* Cohort Breakdown Summary */}
            <div className="mt-4 pt-3 border-t space-y-2" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: "var(--brand)" }} />
                  Target Cohort (1.2–1.5 kg)
                </span>
                <span className="font-mono font-bold" style={{ color: "var(--brand)" }}>25 birds (89%)</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: "var(--status-amber)" }} />
                  Underweight Cohort (&lt; 1.2 kg)
                </span>
                <span className="font-mono font-bold" style={{ color: "var(--status-amber)" }}>2 birds (7%)</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: "var(--status-blue)" }} />
                  Heavy Tier (&ge; 1.5 kg)
                </span>
                <span className="font-mono font-bold" style={{ color: "var(--status-blue)" }}>1 bird (4%)</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t text-[11px] leading-relaxed" style={{ borderColor: "var(--border-subtle)", color: "var(--text-tertiary)" }}>
            High flock uniformity correlates with balanced feeder access and consistent meat harvest margins at Day 42.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Interactive Growth Analysis with Process / Trigger Button ─── */
function GrowthAnalysisSection({
  avgW,
  stdW,
  wDelta,
  optPct,
  wd,
  total,
  day,
  variancePercent,
}: {
  avgW: number;
  stdW: number;
  wDelta: number;
  optPct: number;
  wd: { Optimal: number; Underweight: number; Overweight: number };
  total: number;
  day: number;
  variancePercent: number;
}) {
  const [analysisState, setAnalysisState] = useState<"idle" | "processing" | "ready">("idle");
  const [progress, setProgress] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [processedAt, setProcessedAt] = useState<string | null>(null);

  const steps = [
    "Ingesting 28 depth-scan weight and morphometric records...",
    "Benchmarking flock curve against Ross 308 Day 14 standards (+1.5% delta)...",
    "Evaluating cohort uniformity & clustering at drinker lines...",
    "Synthesizing actionable harvest yield projections...",
  ];

  const handleRunAnalysis = () => {
    setAnalysisState("processing");
    setProgress(0);
    setStepIdx(0);

    const interval = setInterval(() => {
      setProgress((prev) => {
        const next = prev + 14;
        if (next >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setAnalysisState("ready");
            setProcessedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
          }, 250);
          return 100;
        }
        if (next > 75) setStepIdx(3);
        else if (next > 50) setStepIdx(2);
        else if (next > 25) setStepIdx(1);
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
                Automated Growth Diagnostics & Trajectory
              </h2>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Run multi-factor AI diagnostic on current 28-bird depth-scan telemetry, Ross 308 standard variance,
              cohort uniformity, and feed efficiency projections for Day 42 harvest.
            </p>
            <div className="flex items-center gap-2 pt-1 flex-wrap font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              <span className="px-2 py-0.5 rounded bg-surface-raised">28 Scans Ready</span>
              <span>·</span>
              <span className="px-2 py-0.5 rounded bg-surface-raised">Day 14 Cohort</span>
              <span>·</span>
              <span className="px-2 py-0.5 rounded bg-surface-raised">Ross 308 Benchmark</span>
              <span>·</span>
              <span className="px-2 py-0.5 rounded bg-surface-raised">FCR 1.64 Correlation</span>
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
            <span>Process & Analyze Growth</span>
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
              Processing Telemetry & Growth Curves...
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
              <span>Step {stepIdx + 1} of 4</span>
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
                  Flock Growth Diagnostic Report
                </h2>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                  Generated at {processedAt ?? "just now"} · 28 Broiler Depth-Scans Evaluated
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

          {/* Diagnostic Key Takeaway Scorecards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
              <p className="label-section text-[10px]">Growth Trajectory</p>
              <p className="font-mono text-base font-bold mt-0.5" style={{ color: "var(--status-green)" }}>+{variancePercent}%</p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>Above Ross 308 standard</p>
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
              <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>B-023 (1,050g) flagged</p>
            </div>

            <div className="rounded-xl p-3 border" style={{ background: "var(--surface-sunken)", borderColor: "var(--border-subtle)" }}>
              <p className="label-section text-[10px]">Projected Harvest</p>
              <p className="font-mono text-base font-bold mt-0.5" style={{ color: "var(--cv-accent)" }}>3.92 kg</p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>Estimated Day 42 harvest</p>
            </div>
          </div>

          {/* Detailed Insight Cards */}
          <div className="space-y-3">
            <InsightCard
              level="positive"
              title={`Flock is ${variancePercent}% above Ross 308 breed standard`}
              body={`Average weight of ${avgW} g at Day ${day} exceeds the standard benchmark of ${stdW} g by ${wDelta} g. Growth acceleration reflects optimal feed conversion and house environmental controls.`}
            />

            <InsightCard
              level="positive"
              title={`${optPct}% of birds in optimal weight range (1.2–1.5 kg)`}
              body={`${wd.Optimal} of ${total} birds are clustered cleanly in the target growth bracket. Standard deviation is low (±118 g), showing exceptional flock uniformity.`}
            />

            {wd.Underweight > 0 && (
              <InsightCard
                level="warning"
                title={`${wd.Underweight} underweight ${wd.Underweight === 1 ? "bird" : "birds"} flagged for feeder access`}
                body="Bird B-023 (1,050 g) is currently 250 g below the flock average. Telemetry indicates lower movement frequency near Zone CAM-01. Recommend adjusting drinker nipple height and confirming feed pan distribution."
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
                  Operational Recommendation for Day 15 Transition
                </p>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  Prepare scheduled transition from Starter crumb to Grower pellet feed on Day 15. Maintain ambient temperature between 28°C and 29°C to support digestive efficiency during the diet shift.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Insight Card ────────────────────────────────────────────── */
function InsightCard({ level, title, body }: { level: InsightLevel; title: string; body: string }) {
  const cfg: Record<InsightLevel, { icon: string; bg: string; border: string; title: string }> = {
    positive: { icon: "check", bg: "var(--status-green-bg)",  border: "var(--status-green-border)",  title: "var(--status-green-text)" },
    warning:  { icon: "!",     bg: "var(--status-amber-bg)",  border: "var(--status-amber-border)",  title: "var(--status-amber-text)" },
    critical: { icon: "x",     bg: "var(--status-red-bg)",    border: "var(--status-red-border)",    title: "var(--status-red-text)" },
    info:     { icon: "i",     bg: "var(--status-blue-bg)",   border: "var(--status-blue-border)",   title: "var(--status-blue-text)" },
  };
  const c = cfg[level];
  return (
    <div className="flex gap-3 rounded-xl p-4" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={{ background: c.border, color: "var(--text-inverse)" }}>{c.icon}</span>
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

  const curve        = farm.weight.curve;
  const actualSeries = curve.filter((p) => p.actualG > 0).map((p) => ({ x: p.day, y: p.actualG }));
  const targetSeries = curve.map((p) => ({ x: p.day, y: p.standardG }));
  const fcrSeries    = farm.feed.series.map((v, i) => ({ x: i + 1, y: v }));
  const tempHistory  = [28.4, 28.9, 29.1, 29.5, 29.1, 28.8, 29.1].map((v, i) => ({ x: i + 1, y: v }));
  const humidHistory = [61, 62, 63, 64, 63, 62, 63].map((v, i) => ({ x: i + 1, y: v }));
  const nh3History   = [8, 9, 9, 10, 9, 9, 9].map((v, i) => ({ x: i + 1, y: v }));

  const displayedActualSeries = growthRange === "to-date" ? actualSeries : curve.map((p) => ({ x: p.day, y: p.actualG }));
  const displayedTargetSeries = growthRange === "to-date" ? targetSeries.filter((p) => p.x <= 14) : targetSeries;
  const domainX: [number, number] | undefined = growthRange === "full" ? [1, 42] : undefined;

  const bd       = behaviorBreakdown(false);
  const wd       = weightBreakdown();
  const total    = broilers.length;
  const inactPct = Math.round(((bd.Inactivity + bd.Huddling) / total) * 100);
  const optPct   = Math.round((wd.Optimal / total) * 100);
  const avgW     = farm.weight.actualAvgG;
  const stdW     = farm.weight.standardG;
  const wDelta   = avgW - stdW;
  const fcrDelta = farm.feed.fcrTarget - farm.feed.fcr;

  const tabs: { id: Tab; label: string }[] = [
    { id: "growth",      label: "Weight Growth" },
    { id: "feed",        label: "Feed & FCR"    },
    { id: "behavior",    label: "Behavior"      },
    { id: "environment", label: "Environment"   },
  ];

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>Analytics</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          <span className="font-semibold" style={{ color: "var(--brand)" }}>{farm.facility.name}</span>
          {" · "}{farm.facility.houses[0]?.label}{" · Day "}
          <span className="font-mono font-bold" style={{ color: "var(--cv-accent)" }}>{farm.cycle.day}</span>
          {" / 42 "}
          <span style={{ color: "var(--text-tertiary)" }}>
            ({Math.round((farm.cycle.day / 42) * 100)}% of grow-out)
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
                  <span className="font-mono text-lg font-bold" style={{ color: "var(--status-green)" }}>
                    {wDelta >= 0 ? "+" : ""}{wDelta} g
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded" style={{ background: "rgba(16, 185, 129, 0.15)", color: "var(--status-green)" }}>
                    +{farm.weight.variancePercent}%
                  </span>
                </div>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{farm.weight.variancePercent}% above standard</p>
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
                      {growthRange === "to-date" ? "Flock Growth Trajectory (Day 1–14)" : "Full Cycle Growth Curve (Day 1–42)"}
                    </h2>
                    <span className="font-mono text-xs px-2.5 py-0.5 rounded-full font-semibold"
                      style={{
                        background: "rgba(52, 211, 153, 0.12)",
                        color: "var(--brand)",
                        border: "1px solid rgba(52, 211, 153, 0.3)",
                      }}>
                      {growthRange === "to-date" ? "+1.5% vs Standard" : "Day 42 Harvest: 3.92 kg"}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {growthRange === "to-date"
                      ? "Hover or tap along the curve to inspect daily weight, standard variance, and growth gain."
                      : "Complete 42-day cycle projection with Ross 308 standard target benchmark."}
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
                      Day 1–14 (To Date)
                    </button>
                    <button
                      onClick={() => setGrowthRange("full")}
                      className="tap flex-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 sm:flex-none"
                      style={growthRange === "full"
                        ? { background: "var(--brand)", color: "var(--text-inverse)", fontWeight: 600, boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }
                        : { color: "var(--text-secondary)" }}
                    >
                      Day 1–42 (Full Cycle)
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
                      {activeHoverPoint ? `D${activeHoverPoint.x}:` : "Latest (D14):"}
                    </span>
                    <span className="font-bold text-sm" style={{ color: "var(--brand)" }}>
                      {activeHoverPoint
                        ? activeHoverPoint.y >= 1000 ? `${(activeHoverPoint.y / 1000).toFixed(2)} kg` : `${activeHoverPoint.y} g`
                        : "1.32 kg"}
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
                  Birds categorized across 100 g weight brackets from 28 depth-scans
                </p>
              </div>
              <span className="font-mono text-xs px-2.5 py-1 rounded-full font-semibold"
                style={{ background: "rgba(163, 230, 53, 0.12)", color: "var(--cv-accent)", border: "1px solid rgba(163, 230, 53, 0.25)" }}>
                Uniformity: 86% · High Consistency
              </span>
            </div>
            <FlockWeightDistribution />
          </div>

          <GrowthAnalysisSection
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

      {/* ── FEED & FCR ── */}
      {tab === "feed" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Current FCR"   value={String(farm.feed.fcr)} sub={`Target: ${farm.feed.fcrTarget}`}
              accent={farm.feed.fcr <= farm.feed.fcrTarget ? "var(--status-green)" : "var(--status-red)"} />
            <StatCard label="vs Target"     value={`-${Math.abs(farm.feed.fcrDelta).toFixed(2)}`} sub="Below FCR target" accent="var(--status-green)" />
            <StatCard label="Daily Gain"    value={`${farm.feed.adgG} g/day`} sub="Avg daily weight gain" />
            <StatCard label="Feed Consumed" value={`${farm.feed.cycleConsumedKg} kg`} sub="Cycle total to date" />
          </div>

          <div className="cb-card p-5">
            <div className="flex items-start justify-between flex-wrap gap-2 mb-4">
              <div>
                <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>FCR Trend — Last 8 Measurements</h2>
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
              xLabel="Scan" yLabel="FCR" yTickCount={5} height={180} />
          </div>

          <div className="cb-card p-5">
            <h2 className="mb-4 text-base font-bold" style={{ color: "var(--text-primary)" }}>Feed Analysis</h2>
            <div className="space-y-3">
              <InsightCard level="positive"
                title={`FCR ${farm.feed.fcr} is ${fcrDelta.toFixed(2)} below target`}
                body={`FCR trending downward across 8 consecutive measurements (1.72 → ${farm.feed.fcr}), indicating improving feed efficiency as the flock matures.`} />
              <InsightCard level="positive"
                title={`Daily gain of ${farm.feed.adgG} g/day within normal range`}
                body="Consistent with Ross 308 expectations at Day 14. Feed intake and weight gain ratio suggest a well-balanced diet and healthy gut function." />
              <InsightCard level="info"
                title="Water intake at 2.4 L/hr — nominal"
                body="Water-to-feed ratio is within the expected range. Adequate hydration supports digestion and maintains optimal FCR performance." />
            </div>
          </div>
        </div>
      )}

      {/* ── BEHAVIOR ── */}
      {tab === "behavior" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Movement Index" value={`${(farm.behavior.movementIndex * 100).toFixed(1)}%`} sub="Above 88% baseline" accent="var(--status-green)" />
            <StatCard label="Huddling Risk"  value={`${(farm.behavior.huddlingRisk * 100).toFixed(0)}%`} sub="Low cluster density" accent="var(--status-green)" />
            <StatCard label="Inactive Birds" value={`${bd.Inactivity} / ${total}`} sub={`${inactPct}% of flock`}
              accent={inactPct > 20 ? "var(--status-red)" : "var(--status-amber)"} />
            <StatCard label="Huddling"       value={`${bd.Huddling} birds`} sub="Cluster detected" accent="var(--status-amber)" />
          </div>

          <div className="cb-card p-5">
            <h2 className="mb-4 text-base font-bold" style={{ color: "var(--text-primary)" }}>
              Activity Classification — Current Scan
            </h2>
            <div className="flex flex-col sm:flex-row gap-6 items-center">
              <div className="w-full max-w-[180px] shrink-0">
                <DonutChart segments={[
                  { label: "Active",   value: bd.Active,     color: "var(--status-green)" },
                  { label: "Inactive", value: bd.Inactivity, color: "var(--status-red)" },
                  { label: "Huddling", value: bd.Huddling,   color: "var(--status-amber)" },
                ]} />
              </div>
              <div className="flex-1 space-y-4 w-full">
                {([
                  { label: "Active",   count: bd.Active,     color: "var(--status-green)" },
                  { label: "Inactive", count: bd.Inactivity, color: "var(--status-red)" },
                  { label: "Huddling", count: bd.Huddling,   color: "var(--status-amber)" },
                ] as const).map((row) => {
                  const pct = Math.round((row.count / total) * 100);
                  return (
                    <div key={row.label}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} />
                          {row.label}
                        </span>
                        <span className="font-mono text-sm font-bold" style={{ color: row.color }}>
                          {row.count} birds · {pct}%
                        </span>
                      </div>
                      <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: "var(--surface-raised)" }}>
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: row.color, opacity: 0.85 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="cb-card p-5">
            <h2 className="mb-4 text-base font-bold" style={{ color: "var(--text-primary)" }}>Movement Metrics</h2>
            <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {[
                { label: "Movement Index",    value: `${(farm.behavior.movementIndex * 100).toFixed(1)}%`, status: "green" },
                { label: "Huddling Risk",     value: `${(farm.behavior.huddlingRisk * 100).toFixed(0)}%`,  status: "green" },
                { label: "Aggression Events", value: `${farm.behavior.aggressionEvents}`,                   status: "green" },
                { label: "Inactive Birds",    value: `${bd.Inactivity} / ${total}`,                         status: inactPct > 20 ? "red" : "amber" },
                { label: "Huddling Birds",    value: `${bd.Huddling} / ${total}`,                           status: bd.Huddling > 0 ? "amber" : "green" },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between py-3">
                  <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{row.label}</span>
                  <span className="font-mono text-sm font-bold" style={{ color: `var(--status-${row.status})` }}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="cb-card p-5">
            <h2 className="mb-4 text-base font-bold" style={{ color: "var(--text-primary)" }}>Behavior Analysis</h2>
            <div className="space-y-3">
              <InsightCard level={inactPct > 30 ? "critical" : "warning"}
                title={`${inactPct}% of birds show reduced daytime activity`}
                body={`${bd.Inactivity} birds classified as inactive in the current scan. B-019 has been inactive for over 30 minutes and is flagged for manual inspection.`} />
              <InsightCard level="warning"
                title="B-013 and B-015 huddling detected — open incident"
                body="Cluster density exceeded threshold near the water drinker zone (CAM-01). Huddling has persisted for 80+ minutes. Inspect the drinker and increase ventilation." />
              <InsightCard level="positive"
                title="Zero aggression events detected"
                body={`No pecking or aggressive interactions detected across ${total} birds. Pen density and lighting appear well-calibrated for this growth stage.`} />
            </div>
          </div>
        </div>
      )}

      {/* ── ENVIRONMENT ── */}
      {tab === "environment" && (
        <div className="space-y-5">
          {([
            {
              title: "Temperature", series: tempHistory, value: 29.1, min: 26, max: 32, unit: "°C",
              color: "var(--brand)",
              insight: { level: "positive" as InsightLevel, title: "Temperature within optimal range (26–32°C)",
                body: "Stable over 7 days with a minor peak of 29.5°C on Day 4. No corrective action required. Continue monitoring as ambient temperatures rise mid-afternoon." },
            },
            {
              title: "Humidity", series: humidHistory, value: 63, min: 50, max: 70, unit: "%",
              color: "var(--status-blue)",
              insight: { level: "positive" as InsightLevel, title: "Humidity steady at 63% — nominal",
                body: "Remained within the 50–70% target band. Slight upward creep from 61% to 63% is acceptable and correlates with increased bird respiration as body mass grows." },
            },
            {
              title: "Ammonia (NH3)", series: nh3History, value: 9, min: 0, max: 25, unit: " ppm",
              color: "var(--status-amber)",
              insight: { level: "info" as InsightLevel, title: "NH3 at 9 ppm — well below 25 ppm alert threshold",
                body: "Levels are low and stable. A one-day spike to 10 ppm self-resolved, likely due to litter disturbance. Litter moisture and ventilation management are effective." },
            },
          ] as const).map((env) => (
            <div key={env.title} className="cb-card p-5">
              <div className="flex items-start justify-between flex-wrap gap-2 mb-1">
                <div>
                  <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{env.title}</h2>
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
                  yLabel={env.unit.trim()} yTickCount={4} height={160} />
              </div>
              <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <RangeBar value={env.value} min={env.min} max={env.max} unit={env.unit} color={env.color} />
              </div>
              <div className="mt-4">
                <InsightCard level={env.insight.level} title={env.insight.title} body={env.insight.body} />
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
