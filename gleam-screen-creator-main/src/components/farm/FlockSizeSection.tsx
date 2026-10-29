import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { saveFlockSize } from "@/lib/api-client";
import { Block, Hint, NOT_ALLOWED, SaveRow, Section, useSaver } from "./SettingsParts";
import { tr } from "@/lib/i18n";

/* How many birds are in the pen: set it when a batch is placed, and after
 * losses. The Dashboard's flock figure reads it. One pen, so one number. */

export interface HouseSize {
  id: string;
  label: string;
  population: number;
}

/** The pen holds between 1 and 1,000 broiler chickens. */
const MIN_BIRDS = 1;
const MAX_BIRDS = 1000;

export function FlockSizeSection({ house, canManage }: { house: HouseSize | null; canManage: boolean }) {
  const router = useRouter();
  const saver = useSaver();
  const saved = house ? String(Number(house.population)) : "";
  const [draft, setDraft] = useState(saved);

  // Follow what is saved (after saving, or when the page loads).
  useEffect(() => setDraft(saved), [saved]);

  const trimmed = draft.trim();
  const valid = /^\d+$/.test(trimmed) && Number(trimmed) >= MIN_BIRDS && Number(trimmed) <= MAX_BIRDS;
  const dirty = trimmed !== saved;

  const save = async () => {
    if (!house || !valid || !dirty) return;
    const ok = await saver.run(() => saveFlockSize([{ id: house.id, population: Number(trimmed) }]), tr("Saved."));
    if (ok) await router.invalidate();
  };

  if (!house) {
    return (
      <Section title={tr("Flock Size")}>
        <Block>
          <Hint>{tr("No pen is set up yet.")}</Hint>
        </Block>
      </Section>
    );
  }

  return (
    <Section title={tr("Flock Size")}>
      <Block>
        <label htmlFor="flock-size" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{tr("Number of broiler chickens in {label}", { label: house.label })}</label>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          {tr("Update it when a new batch is placed and after any losses. The Dashboard shows this number.")}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            id="flock-size"
            type="text"
            inputMode="numeric"
            value={draft}
            disabled={!canManage}
            onChange={(e) => {
              saver.setNote(null);
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => e.key === "Enter" && save()}
            aria-invalid={!valid}
            className="cb-input w-36 text-right font-mono text-sm disabled:opacity-60"
          />
          <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>{tr("broiler chickens")}</span>
        </div>
        {!valid && <Hint tone="error">{tr("Enter a whole number from {MIN_BIRDS} to {MAX_BIRDS}.", { MIN_BIRDS, MAX_BIRDS: MAX_BIRDS.toLocaleString() })}</Hint>}
        {!canManage ? (
          <Hint>{tr(NOT_ALLOWED)}</Hint>
        ) : (
          <SaveRow onSave={save} busy={saver.busy} disabled={!valid || !dirty} note={saver.note} />
        )}
      </Block>
    </Section>
  );
}
