import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { AppShell } from "@/components/farm/AppShell";
import { deleteActualWeight, fetchActualWeights, fetchPreviousWeights, saveActualWeight } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { getOperationsOverview } from "@/lib/farm/repository";
import { T, tr } from "@/lib/i18n";

export const Route = createFileRoute("/flock-monitoring")({
  head: () => ({ meta: [{ title: tr("Flock Tracking — Cerebroil") }] }),
  loader: () => getOperationsOverview(),
  component: FlockTrackingPage,
});

type Filter = "all" | "weighed" | "missing";
type SortKey = "id" | "actual" | "vsStd";

/* The weight a person measures is typed in kilograms, with at most 3 decimals, once a
 * day, and kept in grams. These are the limits the API accepts. */
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
/** Within this share of the day's standard counts as on target (green), within the second as fair (amber). */
const CLOSE_PCT = 5;
const FAIR_PCT = 10;
/** This far below the standard reads as an underweight bird, so the row is flagged. */
const LOW_PCT = FAIR_PCT;
/** A spread taken from fewer birds than this says more about the sample than about the flock. */
const MIN_SPREAD_N = 5;
/** A pen holds thousands of birds, so the list arrives a page at a time. */
const PAGE_SIZE = 100;

const offColor = (pct: number) =>
  Math.abs(pct) <= CLOSE_PCT ? "var(--status-green)" : Math.abs(pct) <= FAIR_PCT ? "var(--status-amber)" : "var(--status-red)";

/** How far a typed weight is from the breed's standard for that day, in percent. */
const vsStandard = (actualG: number, standardG: number) => ((actualG - standardG) / standardG) * 100;

