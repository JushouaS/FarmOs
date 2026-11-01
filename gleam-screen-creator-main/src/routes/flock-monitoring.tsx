import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { AppShell } from "@/components/farm/AppShell";
import { SampleBadge, SampleNotice } from "@/components/farm/SampleBadge";
import type { BroilerBird } from "@/lib/farm/dataset";
import { deleteActualWeight, fetchActualWeights, fetchPreviousWeights, saveActualWeight } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { getOperationsOverview } from "@/lib/farm/repository";
import { sampleForDay } from "@/lib/farm/sample";
import { T, tr } from "@/lib/i18n";

export const Route = createFileRoute("/flock-monitoring")({
  head: () => ({ meta: [{ title: tr("Flock Tracking — Cerebroil") }] }),
  loader: () => getOperationsOverview(),
  component: FlockTrackingPage,
});

type Filter = "all" | "weighed" | "missing";
type SortKey = "id" | "weightG" | "actual" | "diff";

/* The weight a person measures is typed in kilograms, with at most 3 decimals (the
 * way the estimate is shown), once a day, and kept in grams with the estimate it is
 * compared with. These are the limits the API accepts. */
const MIN_G = 20;
const MAX_G = 8000;
const kgText = (g: number) => (g / 1000).toFixed(3);

/** What a person has typed, cut down to a weight in kg: digits and one point, at most 3 decimals. */
function cleanKg(text: string): string {
  const t = text.replace(",", ".").replace(/[^0-9.]/g, "");
  const dot = t.indexOf(".");
  if (dot === -1) return t.slice(0, 1);
  return `${t.slice(0, dot).slice(0, 1)}.${t.slice(dot + 1).replace(/\./g, "").slice(0, 3)}`;
}
/** Within this share of the estimate counts as close (green), within the second as fair (amber). */
const CLOSE_PCT = 5;
const FAIR_PCT = 10;
/** A weight this far from the estimate is probably a typing slip, so the page says to check it. */
const CHECK_PCT = 40;

const diffColor = (pct: number) =>
  Math.abs(pct) <= CLOSE_PCT ? "var(--status-green)" : Math.abs(pct) <= FAIR_PCT ? "var(--status-amber)" : "var(--status-red)";

/** How far the measured weight is from the estimate, in kg and in percent. */
function Difference({ actualG, estG }: { actualG: number | undefined; estG: number }) {
  if (actualG === undefined) return <span className="font-mono text-xs" style={{ color: "var(--text-tertiary)" }}>—</span>;
  const diff = actualG - estG;
  const pct = (diff / estG) * 100;
  const sign = (n: number) => (n > 0 ? "+" : "");
  return (
    <span className="font-mono text-xs font-semibold" style={{ color: diffColor(pct) }}>
      {sign(diff)}{(diff / 1000).toFixed(3)} kg ({sign(pct)}{pct.toFixed(1)}%)
      {Math.abs(pct) >= CHECK_PCT && (
        <span className="block text-[10px] font-normal" style={{ color: "var(--status-amber-text)" }}>{tr("Far from the estimate. Check it.")}</span>
      )}
    </span>
  );
}

/** How much a bird has gained since the last day it was weighed. */
function Gain({ actualG, previous }: { actualG: number | undefined; previous: { day: number; actualG: number } | undefined }) {
  if (actualG === undefined || previous === undefined) return <span className="font-mono text-xs" style={{ color: "var(--text-tertiary)" }}>—</span>;
  const gain = actualG - previous.actualG;
  return (
    <span className="font-mono text-xs font-semibold" style={{ color: gain >= 0 ? "var(--status-green)" : "var(--status-red)" }}>
      {gain > 0 ? "+" : ""}{(gain / 1000).toFixed(3)} kg
      <span className="block text-[10px] font-normal" style={{ color: "var(--text-tertiary)" }}>{tr("since Day {day}", { day: previous.day })}</span>
    </span>
  );
}

