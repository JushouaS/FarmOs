import { FlaskConical } from "lucide-react";
import type { ReactNode } from "react";
import { T, tr } from "@/lib/i18n";

/* Marks figures that come from the built-in sample dataset (src/lib/farm/dataset.ts)
 * instead of the database. Parts of the app are still drawn from that sample
 * (the per-bird table, behaviour counts, feed and environment history), and the
 * sample describes a different flock from the live one (28 birds on Day 14), so
 * it is labelled rather than left to look like live data. */

const SAMPLE_HINT = T("Built-in sample data. This is not read from the database yet.");

/** A small pill for a card or section heading. */
export function SampleBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title={tr(SAMPLE_HINT)}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--status-blue-border)] bg-[var(--status-blue-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--status-blue-text)] ${className}`}
    >
      <FlaskConical className="h-3 w-3" aria-hidden="true" />
      {tr("Sample data")}
    </span>
  );
}

/** A slim note under a page title, for pages built on the sample. */
export function SampleNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="note"
      className="mb-5 flex items-start gap-2.5 rounded-xl border border-[var(--status-blue-border)] bg-[var(--status-blue-bg)] px-3.5 py-2.5 text-sm"
      style={{ color: "var(--status-blue-text)" }}
    >
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="leading-snug">{children}</p>
    </div>
  );
}
