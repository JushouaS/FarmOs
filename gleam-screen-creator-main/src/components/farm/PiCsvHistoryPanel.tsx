import { useEffect, useState } from "react";
import { fetchPiCsvHistory, type PiCsvHistory } from "@/lib/api-client";
import { localeTag, tr } from "@/lib/i18n";

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(localeTag(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function display(value: number | null, digits = 0): string {
  return value === null ? "—" : value.toFixed(digits);
}

export function PiCsvHistoryPanel() {
  const [history, setHistory] = useState<PiCsvHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await fetchPiCsvHistory();
        if (active) {
          setHistory(result);
          setError(null);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4 elevation-1">
      <div className="border-b border-[var(--border-subtle)] pb-2.5">
        <h2 className="label-section text-xs font-bold tracking-widest">{tr("Pi CSV History")}</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          {tr("Raw historical readings from Pi CSVs; these are not welfare classifications.")}
        </p>
      </div>

      {error && (
        <p role="status" className="mt-3 text-xs text-[var(--status-amber)]">
          {tr("Could not load Pi CSV history")}: {error}
        </p>
      )}

      {!history && !error && <p className="mt-3 text-xs text-[var(--text-tertiary)]">{tr("Loading history…")}</p>}

      {history && (
        <div className="mt-3 space-y-4">
          <div>
            <h3 className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">{tr("Ammonia (ppm)")}</h3>
            {history.ammonia.length === 0 ? (
              <p className="text-xs text-[var(--text-tertiary)]">{tr("No ammonia CSV rows in the last 30 days.")}</p>
            ) : (
              <div className="max-h-36 space-y-1.5 overflow-y-auto">
                {history.ammonia.slice(0, 8).map((row) => (
                  <div key={`${row.sourceFile}-${row.recordedAt}`} className="flex items-start justify-between gap-2 text-xs">
                    <time dateTime={row.recordedAt} className="shrink-0 font-mono text-[var(--text-tertiary)]">
                      {formatTime(row.recordedAt)}
                    </time>
                    <span className="text-right font-mono tabular-nums text-[var(--text-primary)]">
                      {row.ammoniaPpm === null ? row.error ?? "—" : `${row.ammoniaPpm.toFixed(1)} ppm`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">{tr("Behavior tracker")}</h3>
            {history.behavior.length === 0 ? (
              <p className="text-xs text-[var(--text-tertiary)]">{tr("No behavior CSV rows in the last 30 days.")}</p>
            ) : (
              <div className="max-h-44 space-y-2 overflow-y-auto">
                {history.behavior.slice(0, 8).map((row) => (
                  <div key={`${row.sourceFile}-${row.recordedAt}`} className="border-b border-[var(--border-subtle)] pb-1.5 text-xs last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <time dateTime={row.recordedAt} className="shrink-0 font-mono text-[var(--text-tertiary)]">
                        {formatTime(row.recordedAt)}
                      </time>
                      <span className="text-right font-mono tabular-nums text-[var(--text-primary)]">
                        {tr("{birds} birds · {still} still · {huddled} huddled", {
                          birds: display(row.birds),
                          still: display(row.stillBirds),
                          huddled: display(row.huddledBirds),
                        })}
                      </span>
                    </div>
                    <p className="mt-0.5 text-right font-mono text-[var(--text-tertiary)]">
                      {tr("Moving {moving} · huddle share {huddle}", {
                        moving: row.flockMoving === null ? "—" : `${(row.flockMoving * 100).toFixed(0)}%`,
                        huddle: row.huddleFdi === null ? "—" : `${(row.huddleFdi * 100).toFixed(0)}%`,
                      })}
                      {row.error ? ` · ${row.error}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