/** The standard deviation of the weights typed so far, or null while there are too few to mean anything. */
function spreadG(weights: number[]): number | null {
  if (weights.length < MIN_SPREAD_N) return null;
  const mean = weights.reduce((s, w) => s + w, 0) / weights.length;
  return Math.round(Math.sqrt(weights.reduce((s, w) => s + (w - mean) ** 2, 0) / weights.length));
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
  id,
  standardG,
  day,
  actualG,
  previous,
  canEdit,
  onCommit,
}: {
  id: string;
  standardG: number | null;
  day: number;
  actualG: number | undefined;
  previous: { day: number; actualG: number } | undefined;
  canEdit: boolean;
  onCommit: (text: string) => Promise<boolean>;
}) {
  // A bird has no figure of its own until it is weighed, so the card shows nothing rather than a guess.
  const pct = actualG !== undefined && standardG !== null ? vsStandard(actualG, standardG) : null;
  const low = pct !== null && pct <= -LOW_PCT;
  return (
    <div className="cb-card p-4 space-y-3" style={low ? { borderLeft: "3px solid var(--status-amber)" } : {}}>
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-base font-bold" style={{ color: "var(--cv-accent)" }}>{id}</span>
        {low && <span className="badge-amber">{tr("LOW W")}</span>}
      </div>
      {/* Data rows */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
        <div>
          <p className="label-section">{tr("Actual Weight")}</p>
          <div className="mt-1">
            <WeightInput birdId={id} value={actualG} disabled={!canEdit} onCommit={onCommit} />
          </div>
        </div>
        <div>
          <p className="label-section">{tr("vs Day {day} Std", { day })}</p>
          {pct === null ? (
            <p className="mt-2 font-mono font-semibold" style={{ color: "var(--text-tertiary)" }}>—</p>
          ) : (
            <p className="mt-2 font-mono font-semibold" style={{ color: offColor(pct) }}>
              {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
            </p>
          )}
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
  // The flock comes from the pen the facility has, not from a sample: the only
  // per-bird number on this page is the weight a person put on the scale.
  const overview = Route.useLoaderData() as any;
  // The pen is the one the live camera watches — the same house Settings writes
  // the flock size into, and the one the Dashboard counts. The first house in the
  // list is only the first house on the farm, so reading it here listed another
  // house's flock (thousands of birds) whatever number was set for this pen.
  const houses = (overview?.houses ?? []) as { id: string; label: string; population: number }[];
  const house = houses.find((h) => h.id === overview?.cluster?.houseId) ?? houses[0] ?? null;
  const population = Number(house?.population ?? 0);
  const cycle = overview?.cycle as { day: number; startDay: number; endDay: number } | null | undefined;
  const day = Number(cycle?.day ?? 0);
  const endDay = Number(cycle?.endDay ?? 0);
  // The breed's target for this exact day, read off the stored standard curve.
  const standardG: number | null =
    (overview?.weight?.standardCurve as { day: number; standardG: number }[] | undefined)?.find((p) => p.day === day)?.standardG ?? null;
  const { user } = useAuth();
  // Entering weights is for the people who work with the flock.
  const canEdit = Boolean(user?.roles?.some((r) => r === "ADMIN" || r === "FARM_MANAGER" || r === "OPERATOR"));

  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  // How many rows are on screen; a pen's flock does not fit in one page.
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => setLimit(PAGE_SIZE), [filter, search]);
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
    if (!day) return;
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
    if (!day) return;
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

  // B-001 to the pen's flock size: the birds the farm says are in the house.
  const birds = useMemo(
    () => Array.from({ length: population }, (_, i) => `B-${String(i + 1).padStart(3, "0")}`),
    [population],
  );

  /** Saves what was typed for a bird. Returns false when the text was refused. */
  const commit = (id: string) => async (text: string): Promise<boolean> => {
    const trimmed = text.trim();
    const before = actuals[id];
    const put = (value: number | undefined) =>
      setActuals((prev) => {
        const next = { ...prev };
        if (value === undefined) delete next[id];
        else next[id] = value;
        return next;
      });
    try {
      if (trimmed === "") {
        if (before === undefined) return true;
        put(undefined);
        await enqueue(id, () => deleteActualWeight(id, day));
        delete stored.current[id];
      } else {
        const value = Math.round(Number(trimmed) * 1000);
        if (!Number.isFinite(value) || value < MIN_G || value > MAX_G) {
          setProblem(tr("Enter the weight in kg with up to 3 decimals, between {min} and {max}.", { min: kgText(MIN_G), max: kgText(MAX_G) }));
          return false;
        }
        if (value === before) return true;
        put(value);
        // Only the weight is sent. There is no estimate to compare it with any more.
        await enqueue(id, () => saveActualWeight({ birdId: id, day, actualG: value }));
        stored.current[id] = value;
      }
      setProblem(null);
      return true;
    } catch {
      put(stored.current[id]);
      setProblem(tr("Could not save the weight for {id}. Try again.", { id }));
      return false;
    }
  };

  /** How far a bird is from the standard, or null while it has not been weighed. */
  const offPct = (id: string): number | null =>
    actuals[id] === undefined || standardG === null ? null : vsStandard(actuals[id]!, standardG);

  const sorted = birds
    .filter((id) => filter === "all" || (filter === "weighed") === (actuals[id] !== undefined))
    .filter((id) => !search || id.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === "id") cmp = a.localeCompare(b);
      else if (sortKey === "actual") cmp = (actuals[a] ?? Infinity) - (actuals[b] ?? Infinity);
      else cmp = (offPct(a) ?? Infinity) - (offPct(b) ?? Infinity);
      if (Number.isNaN(cmp)) cmp = 0;
      return sortAsc ? cmp : -cmp;
    });
  // Only the rows on screen are built: a pen has thousands of birds.
  const shown = sorted.slice(0, limit);

  const handleSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(true); }
  };

  const weighedIds = birds.filter((id) => actuals[id] !== undefined);
  const typed = weighedIds.map((id) => actuals[id]!);
  // The mean of what was put on the scale, and only of that.
  const meanG = typed.length ? Math.round(typed.reduce((s, w) => s + w, 0) / typed.length) : null;
  const spread = spreadG(typed);
  // How the flock's own average sits against the breed's target for the day.
  const meanOffPct = meanG !== null && standardG !== null ? vsStandard(meanG, standardG) : null;

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-5">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            {tr("Flock Tracking")}
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            {population.toLocaleString()} {tr("birds")}
            {house ? ` · ${house.label}` : ""} · {tr("Day")}{" "}
            <span className="font-mono" style={{ color: "var(--cv-accent)" }}>{day}</span>
            {endDay ? `/${endDay}` : ""}
          </p>
        </div>
      </div>

      {/* One summary card */}
      <div className="cb-card mb-3 grid grid-cols-2 sm:grid-cols-4 sm:divide-x divide-[color:var(--border-subtle)]">
        {[
          {
            label: tr("Weighed Today"),
            value: `${weighedIds.length}/${population.toLocaleString()}`,
            color: weighedIds.length ? "var(--status-green)" : "var(--text-tertiary)",
          },
          {
            label: tr("Avg Weight"),
            value: meanG === null ? "—" : `${(meanG / 1000).toFixed(3)} kg`,
            color: meanG === null ? "var(--text-tertiary)" : "var(--brand)",
          },
          {
            label: tr("vs Standard"),
            value: meanOffPct === null ? "—" : `${meanOffPct > 0 ? "+" : ""}${meanOffPct.toFixed(1)}%`,
            color: meanOffPct === null ? "var(--text-tertiary)" : offColor(meanOffPct),
          },
          {
            label: tr("Spread"),
            value: spread === null ? "—" : `${(spread / 1000).toFixed(3)} kg`,
            color: spread === null ? "var(--text-tertiary)" : "var(--text-primary)",
          },
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
      <p className="mb-2 text-xs" style={{ color: "var(--text-tertiary)" }}>
        {tr("Type each bird's weight in kg (up to 3 decimals, like 0.946) and press Enter or click away. It saves by itself for Day {day}; there is no submit button. Nothing here is estimated: a bird shows a weight only once someone has weighed it, and the vs Standard figure compares that weight with the breed's target for the day (within {close}% green, within {fair}% amber, more red). Each new day starts with empty boxes; the earlier days stay saved, and each bird's Gain compares it with its last weighing.", { day, close: CLOSE_PCT, fair: FAIR_PCT })}
      </p>
      {spread === null && (
        <p className="mb-5 text-xs" style={{ color: "var(--text-tertiary)" }}>
          {tr("The spread appears once at least {n} birds have been weighed today; fewer than that describes the sample, not the flock.", { n: MIN_SPREAD_N })}
        </p>
      )}
      {!canEdit && (
        <p className="mb-3 text-xs" style={{ color: "var(--status-amber-text)" }}>{tr("Only an administrator, farm manager or operator can enter weights.")}</p>
      )}
      {problem && (
        <p role="alert" className="mb-3 text-sm" style={{ color: "var(--status-red-text)" }}>{problem}</p>
      )}

      {population === 0 && (
        <p className="mb-3 text-sm" style={{ color: "var(--text-secondary)" }}>{tr("No pen is set up yet, so there are no birds to list.")}</p>
      )}

      {/* Which birds to show */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(["all", "weighed", "missing"] as Filter[]).map((f) => {
            const n = f === "all" ? birds.length : f === "weighed" ? weighedIds.length : birds.length - weighedIds.length;
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
        {shown.map((id) => (
          <BirdCard key={id} id={id} standardG={standardG} day={day} actualG={actuals[id]} previous={previous[id]} canEdit={canEdit} onCommit={commit(id)} />
        ))}
      </div>

      {/* ── Desktop table (>= md) ──────────────────────────── */}
      <div className="hidden md:block overflow-x-auto rounded-xl"
        style={{ border: "1px solid var(--border-default)" }}>
        <table className="w-full table-fixed" style={{ minWidth: "760px" }}>
          <thead>
            <tr style={{ background: "var(--surface-raised)", borderBottom: "1px solid var(--border-subtle)" }}>
              {([
                ["id",       T("Bird ID"),       "w-[16%]"],
                ["actual",   T("Actual Weight"), "w-[26%]"],
                [null,       T("Gain"),          "w-[20%]"],
                ["vsStd",    T("vs Standard"),   "w-[22%]"],
                [null,       T("Flag"),          "w-[10%]"],
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
            {shown.map((id) => {
              const actual = actuals[id];
              const pct = offPct(id);
              const low = pct !== null && pct <= -LOW_PCT;
              const rowBg = low ? "rgba(251,191,36,0.05)" : undefined;
              return (
                <tr key={id}
                  style={{ background: rowBg ?? "transparent" }}
                  onMouseEnter={(e) => { if (!rowBg) e.currentTarget.style.background = "var(--surface-raised)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = rowBg ?? "transparent"; }}>
                  {/* ID */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-sm font-bold" style={{ color: "var(--cv-accent)" }}>
                      {id}
                    </span>
                  </td>
                  {/* The weight someone put on the scale */}
                  <td className="px-4 py-2.5">
                    <WeightInput birdId={id} value={actual} disabled={!canEdit} onCommit={commit(id)} />
                  </td>
                  {/* Gain since the last day it was weighed */}
                  <td className="px-4 py-2.5">
                    <Gain actualG={actual} previous={previous[id]} />
                  </td>
                  {/* vs the breed's target for the day */}
                  <td className="px-4 py-2.5">
                    {pct === null ? (
                      <span className="font-mono text-xs" style={{ color: "var(--text-tertiary)" }}>—</span>
                    ) : (
                      <span className="font-mono text-xs font-semibold" style={{ color: offColor(pct) }}>
                        {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
                      </span>
                    )}
                  </td>
                  {/* Flag */}
                  <td className="px-4 py-2.5">
                    {low && <span className="badge-amber">{tr("LOW W")}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: "var(--text-tertiary)" }}>
        <span>{tr("{length} of {length2} birds", { length: shown.length, length2: sorted.length })}</span>
        {shown.length < sorted.length && (
          <button
            onClick={() => setLimit((n) => n + PAGE_SIZE)}
            className="tap rounded-full px-3 py-1 font-mono text-[11px] font-semibold"
            style={{ background: "var(--surface-raised)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
            {tr("Show {n} more", { n: Math.min(PAGE_SIZE, sorted.length - shown.length) })}
          </button>
        )}
      </div>
    </AppShell>
  );
}
