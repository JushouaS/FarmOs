import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { tr } from "@/lib/i18n";

/*
 * The two charts the Analytics page draws with.
 *
 * They were written inside the route file and are moved out here unchanged:
 * a line chart with a hover crosshair, and a donut that answers a pointer or
 * a tap. Neither knows where its numbers came from, which is the point: the
 * page decides what is worth drawing, these decide only how it looks.
 */

export interface ChartSeries {
  x: number;
  y: number;
}

/* ── Axis Line Chart with Interactive Hover & Crosshair ───────── */
export function AxisLineChart({
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

  // Something has to be drawable, but it need not be the measured line: the
  // empty Growth tab draws the dashed standard on its own, until a weigh-in
  // gives the flock a point of its own.
  const targetPts = targets ?? [];
  if (series.length < 1 && targetPts.length < 1) return null;
  // Draw at the container's real width so text stays at its true size on
  // phones (a wider viewBox would be scaled down and letterboxed).
  const W = Math.max(containerWidth, 260);
  const H = height;
  const narrow = W < 480;
  const LEFT = narrow ? 48 : 56,
    BOT = 34,
    RIGHT = narrow ? 12 : 24,
    TOP = 16;
  const plotW = W - LEFT - RIGHT,
    plotH = H - TOP - BOT;

  // The x domain falls back to whatever is drawable, so a targets-only chart
  // gets a sensible axis without the caller passing `domainX`.
  const allX = [...series.map((p) => p.x), ...targetPts.map((p) => p.x)];
  const minX = domainX ? domainX[0] : Math.min(...allX);
  const maxX = domainX ? domainX[1] : Math.max(...allX);

  // Filter actual points and targets to visible X range
  const actualPts = series.filter((p) => p.y > 0 && p.x >= minX && p.x <= maxX);
  const visibleTargets = targetPts.filter((p) => p.y > 0 && p.x >= minX && p.x <= maxX);

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
    pts
      .filter((p) => p.y > 0)
      .map((p, i) => `${i === 0 ? "M" : "L"}${xS(p.x).toFixed(1)},${yS(p.y).toFixed(1)}`)
      .join(" ");

  const last = actualPts[actualPts.length - 1]!,
    first = actualPts[0]!;
  const areaD =
    actualPts.length > 1
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
      for (const t of allXTicks)
        if (labelled.has(t.x) && lastTick.px - t.px < LABEL_GAP) labelled.delete(t.x);
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

  const handlePointerMove = (
    e: React.MouseEvent<SVGSVGElement> | React.PointerEvent<SVGSVGElement>,
  ) => {
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
            isHovered ||
            (labelled.has(x) && (hoverPx === null || Math.abs(px - hoverPx) >= LABEL_GAP));
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
        {areaD && <path d={areaD} fill={`url(#${gradId})`} clipPath={`url(#${clipId})`} />}

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
              <circle cx={xS(p.x)} cy={yS(p.y)} r={isHovered ? "3" : "2"} fill={color} />
            </g>
          );
        })}

        {/* Last value label if not hovering */}
        {actualPts.length > 0 &&
          !hoveredPoint &&
          (() => {
            const lp = actualPts[actualPts.length - 1]!;
            return (
              <g>
                {/* fill-box origin: without it the ping scales from the SVG's
                  top-left corner and the ring drifts out of the chart */}
                <circle
                  cx={xS(lp.x)}
                  cy={yS(lp.y)}
                  r="9"
                  fill={color}
                  opacity="0.2"
                  className="animate-ping"
                  style={{ transformBox: "fill-box", transformOrigin: "center" }}
                />
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
        {hoveredPoint &&
          (() => {
            const hX = xS(hoveredPoint.x);
            const hY = yS(hoveredPoint.y);
            const tY = hoveredTarget ? yS(hoveredTarget.y) : null;
            const delta = hoveredTarget ? Number((hoveredPoint.y - hoveredTarget.y).toFixed(2)) : 0;
            const pctDelta =
              hoveredTarget && hoveredTarget.y > 0
                ? ((delta / hoveredTarget.y) * 100).toFixed(1)
                : "0";
            const sign = delta >= 0 ? "+" : "";
            const deltaAmount =
              yLabel === "g"
                ? `${sign}${delta} g`
                : yLabel === "FCR"
                  ? `${sign}${delta.toFixed(2)}`
                  : `${sign}${Number(delta.toFixed(1))}`;
            const rows = [
              xLabel === "Day"
                ? tr("Day {x} Scan", { x: hoveredPoint.x })
                : `${tr(xLabel)} ${hoveredPoint.x}`,
              tr("Actual: {value}", { value: formatVal(hoveredPoint.y) }),
              ...(hoveredTarget
                ? [
                    `${tr(targetLabel)}: ${formatVal(hoveredTarget.y)}`,
                    tr("Diff: {deltaAmount} ({sign}{pctDelta}%)", { deltaAmount, sign, pctDelta }),
                  ]
                : []),
            ];
            // About 6.2px per character in the 10px monospace font, plus padding.
            const tipW = Math.min(
              Math.max(150, Math.ceil(Math.max(...rows.map((r) => r.length)) * 6.2) + 34),
              plotW - 8,
            );
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
                <circle
                  cx={hX}
                  cy={hY}
                  r="12"
                  fill={color}
                  opacity="0.22"
                  className="animate-pulse"
                />
                <circle
                  cx={hX}
                  cy={hY}
                  r="7"
                  fill="var(--surface-card)"
                  stroke={color}
                  strokeWidth="2.5"
                />
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
                  <line
                    x1="8"
                    x2={tipW - 8}
                    y1="1"
                    y2="1"
                    stroke={color}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    opacity="0.9"
                  />
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
export function DonutChart({
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

  const CX = 100,
    CY = 100,
    R = 72,
    r = 48;
  const rows = segments.map((seg) => ({ ...seg, pct: Math.round((seg.value / total) * 100) }));
  const biggest = rows.reduce((a, b) => (b.value > a.value ? b : a));

  let cumAngle = -Math.PI / 2;
  const arcs = rows
    .filter((s) => s.value > 0)
    .map((seg) => {
      const angle = (seg.value / total) * 2 * Math.PI;
      const startA = cumAngle,
        endA = cumAngle + angle;
      cumAngle = endA;
      const largeArc = angle > Math.PI ? 1 : 0;
      const x1 = CX + R * Math.cos(startA),
        y1 = CY + R * Math.sin(startA);
      const x2 = CX + R * Math.cos(endA),
        y2 = CY + R * Math.sin(endA);
      const ix1 = CX + r * Math.cos(endA),
        iy1 = CY + r * Math.sin(endA);
      const ix2 = CX + r * Math.cos(startA),
        iy2 = CY + r * Math.sin(startA);
      const mid = (startA + endA) / 2,
        midR = (R + r) / 2;
      return {
        ...seg,
        mid: { x: CX + midR * Math.cos(mid), y: CY + midR * Math.sin(mid) },
        d: `M${x1},${y1} A${R},${R} 0 ${largeArc},1 ${x2},${y2} L${ix1},${iy1} A${r},${r} 0 ${largeArc},0 ${ix2},${iy2} Z`,
      };
    });

  const shown = rows.find((row) => row.label === active?.label) ?? biggest;

  // Where the card sits: beside the pointer, kept inside the wrapper.
  const TIP_W = 196,
    TIP_H = 104;
  const wrapBox = wrapRef.current?.getBoundingClientRect();
  const tipLeft =
    active && wrapBox ? Math.max(0, Math.min(active.x + 14, wrapBox.width - TIP_W)) : 0;
  const tipTop =
    active && wrapBox
      ? active.y + 14 + TIP_H > wrapBox.height
        ? Math.max(0, active.y - TIP_H - 10)
        : active.y + 14
      : 0;

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
        aria-label={tr("Breakdown of {total} {unit}. Focus or tap a segment for details.", {
          total,
          unit,
        })}
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
        <text
          x={CX}
          y={CY - 8}
          textAnchor="middle"
          fontSize="22"
          fontWeight="800"
          pointerEvents="none"
          fill="var(--text-primary)"
          fontFamily="JetBrains Mono, monospace"
        >
          {shown.pct}%
        </text>
        <text
          x={CX}
          y={CY + 10}
          textAnchor="middle"
          fontSize="9"
          fontWeight="600"
          pointerEvents="none"
          fill="var(--text-tertiary)"
          letterSpacing="1"
        >
          {shown.label.toUpperCase()}
        </text>
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
              style={{
                background: row.label === active.label ? "var(--surface-raised)" : "transparent",
              }}
            >
              <span
                className="flex items-center gap-2 text-xs font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} />
                {row.label}
              </span>
              <span
                className="font-mono text-xs font-bold tabular-nums"
                style={{ color: row.color }}
              >
                {row.value} {unit} · {row.pct}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
