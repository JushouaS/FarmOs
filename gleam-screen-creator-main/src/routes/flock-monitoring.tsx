import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { AppShell } from "@/components/farm/AppShell";
import { SampleBadge, SampleNotice } from "@/components/farm/SampleBadge";
import type { BehaviorState, BroilerBird } from "@/lib/farm/dataset";
import { getOperationsOverview } from "@/lib/farm/repository";
import { sampleForDay } from "@/lib/farm/sample";

export const Route = createFileRoute("/flock-monitoring")({
  head: () => ({ meta: [{ title: "Flock Tracking — Cerebroil" }] }),
  loader: () => getOperationsOverview(),
  component: FlockTrackingPage,
});

/** The "Inactive" chip also covers the dataset's "Inactivity" state. */
function matchesBehaviorFilter(behavior: BehaviorState, filter: BehaviorState | "All") {
  if (filter === "All") return true;
  if (filter === "Inactive") return behavior === "Inactive" || behavior === "Inactivity";
  return behavior === filter;
}

type SortKey = "id" | "weightG" | "behavior";

const BCOLOR: Record<string, string> = {
  Active:     "var(--status-green)",
  Inactive:   "var(--status-red)",
  Inactivity: "var(--status-red)",
  Huddling:   "var(--status-amber)",
  Sleeping:   "var(--status-blue)",
};

/* ── Mobile card view (< md) ──────────────────────────────── */
function BirdCard({ b, stdG, day }: { b: BroilerBird; stdG: number; day: number }) {
  const delta   = ((b.weightG - stdG) / stdG * 100).toFixed(1);
  const isAbove = b.weightG >= stdG;
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
          <p className="label-section">vs Day {day} Std</p>
          <p className="font-mono font-semibold mt-0.5"
            style={{ color: isAbove ? "var(--status-green)" : "var(--status-red)" }}>
            {isAbove ? "+" : ""}{delta}%
          </p>
        </div>
      </div>
    </div>
  );
}

function FlockTrackingPage() {
  // The sample flock, moved to the grow-out day set in Settings.
  const overview = Route.useLoaderData() as any;
  const sample = useMemo(() => sampleForDay(overview), [overview]);
  const { farm, broilers } = sample;
  const STD_G = sample.standardG;
  const [sortKey, setSortKey]  = useState<SortKey>("id");
  const [sortAsc, setSortAsc]  = useState(true);
  const [filterB, setFilterB]  = useState<BehaviorState | "All">("All");
  const [search,  setSearch]   = useState("");

  const sorted = [...broilers]
    .filter((b) => matchesBehaviorFilter(b.behavior, filterB))
    .filter((b) => !search || b.id.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === "id")         cmp = a.id.localeCompare(b.id);
      else if (sortKey === "weightG")    cmp = a.weightG - b.weightG;
      else if (sortKey === "behavior")   cmp = a.behavior.localeCompare(b.behavior);
      return sortAsc ? cmp : -cmp;
    });

  const handleSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(true); }
  };

  const avgWeight = Math.round(broilers.reduce((s, b) => s + b.weightG, 0) / broilers.length);
  const inactive  = broilers.filter((b) => b.behavior === "Inactive" || b.behavior === "Inactivity" || b.flag === "INACTIVE").length;
  const flagged   = broilers.filter((b) => b.flag).length;

  return (
    <AppShell>
      <SampleNotice>
        Per-bird tracking is not connected to the database yet, so this table is built-in sample data for{" "}
        {broilers.length} birds on Day {farm.cycle.day}. The Dashboard shows the live flock.
      </SampleNotice>

      {/* Header */}
      <div className="mb-5">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Flock Tracking
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            {broilers.length} birds · Pen 1 · Day{" "}
            <span className="font-mono" style={{ color: "var(--cv-accent)" }}>{farm.cycle.day}</span>
            {`/${sample.endDay}`}
          </p>
        </div>
      </div>

      {/* One summary card */}
      <div className="cb-card mb-5 grid grid-cols-3 divide-x divide-[color:var(--border-subtle)]">
        {[
          { label: "Total Birds", value: String(broilers.length), color: "var(--cv-accent)" },
          { label: "Avg Weight",  value: `${(avgWeight/1000).toFixed(3)} kg`, color: "var(--brand)" },
          { label: "Inactive",    value: String(inactive), color: inactive > 0 ? "var(--status-red)" : "var(--status-green)" },
        ].map((k) => (
          <div key={k.label} className="min-w-0 px-4 py-3.5 sm:px-6">
            <p className="label-section">{k.label}</p>
            <p className="mt-1 font-mono text-lg font-bold" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Behavior filter */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        {(["All", "Active", "Inactive"] as (BehaviorState | "All")[]).map((b) => (
          <button key={b} onClick={() => setFilterB(b)}
            aria-pressed={filterB === b}
            className="tap rounded-full px-3 py-1 font-mono text-[11px] font-semibold transition-all"
            style={filterB === b
              ? { background: "var(--brand)", color: "var(--text-inverse)" }
              : { background: "var(--surface-raised)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
            {b === "All"
              ? `All (${broilers.length})`
              : `${b} (${broilers.filter((x) => matchesBehaviorFilter(x.behavior, b)).length})`}
          </button>
        ))}
      </div>
        <div className="relative w-full sm:w-56">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: "var(--text-tertiary)" }}
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            aria-label="Search birds by ID"
            className="cb-input w-full pl-9 font-mono text-sm"
          />
        </div>
      </div>

      {/* ── Mobile card list (< md) ─────────────────────────── */}
      <div className="md:hidden space-y-3">
        {sorted.map((b) => <BirdCard key={b.id} b={b} stdG={STD_G} day={farm.cycle.day} />)}
        <p className="text-xs text-right pt-1" style={{ color: "var(--text-tertiary)" }}>
          {sorted.length} of {broilers.length} birds
        </p>
      </div>

      {/* ── Desktop table (>= md) ──────────────────────────── */}
      <div className="hidden md:block overflow-x-auto rounded-xl"
        style={{ border: "1px solid var(--border-default)" }}>
        <table className="w-full table-fixed" style={{ minWidth: "520px" }}>
          <thead>
            <tr style={{ background: "var(--surface-raised)", borderBottom: "1px solid var(--border-subtle)" }}>
              {([
                ["id",         "Bird ID",      "w-[16%]"],
                ["weightG",    "Est. Weight",  "w-[26%]"],
                ["behavior",   "Status",       "w-[26%]"],
                [null,         "vs Standard",  "w-[22%]"],
                [null,         "Flag",         "w-[10%]"],
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
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold"
                      style={{ color: BCOLOR[b.behavior] }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: BCOLOR[b.behavior] }} />
                      {b.behavior}
                    </span>
                  </td>
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
        {sorted.length} of {broilers.length} birds
      </p>
    </AppShell>
  );
}
