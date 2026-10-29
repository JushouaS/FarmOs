import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { saveLighting } from "@/lib/api-client";
import { clock12, type LightingHours } from "@/lib/farm/dataset";
import { Block, Hint, NOT_ALLOWED, SaveRow, Section, useSaver } from "./SettingsParts";

/* When the day starts and when the night starts. At night the birds count as
 * sleeping on Live Camera and in the camera analysis, so this sets that split. */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** "12 h", "11 h 30 min". */
function duration(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h} h` : h === 0 ? `${m} min` : `${h} h ${m} min`;
}

export function LightingSection({ lighting, canManage }: { lighting: LightingHours; canManage: boolean }) {
  const router = useRouter();
  const saver = useSaver();
  const [day, setDay] = useState(lighting.dayStart);
  const [night, setNight] = useState(lighting.nightStart);

  // Follow the saved hours (after saving, or when the page loads).
  useEffect(() => {
    setDay(lighting.dayStart);
    setNight(lighting.nightStart);
  }, [lighting.dayStart, lighting.nightStart]);

  const valid = HHMM.test(day) && HHMM.test(night) && day !== night;
  const dirty = day !== lighting.dayStart || night !== lighting.nightStart;
  const dayLength = valid ? (minutesOf(night) - minutesOf(day) + 1440) % 1440 : 0;

  const save = async () => {
    if (!valid || !dirty) return;
    const ok = await saver.run(() => saveLighting({ dayStart: day, nightStart: night }), "Saved.");
    if (ok) await router.invalidate();
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div>
      <label htmlFor={id} className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {label}
      </label>
      <input
        id={id}
        type="time"
        value={value}
        disabled={!canManage}
        onChange={(e) => {
          saver.setNote(null);
          set(e.target.value);
        }}
        aria-invalid={!valid}
        className="cb-input mt-1.5 block w-36 font-mono text-sm disabled:opacity-60"
      />
    </div>
  );

  return (
    <Section title="Light and Night Hours">
      <Block>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          At night the birds count as sleeping on Live Camera and in the camera analysis, and inactivity is not flagged.
        </p>
        <div className="mt-3 flex flex-wrap gap-5">
          {field("day-start", "Day starts", day, setDay)}
          {field("night-start", "Night starts", night, setNight)}
        </div>
        {valid ? (
          <Hint>
            Day runs from {clock12(day)} until {clock12(night)} ({duration(dayLength)}). Night is the other {duration(1440 - dayLength)}.
          </Hint>
        ) : (
          <Hint tone="error">Give both times, and make them different.</Hint>
        )}
        {!canManage ? (
          <Hint>{NOT_ALLOWED}</Hint>
        ) : (
          <SaveRow onSave={save} busy={saver.busy} disabled={!valid || !dirty} note={saver.note} />
        )}
      </Block>
    </Section>
  );
}