/** The box a person types a bird's weight in. It saves when they leave the box or press Enter. */
function WeightInput({
  birdId,
  value,
  disabled,
  onCommit,
}: {
  birdId: string;
  value: number | undefined;
  disabled: boolean;
  onCommit: (text: string) => Promise<boolean>;
}) {
  const shown = value === undefined ? "" : kgText(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  // "Saved" shows for a moment after the weight is kept.
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const commit = async () => {
    if (text.trim() === shown) return;
    // A refused value goes back to what was saved.
    if (await onCommit(text)) setSaved(true);
    else setText(shown);
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        placeholder="0.000"
        maxLength={5}
        aria-label={tr("Actual weight of {id} in kg", { id: birdId })}
        onChange={(e) => setText(cleanKg(e.target.value))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(shown);
            e.currentTarget.blur();
          }
        }}
        className="cb-input w-24 font-mono text-sm disabled:opacity-60"
      />
      <span className="font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>kg</span>
      {saved && (
        <span role="status" className="inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold" style={{ color: "var(--status-green)" }}>
          <Check className="h-3 w-3" aria-hidden="true" />
          {tr("Saved")}
        </span>
      )}
    </span>
  );
}

/* ── Mobile card view (< md) ──────────────────────────────── */
function BirdCard({
  b,
  stdG,
  day,
  actualG,
  previous,
  canEdit,
  onCommit,
}: {
  b: BroilerBird;
  stdG: number;
  day: number;
  actualG: number | undefined;
  previous: { day: number; actualG: number } | undefined;
  canEdit: boolean;
  onCommit: (text: string) => Promise<boolean>;
}) {
  // Once the bird has been weighed, its real weight replaces the estimate.
  const refG = actualG ?? b.weightG;
  const delta = (((refG - stdG) / stdG) * 100).toFixed(1);
  const isAbove = refG >= stdG;
  return (
    <div className="cb-card p-4 space-y-3" style={b.flag === "LOW_WEIGHT" ? { borderLeft: "3px solid var(--status-amber)" } : {}}>
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-base font-bold" style={{ color: "var(--cv-accent)" }}>{b.id}</span>
        {b.flag === "LOW_WEIGHT" && <span className="badge-amber">{tr("LOW W")}</span>}
      </div>
      {/* Data rows */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
        <div>
          <p className="label-section">{tr("Est. Weight")}</p>
          <p className="font-mono font-semibold mt-0.5" style={{ color: "var(--text-primary)" }}>{tr("{value} kg", { value: (b.weightG / 1000).toFixed(3) })}</p>
        </div>
        <div>
          <p className="label-section">{tr("vs Day {day} Std", { day })}</p>
          <p className="font-mono font-semibold mt-0.5" style={{ color: isAbove ? "var(--status-green)" : "var(--status-red)" }}>
            {isAbove ? "+" : ""}{delta}%
            <span className="ml-1 text-[10px] font-normal" style={{ color: "var(--text-tertiary)" }}>{actualG === undefined ? tr("est.") : tr("actual")}</span>
          </p>
        </div>
        <div>
          <p className="label-section">{tr("Actual Weight")}</p>
          <div className="mt-1">
            <WeightInput birdId={b.id} value={actualG} disabled={!canEdit} onCommit={onCommit} />
          </div>
        </div>
        <div>
          <p className="label-section">{tr("Difference")}</p>
          <p className="mt-2"><Difference actualG={actualG} estG={b.weightG} /></p>
        </div>
        <div className="col-span-2">
          <p className="label-section">{tr("Gain")}</p>
          <p className="mt-1"><Gain actualG={actualG} previous={previous} /></p>
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
  const day = farm.cycle.day;
  const { user } = useAuth();
  // Entering weights is for the people who work with the flock.
  const canEdit = Boolean(user?.roles?.some((r) => r === "ADMIN" || r === "FARM_MANAGER" || r === "OPERATOR"));

  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  // The weights entered for today, in grams, by bird.
  const [actuals, setActuals] = useState<Record<string, number>>({});
  // What the database holds for each bird, as far as this page knows, and the saves still waiting
  // for each bird. A bird has one weight per day, so a new value replaces the old one; the saves
  // for the same bird are sent in the order they were made, so the last edit is the one that stays.
  const stored = useRef<Record<string, number>>({});
  const queue = useRef(new Map<string, Promise<unknown>>());
  const enqueue = (id: string, job: () => Promise<unknown>): Promise<unknown> => {
    const run = (queue.current.get(id) ?? Promise.resolve()).catch(() => undefined).then(job);
    queue.current.set(id, run);
    return run;
  };
  const [problem, setProblem] = useState<string | null>(null);
  // Each bird's last weight before today, for its gain.
  const [previous, setPrevious] = useState<Record<string, { day: number; actualG: number }>>({});

  useEffect(() => {
    let alive = true;
    setPrevious({});
    fetchPreviousWeights(day)
      .then((rows) => alive && setPrevious(Object.fromEntries(rows.map((r) => [r.birdId, { day: r.day, actualG: r.actualG }]))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [day]);

  useEffect(() => {
    let alive = true;
    setActuals({});
    stored.current = {};
    queue.current = new Map();
    setProblem(null);
    fetchActualWeights(day)
      .then((rows) => {
        if (!alive) return;
        stored.current = Object.fromEntries(rows.map((r) => [r.birdId, r.actualG]));
        setActuals({ ...stored.current });
      })
      .catch(() => alive && setProblem(tr("Could not load the weights you entered. Refresh the page to try again.")));
    return () => {
      alive = false;
    };
  }, [day]);

  /** Saves what was typed for a bird. Returns false when the text was refused. */
  const commit = (b: BroilerBird) => async (text: string): Promise<boolean> => {
    const trimmed = text.trim();
    const before = actuals[b.id];
    const put = (value: number | undefined) =>
      setActuals((prev) => {
        const next = { ...prev };
        if (value === undefined) delete next[b.id];
        else next[b.id] = value;
        return next;
      });
    try {
      if (trimmed === "") {
        if (before === undefined) return true;
        put(undefined);
        await enqueue(b.id, () => deleteActualWeight(b.id, day));
        delete stored.current[b.id];
      } else {
        const value = Math.round(Number(trimmed) * 1000);
        if (!Number.isFinite(value) || value < MIN_G || value > MAX_G) {
          setProblem(tr("Enter the weight in kg with up to 3 decimals, between {min} and {max}.", { min: kgText(MIN_G), max: kgText(MAX_G) }));
          return false;
        }
        if (value === before) return true;
        put(value);
        await enqueue(b.id, () => saveActualWeight({ birdId: b.id, day, actualG: value, estimatedG: b.weightG }));
        stored.current[b.id] = value;
      }
      setProblem(null);
      return true;
    } catch {
      put(stored.current[b.id]);
      setProblem(tr("Could not save the weight for {id}. Try again.", { id: b.id }));
      return false;
    }
  };

  const diffPct = (b: BroilerBird): number | null => (actuals[b.id] === undefined ? null : ((actuals[b.id]! - b.weightG) / b.weightG) * 100);

  const sorted = [...broilers]
    .filter((b) => filter === "all" || (filter === "weighed") === (actuals[b.id] !== undefined))
    .filter((b) => !search || b.id.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === "id") cmp = a.id.localeCompare(b.id);
      else if (sortKey === "weightG") cmp = a.weightG - b.weightG;
      else if (sortKey === "actual") cmp = (actuals[a.id] ?? Infinity) - (actuals[b.id] ?? Infinity);
      else cmp = (diffPct(a) ?? Infinity) - (diffPct(b) ?? Infinity);
      if (Number.isNaN(cmp)) cmp = 0;
      return sortAsc ? cmp : -cmp;
    });

  const handleSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(true); }
  };

  const avgWeight = Math.round(broilers.reduce((s, b) => s + b.weightG, 0) / broilers.length);
  const weighed = broilers.filter((b) => actuals[b.id] !== undefined);
  // How far off the estimate is on average, whichever way (so a high and a low bird do not cancel out).
  const avgOff = weighed.length ? weighed.reduce((s, b) => s + Math.abs(diffPct(b)!), 0) / weighed.length : null;

  return (
    <AppShell>
      <SampleNotice>
        {tr("Per-bird tracking is not connected to the database yet, so this table is built-in sample data for {length} birds on Day {day}. The Dashboard shows the live flock.", { length: broilers.length, day: farm.cycle.day })}{" "}
        {tr("The actual weights you enter are saved.")}
      </SampleNotice>

      {/* Header */}
      <div className="mb-5">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            {tr("Flock Tracking")}
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            {broilers.length} {tr("birds · Pen 1 · Day")}{" "}
            <span className="font-mono" style={{ color: "var(--cv-accent)" }}>{farm.cycle.day}</span>
            {`/${sample.endDay}`}
          </p>
        </div>
      </div>

      {/* One summary card */}
      <div className="cb-card mb-3 grid grid-cols-2 sm:grid-cols-4 sm:divide-x divide-[color:var(--border-subtle)]">
        {[
          { label: tr("Total Birds"), value: String(broilers.length), color: "var(--cv-accent)" },
          { label: tr("Avg Weight"), value: `${(avgWeight / 1000).toFixed(3)} kg`, color: "var(--brand)" },
          { label: tr("Weighed Today"), value: `${weighed.length}/${broilers.length}`, color: weighed.length ? "var(--status-green)" : "var(--text-tertiary)" },
          { label: tr("Avg Difference"), value: avgOff === null ? "—" : `${avgOff.toFixed(1)}%`, color: avgOff === null ? "var(--text-tertiary)" : diffColor(avgOff) },
        ].map((k, i) => (
          <div
            key={k.label}
            className={`min-w-0 px-4 py-3.5 sm:px-6 max-sm:border-[color:var(--border-subtle)] ${i < 2 ? "max-sm:border-b" : ""} ${i % 2 === 0 ? "max-sm:border-r" : ""}`}
          >
            <p className="label-section">{k.label}</p>
            <p className="mt-1 font-mono text-lg font-bold" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>
      <p className="mb-5 text-xs" style={{ color: "var(--text-tertiary)" }}>
        {tr("Type each bird's weight in kg (up to 3 decimals, like 0.946) and press Enter or click away. It saves by itself for Day {day}; there is no submit button. It is compared with the estimate (within {close}% green, within {fair}% amber, more red), and the vs Standard figure then uses your actual weight. Each new day starts with empty boxes; the earlier days stay saved, and each bird's Gain compares it with its last weighing.", { day, close: CLOSE_PCT, fair: FAIR_PCT })}
      </p>
      {!canEdit && (
        <p className="mb-3 text-xs" style={{ color: "var(--status-amber-text)" }}>{tr("Only an administrator, farm manager or operator can enter weights.")}</p>
      )}
      {problem && (
        <p role="alert" className="mb-3 text-sm" style={{ color: "var(--status-red-text)" }}>{problem}</p>
      )}

      {/* Which birds to show */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(["all", "weighed", "missing"] as Filter[]).map((f) => {
            const n = f === "all" ? broilers.length : f === "weighed" ? weighed.length : broilers.length - weighed.length;
            const label = f === "all" ? tr("All ({length})", { length: n }) : f === "weighed" ? tr("Weighed ({n})", { n }) : tr("Not weighed ({n})", { n });
            return (
              <button key={f} onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className="tap rounded-full px-3 py-1 font-mono text-[11px] font-semibold transition-all"
                style={filter === f
                  ? { background: "var(--brand)", color: "var(--text-inverse)" }
                  : { background: "var(--surface-raised)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
                {label}
              </button>
            );
          })}
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
            placeholder={tr("Search")}
            aria-label={tr("Search birds by ID")}
            className="cb-input w-full pl-9 font-mono text-sm"
          />
        </div>
      </div>

      {/* ── Mobile card list (< md) ─────────────────────────── */}
      <div className="md:hidden space-y-3">
        {sorted.map((b) => (
          <BirdCard key={b.id} b={b} stdG={STD_G} day={farm.cycle.day} actualG={actuals[b.id]} previous={previous[b.id]} canEdit={canEdit} onCommit={commit(b)} />
        ))}
        <p className="text-xs text-right pt-1" style={{ color: "var(--text-tertiary)" }}>{tr("{length} of {length2} birds", { length: sorted.length, length2: broilers.length })}</p>
      </div>

      {/* ── Desktop table (>= md) ──────────────────────────── */}
      <div className="hidden md:block overflow-x-auto rounded-xl"
        style={{ border: "1px solid var(--border-default)" }}>
        <table className="w-full table-fixed" style={{ minWidth: "760px" }}>
          <thead>
            <tr style={{ background: "var(--surface-raised)", borderBottom: "1px solid var(--border-subtle)" }}>
              {([
                ["id",       T("Bird ID"),       "w-[11%]"],
                ["weightG",  T("Est. Weight"),   "w-[15%]"],
                ["actual",   T("Actual Weight"), "w-[20%]"],
                ["diff",     T("Difference"),    "w-[19%]"],
                [null,       T("Gain"),          "w-[14%]"],
                [null,       T("vs Standard"),   "w-[14%]"],
                [null,       T("Flag"),          "w-[7%]"],
              ] as [SortKey | null, string, string][]).map(([k, label, w]) => (
                <th key={label} className={`${w} px-4 py-3 text-left`}>
                  {k ? (
                    <button onClick={() => handleSort(k)}
                      className="tap flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wide transition-colors hover:text-[color:var(--text-primary)]"
                      style={{ color: "var(--text-tertiary)" }}>
                      {tr(label)}
                      <span style={{ color: sortKey === k ? "var(--brand)" : "var(--text-disabled)" }}>
                        {sortKey === k ? (sortAsc ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  ) : (
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: "var(--text-tertiary)" }}>{tr(label)}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y" style={{ background: "var(--surface-card)", borderColor: "var(--border-subtle)" }}>
            {sorted.map((b) => {
              // Once the bird has been weighed, its real weight replaces the estimate.
              const refG    = actuals[b.id] ?? b.weightG;
              const delta   = ((refG - STD_G) / STD_G * 100).toFixed(1);
              const isAbove = refG >= STD_G;
              const rowBg   = b.flag === "LOW_WEIGHT" ? "rgba(251,191,36,0.05)" : undefined;
              return (
                <tr key={b.id}
                  style={{ background: rowBg ?? "transparent" }}
                  onMouseEnter={(e) => { if (!rowBg) e.currentTarget.style.background = "var(--surface-raised)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = rowBg ?? "transparent"; }}>
                  {/* ID */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-sm font-bold" style={{ color: "var(--cv-accent)" }}>
                      {b.id}
                    </span>
                  </td>
                  {/* Estimated weight */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {(b.weightG / 1000).toFixed(3)}
                    </span>
                    <span className="font-mono text-[11px] ml-1" style={{ color: "var(--text-tertiary)" }}>{tr("kg")}</span>
                  </td>
                  {/* Actual weight, typed in */}
                  <td className="px-4 py-2.5">
                    <WeightInput birdId={b.id} value={actuals[b.id]} disabled={!canEdit} onCommit={commit(b)} />
                  </td>
                  {/* Difference from the estimate */}
                  <td className="px-4 py-2.5">
                    <Difference actualG={actuals[b.id]} estG={b.weightG} />
                  </td>
                  {/* Gain since the last day it was weighed */}
                  <td className="px-4 py-2.5">
                    <Gain actualG={actuals[b.id]} previous={previous[b.id]} />
                  </td>
                  {/* vs standard */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs font-semibold"
                      style={{ color: isAbove ? "var(--status-green)" : "var(--status-red)" }}>
                      {isAbove ? "+" : ""}{delta}%
                    </span>
                    <span className="ml-1.5 text-[10px]" style={{ color: "var(--text-tertiary)" }}>{actuals[b.id] === undefined ? tr("est.") : tr("actual")}</span>
                  </td>
                  {/* Flag */}
                  <td className="px-4 py-2.5">
                    {b.flag === "LOW_WEIGHT" && <span className="badge-amber">{tr("LOW W")}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-right" style={{ color: "var(--text-tertiary)" }}>{tr("{length} of {length2} birds", { length: sorted.length, length2: broilers.length })}</p>
    </AppShell>
  );
}
