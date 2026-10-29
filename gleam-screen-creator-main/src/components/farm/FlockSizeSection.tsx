import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { saveFlockSize } from "@/lib/api-client";
import { Block, Hint, NOT_ALLOWED, SaveRow, Section, useSaver } from "./SettingsParts";

/* How many birds are in the pen: set it when a batch is placed, and after
 * losses. The Dashboard's flock figure reads it. One pen, so one number. */

export interface HouseSize {
  id: string;
  label: string;
  population: number;
}

const MAX_BIRDS = 1_000_000;

export function FlockSizeSection({ house, canManage }: { house: HouseSize | null; canManage: boolean }) {
  const router = useRouter();
  const saver = useSaver();
  const saved = house ? String(Number(house.population)) : "";
  const [draft, setDraft] = useState(saved);

  // Follow what is saved (after saving, or when the page loads).
  useEffect(() => setDraft(saved), [saved]);

  const trimmed = draft.trim();
  const valid = /^\d+$/.test(trimmed) && Number(trimmed) <= MAX_BIRDS;
  const dirty = trimmed !== saved;

  const save = async () => {
    if (!house || !valid || !dirty) return;
    const ok = await saver.run(() => saveFlockSize([{ id: house.id, population: Number(trimmed) }]), "Saved.");
    if (ok) await router.invalidate();
  };

  if (!house) {
    return (
      <Section title="Flock Size">
        <Block>
          <Hint>No house is set up yet.</Hint>
        </Block>
      </Section>
    );
  }

  return (
    <Section title="Flock Size">
      <Block>
        <label htmlFor="flock-size" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Birds in {house.label}
        </label>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          Set it when a batch is placed, and after losses. The Dashboard shows this number.
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
          <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>birds</span>
        </div>
        {!valid && <Hint tone="error">Enter a whole number from 0 to {MAX_BIRDS.toLocaleString()}.</Hint>}
        {!canManage ? (
          <Hint>{NOT_ALLOWED}</Hint>
        ) : (
          <SaveRow onSave={save} busy={saver.busy} disabled={!valid || !dirty} note={saver.note} />
        )}
      </Block>
    </Section>
  );
}
