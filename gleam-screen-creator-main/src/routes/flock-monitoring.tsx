import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/farm/AppShell";
import { broilers, farm, modelTelemetry, type BehaviorState } from "@/lib/farm/dataset";

export const Route = createFileRoute("/flock-monitoring")({
  head: () => ({ meta: [{ title: "Flock Tracking — Cerebroil" }] }),
  component: FlockTrackingPage,
});

type SortKey = "id" | "weightG" | "behavior" | "yoloConf" | "weightConf";

const BCOLOR: Record<string, string> = {
  Active:     "var(--status-green)",
  Inactive:   "var(--status-red)",
  Inactivity: "var(--status-red)",
  Huddling:   "var(--status-amber)",
  Sleeping:   "var(--status-blue)",
};

const STD_G = farm.weight.standardG;

/**
 * Confidence threshold:
 *   >= 90% — green  (reliable)
 *   75–89% — amber  (borderline)
 *   < 75%  — red    (unreliable — flag for re-scan)
 */
function confColor(pct: number): string {
  if (pct >= 90) return "var(--status-green)";
  if (pct >= 75) return "var(--status-amber)";
  return "var(--status-red)";
}

function ConfCell({ value }: { value: number }) {
  const pct   = Math.round(value * 100);
  const color = confColor(pct);
  const warn  = pct < 75;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-12 shrink-0 rounded-full overflow-hidden sm:w-16" style={{ background: "var(--surface-sunken)" }}>
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-mono text-[11px] font-semibold" style={{ color }}>
        {pct}%{warn ? " ⚠" : ""}
      </span>
    </div>
  );
}

/* ── Mobile card view (< md) ──────────────────────────────── */
function BirdCard({ b }: { b: typeof broilers[number] }) {
  const delta   = ((b.weightG - STD_G) / STD_G * 100).toFixed(1);
  const isAbove = b.weightG >= STD_G;
  return (
    <div
      className="cb-card p-4 space-y-3"
      style={b.flag === "INACTIVE"
        ? { borderLeft: "3px solid var(--status-red)" }
        : b.flag === "LOW_WEIGHT"
          ? { borderLeft: "3px solid var(--status-amber)" }
          : {}}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-base font-bold" style={{ color: "var(--cv-accent)" }}>{b.id}</span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold"
            style={{
              background: `${BCOLOR[b.behavior]}18`,
              color: BCOLOR[b.behavior],
              border: `1px solid ${BCOLOR[b.behavior]}33`,
            }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: BCOLOR[b.behavior] }} />
            {b.behavior}
          </span>
          {b.flag === "INACTIVE"   && <span className="badge-red">INACT</span>}
          {b.flag === "LOW_WEIGHT" && <span className="badge-amber">LOW W</span>}
        </div>
      </div>
      {/* Data rows */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <p className="label-section">Est. Weight</p>
          <p className="font-mono font-semibold mt-0.5" style={{ color: "var(--text-primary)" }}>
            {(b.weightG / 1000).toFixed(3)} kg
          </p>
        </div>
        <div>
          <p className="label-section">vs Day 14 Std</p>
          <p className="font-mono font-semibold mt-0.5"
            style={{ color: isAbove ? "var(--status-green)" : "var(--status-red)" }}>
            {isAbove ? "+" : ""}{delta}%
          </p>
        </div>
        <div>
          <p className="label-section">Detection Conf.</p>
          <div className="mt-0.5"><ConfCell value={b.yoloConfidence} /></div>
        </div>
        <div>
          <p className="label-section">Weight Conf.</p>
          <div className="mt-0.5"><ConfCell value={b.weightConfidence} /></div>
        </div>
      </div>
    </div>
  );
}

