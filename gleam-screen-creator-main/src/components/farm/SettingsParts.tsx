import { useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api-client";
import { T, tr } from "@/lib/i18n";

/* Building blocks the Settings cards share: the card, its rows, the switch, and
 * the busy flag plus the message shown after a save. */

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-6 w-11 rounded-full transition-colors shrink-0 before:absolute before:-inset-2.5 before:content-[''] disabled:opacity-50"
      style={{
        background: checked ? "var(--brand)" : "var(--surface-raised)",
        border: "1px solid var(--border-default)",
      }}
    >
      <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="label-section mb-3">{title}</h2>
      <div className="cb-card overflow-hidden divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        {children}
      </div>
    </div>
  );
}

export function Row({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{label}</p>
        {sub && <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>{sub}</p>}
      </div>
      {/* Long values wrap right-aligned instead of squeezing the label column on phones */}
      <div className="flex min-w-0 max-w-[55%] justify-end text-right [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

export function MonoVal({ value }: { value: string }) {
  return (
    <span className="font-mono text-xs font-semibold" style={{ color: "var(--cv-accent)" }}>{value}</span>
  );
}

/** A padded block inside a card, for forms. */
export function Block({ children }: { children: ReactNode }) {
  return <div className="px-4 py-4 sm:px-5">{children}</div>;
}

export type SaveNote = { ok: boolean; text: string } | null;

export const NOT_ALLOWED = T("Only an administrator or farm manager can change this.");

/**
 * The busy flag and the message after a save. `run` does the save and words the
 * result: the API's own explanation when it gave one (it says what is wrong with
 * a value), a plain line for being refused, a plain line for being offline.
 */
export function useSaver() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<SaveNote>(null);

  const run = async (action: () => Promise<unknown>, done: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setNote(null);
    try {
      await action();
      setNote({ ok: true, text: done });
      return true;
    } catch (err) {
      setNote({
        ok: false,
        text:
          err instanceof ApiError
            ? err.status === 403
              ? tr(NOT_ALLOWED)
              : (err.detail ?? tr("Could not save. Try again."))
            : tr("Could not save. Check the connection and try again."),
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, note, setNote, run };
}

/** The message a save leaves behind, announced to screen readers. */
export function NoteLine({ note }: { note: SaveNote }) {
  if (!note) return null;
  return (
    <span role="status" className="text-sm font-semibold" style={{ color: note.ok ? "var(--status-green-text)" : "var(--status-red-text)" }}>
      {note.text}
    </span>
  );
}

/** The save button and its message, side by side. */
export function SaveRow({
  onSave,
  busy,
  disabled,
  note,
  label,
}: {
  onSave: () => void;
  busy: boolean;
  disabled: boolean;
  note: SaveNote;
  label?: string;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" onClick={onSave} disabled={disabled || busy} className="btn-primary tap disabled:opacity-50">
        {busy ? tr("Saving…") : (label ?? tr("Save Changes"))}
      </button>
      <NoteLine note={note} />
    </div>
  );
}

/** A small caption under a field or a card. */
export function Hint({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <p className="mt-2 text-xs" style={{ color: tone === "error" ? "var(--status-red-text)" : "var(--text-tertiary)" }}>
      {children}
    </p>
  );
}
