import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { AppShell } from "@/components/farm/AppShell";
import { deleteActualWeight, fetchActualWeights, fetchPreviousWeights, saveActualWeight } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { getOperationsOverview } from "@/lib/farm/repository";
import { standardForToday } from "@/lib/farm/weights";
import { T, tr } from "@/lib/i18n";

export const Route = createFileRoute("/flock-monitoring")({
  head: () => ({ meta: [{ title: tr("Flock Tracking — Cerebroil") }] }),
  loader: () => getOperationsOverview(),
  component: FlockTrackingPage,
});

type Filter = "all" | "weighed" | "missing";
type SortKey = "id" | "actual" | "vsStd";

/* The weight a person measures is typed in kilograms, with at most 3 decimals, once a day,
 * and kept in grams. The Dashboard's average weight is the mean of the weights typed in for a day.
 * These are the limits the API accepts. */
const MIN_G = 20;
const MAX_G = 8000;
const kgText = (g: number) => (g / 1000).toFixed(3);

/** The most birds the sheet lists; bird ids are B-001 and up, and the API takes four digits. */
const MAX_BIRDS = 2000;
const birdId = (n: number) => `B-${String(n).padStart(3, "0")}`;

/** What a person has typed, cut down to a weight in kg: digits and one point, at most 3 decimals. */
function cleanKg(text: string): string {
  const t = text.replace(",", ".").replace(/[^0-9.]/g, "");
  const dot = t.indexOf(".");
  if (dot === -1) return t.slice(0, 1);
  return `${t.slice(0, dot).slice(0, 1)}.${t.slice(dot + 1).replace(/\./g, "").slice(0, 3)}`;
}

/** How much a bird has gained since the last day it was weighed. */
function Gain({ actualG, previous }: { actualG: number | undefined; previous: { day: number; actualG: number } | undefined }) {
  if (actualG === undefined || previous === undefined) return <span className="font-mono text-xs" style={{ color: "var(--text-tertiary)" }}>—</span>;
  const gain = actualG - previous.actualG;
  return (
    <span className="font-mono text-xs font-semibold" style={{ color: gain >= 0 ? "var(--status-green)" : "var(--status-red)" }}>
      {gain > 0 ? "+" : ""}{(gain / 1000).toFixed(3)} kg
      <span className="block text-xs font-normal" style={{ color: "var(--text-tertiary)" }}>{tr("since Day {day}", { day: previous.day })}</span>
    </span>
  );
}