function FlockTrackingPage() {
  const [sortKey, setSortKey]  = useState<SortKey>("id");
  const [sortAsc, setSortAsc]  = useState(true);
  const [filterB, setFilterB]  = useState<BehaviorState | "All">("All");
  const [search,  setSearch]   = useState("");

  const sorted = [...broilers]
    .filter((b) => filterB === "All" || b.behavior === filterB)
    .filter((b) => !search || b.id.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === "id")         cmp = a.id.localeCompare(b.id);
      else if (sortKey === "weightG")    cmp = a.weightG - b.weightG;
      else if (sortKey === "behavior")   cmp = a.behavior.localeCompare(b.behavior);
      else if (sortKey === "yoloConf")   cmp = a.yoloConfidence - b.yoloConfidence;
      else if (sortKey === "weightConf") cmp = a.weightConfidence - b.weightConfidence;
      return sortAsc ? cmp : -cmp;
    });

  const handleSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(true); }
  };

  const avgWeight = Math.round(broilers.reduce((s, b) => s + b.weightG, 0) / broilers.length);
  const inactive  = broilers.filter((b) => b.behavior === "Inactive" || b.behavior === "Inactivity" || b.flag === "INACTIVE").length;
  const flagged   = broilers.filter((b) => b.flag).length;
  const lowConf   = broilers.filter((b) => Math.min(b.yoloConfidence, b.weightConfidence) < 0.75).length;

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Flock Tracking
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            {broilers.length} birds · Pen 1 · Day{" "}
            <span className="font-mono" style={{ color: "var(--cv-accent)" }}>{farm.cycle.day}</span>
            /42
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search B-001…"
          aria-label="Search birds by ID"
          className="cb-input w-full sm:w-44 font-mono text-sm"
        />
      </div>

      {/* KPI cards — responsive grid */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Birds",  value: String(broilers.length), color: "var(--cv-accent)"      },
          { label: "Avg Weight",   value: `${(avgWeight/1000).toFixed(3)} kg`, color: "var(--brand)" },
          { label: "Inactive",     value: String(inactive),  color: inactive  > 0 ? "var(--status-red)"   : "var(--status-green)"  },
          { label: "Low Conf <75%", value: String(lowConf),  color: lowConf   > 0 ? "var(--status-amber)" : "var(--text-tertiary)" },
        ].map((k) => (
          <div key={k.label} className="cb-card px-4 py-3.5">
            <p className="label-section">{k.label}</p>
            <p className="font-mono text-lg font-bold mt-1" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Behavior filter */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {(["All", "Active", "Inactive"] as (BehaviorState | "All")[]).map((b) => (
          <button key={b} onClick={() => setFilterB(b)}
            aria-pressed={filterB === b}
            className="tap rounded-full px-3 py-1 font-mono text-[11px] font-semibold transition-all"
            style={filterB === b
              ? { background: "var(--brand)", color: "var(--text-inverse)" }
              : { background: "var(--surface-raised)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
            {b === "All"
              ? `All (${broilers.length})`
              : `${b} (${broilers.filter((x) => x.behavior === b).length})`}
          </button>
        ))}
      </div>

      {/* ── Mobile card list (< md) ─────────────────────────── */}
      <div className="md:hidden space-y-3">
        {sorted.map((b) => <BirdCard key={b.id} b={b} />)}
        <p className="text-xs text-right pt-1" style={{ color: "var(--text-tertiary)" }}>
          {sorted.length} of {broilers.length} birds
        </p>
      </div>

      {/* ── Desktop table (>= md) ──────────────────────────── */}
      <div className="hidden md:block overflow-x-auto rounded-xl"
        style={{ border: "1px solid var(--border-default)" }}>
        <table className="w-full" style={{ minWidth: "720px" }}>
          <thead>
            <tr style={{ background: "var(--surface-raised)", borderBottom: "1px solid var(--border-subtle)" }}>
              {([
                ["id",         "Bird ID",      "w-[80px]"],
                ["weightG",    "Est. Weight",  "w-[120px]"],
                ["behavior",   "Status",       "w-[120px]"],
                ["yoloConf",   "Detection Conf.", "w-[150px]"],
                ["weightConf", "Weight Conf.",    "w-[150px]"],
                [null,         "vs Standard",  "w-[110px]"],
                [null,         "Flag",         "w-[80px]"],
              ] as [SortKey | null, string, string][]).map(([k, label, w]) => (
                <th key={label} className={`${w} px-4 py-3 text-left`}>
                  {k ? (
                    <button onClick={() => handleSort(k)}
                      className="tap flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wide transition-colors hover:text-[color:var(--text-primary)]"
                      style={{ color: "var(--text-tertiary)" }}>
                      {label}
                      <span style={{ color: sortKey === k ? "var(--brand)" : "var(--text-disabled)" }}>
                        {sortKey === k ? (sortAsc ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  ) : (
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: "var(--text-tertiary)" }}>{label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y" style={{ background: "var(--surface-card)", borderColor: "var(--border-subtle)" }}>
            {sorted.map((b) => {
              const delta   = ((b.weightG - STD_G) / STD_G * 100).toFixed(1);
              const isAbove = b.weightG >= STD_G;
              const rowBg   = b.flag === "INACTIVE"
                ? "rgba(239,68,68,0.05)"
                : b.flag === "LOW_WEIGHT"
                  ? "rgba(251,191,36,0.05)"
                  : undefined;
              return (
                <tr key={b.id}
                  style={{ background: rowBg ?? "transparent" }}
                  onMouseEnter={(e) => { if (!rowBg) e.currentTarget.style.background = "var(--surface-raised)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = rowBg ?? "transparent"; }}>
                  {/* ID */}
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm font-bold" style={{ color: "var(--cv-accent)" }}>
                      {b.id}
                    </span>
                  </td>
                  {/* Weight */}
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {(b.weightG / 1000).toFixed(3)}
                    </span>
                    <span className="font-mono text-[11px] ml-1" style={{ color: "var(--text-tertiary)" }}>kg</span>
                  </td>
                  {/* Behavior */}
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold"
                      style={{
                        background: `${BCOLOR[b.behavior]}18`,
                        color: BCOLOR[b.behavior],
                        border: `1px solid ${BCOLOR[b.behavior]}33`,
                      }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: BCOLOR[b.behavior] }} />
                      {b.behavior}
                    </span>
                  </td>
                  {/* YOLOv8 conf */}
                  <td className="px-4 py-3"><ConfCell value={b.yoloConfidence} /></td>
                  {/* CNN conf */}
                  <td className="px-4 py-3"><ConfCell value={b.weightConfidence} /></td>
                  {/* vs standard */}
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-semibold"
                      style={{ color: isAbove ? "var(--status-green)" : "var(--status-red)" }}>
                      {isAbove ? "+" : ""}{delta}%
                    </span>
                  </td>
                  {/* Flag */}
                  <td className="px-4 py-3">
                    {b.flag === "INACTIVE"   && <span className="badge-red">INACT</span>}
                    {b.flag === "LOW_WEIGHT" && <span className="badge-amber">LOW W</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-right" style={{ color: "var(--text-tertiary)" }}>
        {sorted.length} of {broilers.length} birds · Conf. thresholds: ≥90% green · 75–89% amber · &lt;75% red ⚠
      </p>
    </AppShell>
  );
}
