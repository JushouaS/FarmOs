import { useCallback, useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { captureImage, getZones, saveZones, type CameraZone } from "@/lib/api-client";
import { Block, Hint, NOT_ALLOWED, SaveRow, Section, useSaver } from "./SettingsParts";
import { tr } from "@/lib/i18n";

/**
 * Feeder and drinker zones, drawn by hand on a still from the camera.
 *
 * Why this screen exists: birds crowd at a feeder every feeding time. Without
 * knowing where the troughs are, that crowd looks exactly like a huddle, and a
 * system that reports huddling three times a day gets ignored. Mark the troughs
 * once and the huddling check skips the birds standing in them — they still
 * count towards inactivity, because a bird that will not move at a feeder can
 * still be a sick bird.
 *
 * Two details worth knowing before changing this file:
 *
 * 1. Clicks are stored as a share of the picture (0..1), never as pixels. The
 *    camera can come back at a different resolution after a reconnect, and
 *    pixel coordinates would then point at the wrong part of the picture while
 *    still looking plausible on screen.
 * 2. The <img> is sized by the layout (w-full h-auto) so its box is exactly the
 *    picture. That is deliberate: with `object-contain` the image is letterboxed
 *    inside its box, and clicks would be offset by the empty margins — zones
 *    landing somewhere the operator never clicked.
 */

/** The one camera this thesis deployment has. */
const CAMERA_ID = "CAM-01";

type Point = [number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const toPoints = (points: Point[]) => points.map(([x, y]) => `${x},${y}`).join(" ");

export function FeederZonesSection({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const saver = useSaver();

  const [zones, setZones] = useState<CameraZone[]>([]);
  const [draft, setDraft] = useState<Point[]>([]);
  const [label, setLabel] = useState("Feeder");
  const [kind, setKind] = useState<"feeder" | "drinker">("feeder");
  const [still, setStill] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const saved = await getZones(CAMERA_ID);
      setZones(saved.zones);
      setDirty(false);
    } catch {
      setLoadError(tr("Could not load the saved zones."));
    } finally {
      setLoading(false);
    }

    // A still is only needed to draw on, so a dead camera must not stop the
    // saved zones from being edited or removed.
    try {
      const shot = await captureImage(CAMERA_ID);
      setStill(`data:${shot.content_type};base64,${shot.image}`);
    } catch {
      setStill(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addPoint = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!canManage || !still) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    setDraft((prev) => [...prev, [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]]);
    saver.setNote(null);
  };

  const finishShape = () => {
    if (draft.length < 3) return;
    setZones((prev) => [
      ...prev,
      { kind, label: label.trim() || (kind === "feeder" ? "Feeder" : "Drinker"), polygon: draft, enabled: true },
    ]);
    setDraft([]);
    setDirty(true);
    saver.setNote(null);
  };

  const removeZone = (index: number) => {
    setZones((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
    saver.setNote(null);
  };

  const toggleZone = (index: number) => {
    setZones((prev) => prev.map((z, i) => (i === index ? { ...z, enabled: !z.enabled } : z)));
    setDirty(true);
    saver.setNote(null);
  };

  const save = async () => {
    const ok = await saver.run(
      () => saveZones(CAMERA_ID, zones),
      tr("Saved. The next camera reading will skip birds standing in them."),
    );
    if (ok) {
      setDirty(false);
      await router.invalidate();
    }
  };

  const coverage = zones.reduce((sum, z) => sum + area(z.polygon), 0);

  return (
    <Section title={tr("Feeder and Drinker Zones")}>
      <Block>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {tr(
            "Click the picture to outline each feeder or drinker. Birds standing inside a marked area are left out of the crowding check, because a crowd at a feeder is feeding, not huddling. They are still counted when the flock is checked for inactivity.",
          )}
        </p>

        {loading ? (
          <Hint>{tr("Loading the camera picture…")}</Hint>
        ) : loadError ? (
          <Hint tone="error">{loadError}</Hint>
        ) : (
          <div className="mt-3">
            {still ? (
              // The wrapper is exactly the size of the picture, so a click maps
              // straight to a share of the frame with no offset to get wrong.
              <div
                className="relative w-full overflow-hidden rounded-md"
                style={{ border: "1px solid var(--border-default)", cursor: canManage ? "crosshair" : "default" }}
                onClick={addPoint}
              >
                <img src={still} alt={tr("Camera still")} className="block h-auto w-full select-none" draggable={false} />
                <svg
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-0 h-full w-full"
                >
                  {zones.map((zone, i) => (
                    <polygon
                      key={zone.id ?? i}
                      points={toPoints(zone.polygon)}
                      fill={zone.enabled ? "var(--cv-accent)" : "transparent"}
                      fillOpacity={zone.enabled ? 0.18 : 0}
                      stroke={zone.enabled ? "var(--cv-accent)" : "var(--text-tertiary)"}
                      strokeWidth={2}
                      strokeDasharray={zone.enabled ? undefined : "6 4"}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {draft.length > 0 && (
                    <polyline
                      points={toPoints(draft)}
                      fill="none"
                      stroke="var(--status-amber-text, #d97706)"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
              </div>
            ) : (
              <Hint tone="error">
                {tr("The camera did not return a picture, so there is nothing to draw on. Saved zones can still be removed.")}
              </Hint>
            )}

            {canManage && still && (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="zone-label" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {tr("Name")}
                  </label>
                  <input
                    id="zone-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value.slice(0, 60))}
                    className="cb-input mt-1.5 block w-40 text-sm"
                    placeholder={tr("Feeder line 1")}
                  />
                </div>
                <div>
                  <label htmlFor="zone-kind" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {tr("Type")}
                  </label>
                  <select
                    id="zone-kind"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as "feeder" | "drinker")}
                    className="cb-input mt-1.5 block w-32 text-sm"
                  >
                    <option value="feeder">{tr("Feeder")}</option>
                    <option value="drinker">{tr("Drinker")}</option>
                  </select>
                </div>
                <button
                  type="button"
                  className="btn-secondary tap disabled:opacity-50"
                  disabled={draft.length === 0}
                  onClick={() => setDraft((prev) => prev.slice(0, -1))}
                >
                  {tr("Undo point")}
                </button>
                <button
                  type="button"
                  className="btn-secondary tap disabled:opacity-50"
                  disabled={draft.length < 3}
                  onClick={finishShape}
                >
                  {tr("Finish shape")}
                </button>
                {draft.length > 0 && (
                  <button type="button" className="btn-secondary tap" onClick={() => setDraft([])}>
                    {tr("Cancel")}
                  </button>
                )}
              </div>
            )}

            {draft.length > 0 && (
              <Hint>
                {tr("{n} points placed. At least 3 are needed to close a shape.", { n: draft.length })}
              </Hint>
            )}

            <div className="mt-4 space-y-2">
              {zones.length === 0 ? (
                <Hint>
                  {tr(
                    "No zones marked yet. Until you mark the feeders, crowding is measured over every bird in the picture.",
                  )}
                </Hint>
              ) : (
                zones.map((zone, i) => (
                  <div
                    key={zone.id ?? i}
                    className="flex items-center justify-between gap-3 rounded-md px-3 py-2"
                    style={{ background: "var(--surface-raised)" }}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                        {zone.label}
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        {zone.kind === "feeder" ? tr("Feeder") : tr("Drinker")} ·{" "}
                        {tr("{n} points", { n: zone.polygon.length })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        className="btn-secondary tap text-xs"
                        disabled={!canManage}
                        onClick={() => toggleZone(i)}
                      >
                        {zone.enabled ? tr("In use") : tr("Off")}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary tap text-xs"
                        disabled={!canManage}
                        onClick={() => removeZone(i)}
                      >
                        {tr("Remove")}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {coverage > 0.6 && (
              <Hint tone="error">
                {tr(
                  "These zones cover most of the picture. Birds inside them are not checked for crowding, so this looks like a mistake.",
                )}
              </Hint>
            )}

            {!canManage ? (
              <Hint>{tr(NOT_ALLOWED)}</Hint>
            ) : (
              <SaveRow onSave={save} busy={saver.busy} disabled={!dirty} note={saver.note} />
            )}
          </div>
        )}
      </Block>
    </Section>
  );
}

/** Shoelace area of a normalised polygon, as a share of the frame. */
function area(polygon: Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i]!;
    const [x2, y2] = polygon[(i + 1) % polygon.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}