/** How far a bird's weight is above (+) or below (−) the breed standard for the day. */
function VsStandard({ actualG, stdG }: { actualG: number | undefined; stdG: number | null }) {
  if (actualG === undefined || !stdG) return <span className="font-mono text-xs" style={{ color: "var(--text-tertiary)" }}>—</span>;
  const delta = ((actualG - stdG) / stdG) * 100;
  return (
    <span className="font-mono text-xs font-semibold" style={{ color: delta >= 0 ? "var(--status-green)" : "var(--status-red)" }}>
      {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
    </span>
  );
}

/** The box a person types a bird's weight in. It saves when they leave the box or press Enter. */
function WeightInput({
  birdId: id,
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
        aria-label={tr("Actual weight of {id} in kg", { id })}
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
      <span className="font-mono text-xs" style={{ color: "var(--text-tertiary)" }}>kg</span>
      {saved && (
        <span role="status" className="inline-flex items-center gap-0.5 font-mono text-xs font-semibold" style={{ color: "var(--status-green)" }}>
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
  stdG,
  day,
  actualG,
  previous,
  canEdit,
  onCommit,
}: {
  id: string;
  stdG: number | null;
  day: number;
  actualG: number | undefined;
  previous: { day: number; actualG: number } | undefined;
  canEdit: boolean;
  onCommit: (text: string) => Promise<boolean>;
}) {
  return (
    <div className="cb-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-base font-bold" style={{ color: "var(--cv-accent)" }}>{id}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
        <div>
          <p className="label-section">{tr("Actual Weight")}</p>
          <div className="mt-1">
            <WeightInput birdId={id} value={actualG} disabled={!canEdit} onCommit={onCommit} />
          </div>
        </div>
        <div>
          <p className="label-section">{tr("vs Day {day} Std", { day })}</p>
          <p className="mt-2"><VsStandard actualG={actualG} stdG={stdG} /></p>
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
  const overview = Route.useLoaderData() as any;
  const day = Number(overview?.cycle?.day ?? 0);
  const endDay = Number(overview?.cycle?.endDay ?? overview?.cycle?.lengthDays ?? 45);
  const stdG = standardForToday(overview);
  // The sheet lists the birds of the house the camera watches: B-001 up to the flock size.
  const house = ((overview?.houses ?? []) as { id: string; label?: string; population: number | string }[]).find((h) => h.id === overview?.cluster?.houseId);
  const population = Math.min(MAX_BIRDS, Math.max(0, Math.round(Number(house?.population ?? 0)) || 0));
  const birds = useMemo(() => Array.from({ length: population }, (_, i) => ({ id: birdId(i + 1) })), [population]);
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

  const vsStd = (id: string): number | null => (actuals[id] === undefined || !stdG ? null : ((actuals[id]! - stdG) / stdG) * 100);

  const sorted = [...birds]
    .filter((b) => filter === "all" || (filter === "weighed") === (actuals[b.id] !== undefined))
    .filter((b) => !search || b.id.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === "id") cmp = a.id.localeCompare(b.id);
      else if (sortKey === "actual") cmp = (actuals[a.id] ?? Infinity) - (actuals[b.id] ?? Infinity);
      else cmp = (vsStd(a.id) ?? Infinity) - (vsStd(b.id) ?? Infinity);
      if (Number.isNaN(cmp)) cmp = 0;
      return sortAsc ? cmp : -cmp;
    });

  const handleSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(true); }
  };

  const weighed = birds.filter((b) => actuals[b.id] !== undefined);
  const avgWeight = weighed.length ? Math.round(weighed.reduce((s, b) => s + actuals[b.id]!, 0) / weighed.length) : null;
  const avgVs = stdG && avgWeight !== null ? ((avgWeight - stdG) / stdG) * 100 : null;

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-5">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            {tr("Flock Tracking")}
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            {population} {tr("birds")} · {house?.label ?? tr("Pen 1")} · {tr("Day")}{" "}
            <span className="font-mono" style={{ color: "var(--cv-accent)" }}>{day}</span>
            {`/${endDay}`}
          </p>
        </div>
      </div>

      {/* One summary card */}
      <div className="cb-card mb-3 grid grid-cols-2 sm:grid-cols-4 sm:divide-x divide-[color:var(--border-subtle)]">
        {[
          { label: tr("Total Birds"), value: String(population), color: "var(--cv-accent)" },
          { label: tr("Avg Weight"), value: avgWeight === null ? "—" : `${(avgWeight / 1000).toFixed(3)} kg`, color: avgWeight === null ? "var(--text-tertiary)" : "var(--brand)" },
          { label: tr("Weighed Today"), value: `${weighed.length}/${population}`, color: weighed.length ? "var(--status-green)" : "var(--text-tertiary)" },
          { label: tr("Avg vs Standard"), value: avgVs === null ? "—" : `${avgVs >= 0 ? "+" : ""}${avgVs.toFixed(1)}%`, color: avgVs === null ? "var(--text-tertiary)" : avgVs >= 0 ? "var(--status-green)" : "var(--status-red)" },
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
        {tr("Weigh birds on a scale and type each weight in kg (up to 3 decimals, like 0.946), then press Enter or click away. It saves by itself for Day {day}; there is no submit button. The average of the weights you type in for a day is the weight the Dashboard shows for the flock. Each new day starts with empty boxes; the earlier days stay saved, and each bird's Gain compares it with its last weighing.", { day })}
      </p>
      {!canEdit && (
        <p className="mb-3 text-xs" style={{ color: "var(--status-amber-text)" }}>{tr("Only an administrator, farm manager or operator can enter weights.")}</p>
      )}
      {problem && (
        <p role="alert" className="mb-3 text-sm" style={{ color: "var(--status-red-text)" }}>{problem}</p>
      )}

      {population === 0 ? (
        <p className="cb-card p-5 text-sm" style={{ color: "var(--text-secondary)" }}>
          {tr("The flock size of this pen is not set, so there are no birds to list. An administrator can set it in Settings.")}
        </p>
      ) : (
        <>
          {/* Which birds to show */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {(["all", "weighed", "missing"] as Filter[]).map((f) => {
                const n = f === "all" ? birds.length : f === "weighed" ? weighed.length : birds.length - weighed.length;
                const label = f === "all" ? tr("All ({length})", { length: n }) : f === "weighed" ? tr("Weighed ({n})", { n }) : tr("Not weighed ({n})", { n });
                return (
                  <button key={f} onClick={() => setFilter(f)}
                    aria-pressed={filter === f}
                    className="tap rounded-full px-3 py-1 font-mono text-xs font-semibold transition-all"
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
              <BirdCard key={b.id} id={b.id} stdG={stdG} day={day} actualG={actuals[b.id]} previous={previous[b.id]} canEdit={canEdit} onCommit={commit(b.id)} />
            ))}
            <p className="text-xs text-right pt-1" style={{ color: "var(--text-tertiary)" }}>{tr("{length} of {length2} birds", { length: sorted.length, length2: birds.length })}</p>
          </div>

          {/* ── Desktop table (>= md) ──────────────────────────── */}
          <div className="hidden md:block overflow-x-auto rounded-xl"
            style={{ border: "1px solid var(--border-default)" }}>
            <table className="w-full table-fixed" style={{ minWidth: "560px" }}>
              <thead>
                <tr style={{ background: "var(--surface-raised)", borderBottom: "1px solid var(--border-subtle)" }}>
                  {([
                    ["id",     T("Bird ID"),       "w-[20%]"],
                    ["actual", T("Actual Weight"), "w-[34%]"],
                    [null,     T("Gain"),          "w-[26%]"],
                    ["vsStd",  T("vs Standard"),   "w-[20%]"],
                  ] as [SortKey | null, string, string][]).map(([k, label, w]) => (
                    <th key={label} className={`${w} px-4 py-3 text-left`}>
                      {k ? (
                        <button onClick={() => handleSort(k)}
                          className="tap flex items-center gap-1 font-mono text-xs font-semibold uppercase tracking-wide transition-colors hover:text-[color:var(--text-primary)]"
                          style={{ color: "var(--text-tertiary)" }}>
                          {tr(label)}
                          <span style={{ color: sortKey === k ? "var(--brand)" : "var(--text-disabled)" }}>
                            {sortKey === k ? (sortAsc ? "↑" : "↓") : "↕"}
                          </span>
                        </button>
                      ) : (
                        <span className="font-mono text-xs font-semibold uppercase tracking-wide"
                          style={{ color: "var(--text-tertiary)" }}>{tr(label)}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ background: "var(--surface-card)", borderColor: "var(--border-subtle)" }}>
                {sorted.map((b) => (
                  <tr key={b.id}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-raised)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-sm font-bold" style={{ color: "var(--cv-accent)" }}>{b.id}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <WeightInput birdId={b.id} value={actuals[b.id]} disabled={!canEdit} onCommit={commit(b.id)} />
                    </td>
                    <td className="px-4 py-2.5">
                      <Gain actualG={actuals[b.id]} previous={previous[b.id]} />
                    </td>
                    <td className="px-4 py-2.5">
                      <VsStandard actualG={actuals[b.id]} stdG={stdG} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-right" style={{ color: "var(--text-tertiary)" }}>{tr("{length} of {length2} birds", { length: sorted.length, length2: birds.length })}</p>
        </>
      )}
    </AppShell>
  );
}
