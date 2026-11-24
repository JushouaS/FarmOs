import { useCallback, useState, type ChangeEvent } from "react";
import {
  ApiError,
  deleteClip,
  uploadClip,
  weighClip,
  type VideoWeightResult,
  type VisionClip,
} from "@/lib/api-client";
import { Block, Hint, Section } from "./SettingsParts";
import { tr } from "@/lib/i18n";

/**
 * The 3D weight estimation, run against a recording instead of the weighing
 * station.
 *
 * The behaviour test next to this one checks what the detector sees; this one
 * checks what the depth-to-mass line makes of it. Upload a recording of the
 * Kinect depth view (the colormap the station streams), and the same frames
 * the live station would weigh are sampled here and turned into one estimate.
 *
 * Same deliberate rules as the behaviour test:
 *
 * 1. Nothing is saved. The clip lives in the vision container's temp directory
 *    for two hours, and the estimates never reach `volumetric_samples` — a
 *    recording is not a reading, and the growth chart must not be fed footage
 *    from a day the flock did not live through.
 * 2. A clip has several frames, so the spread and the range are real
 *    statistics across samples rather than the single-frame stand-in the live
 *    path reports.
 */

/** Mirrors the API's own default, so an oversized file is refused before it travels. */
const MAX_UPLOAD_MB = 200;

/** What to tell the operator when a call is refused. */
function reason(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return tr("Your session ended. Sign in again, then try the clip.");
    if (err.status === 429) return tr("Too many uploads or checks just now. Please wait a minute.");
    switch (err.message) {
      case "too_large":
        return tr("The clip is larger than the {n} MB limit.", { n: MAX_UPLOAD_MB });
      case "too_long":
        return tr("The clip is longer than the limit. Cut it down and try again.");
      case "unsupported_type":
      case "unreadable_clip":
        return tr("That file could not be read as a video. Export it as H.264 MP4 and try again.");
      case "empty_upload":
        return tr("The file was empty.");
      case "unknown_clip":
        return tr("That clip is no longer stored. Upload it again.");
    }
    return err.detail ?? tr("The check could not be run. Try again.");
  }
  return tr("Could not reach the camera service. Check the connection and try again.");
}

function grams(mass: number | null): string {
  return mass === null
    ? tr("Unreadable")
    : `${mass.toLocaleString(undefined, { maximumFractionDigits: 1 })} g`;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg p-2" style={{ background: "var(--surface-raised)" }}>
      <dt className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
        {label}
      </dt>
      <dd
        className="mt-0.5 font-mono text-sm font-semibold tabular-nums"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </dd>
    </div>
  );
}

export function WeightTestSection() {
  const [clip, setClip] = useState<VisionClip | null>(null);
  const [uploading, setUploading] = useState(false);
  const [weighing, setWeighing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [result, setResult] = useState<VideoWeightResult | null>(null);

  const reset = useCallback(() => {
    setClip(null);
    setResult(null);
    setError(null);
  }, []);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared straight away so picking the same file again still fires.
    event.target.value = "";
    if (!file) return;

    setError(null);
    setResult(null);
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(tr("The clip is larger than the {n} MB limit.", { n: MAX_UPLOAD_MB }));
      return;
    }

    setUploading(true);
    try {
      // One clip at a time: the previous one is only a test artefact, and the
      // alternative is a temp directory quietly filling with forgotten files.
      if (clip) await deleteClip(clip.id).catch(() => undefined);
      setClip(await uploadClip(file));
    } catch (err) {
      setError(reason(err));
    } finally {
      setUploading(false);
    }
  };

  const weigh = async () => {
    if (!clip) return;
    setError(null);
    setWeighing(true);
    try {
      setResult(await weighClip(clip.id));
    } catch (err) {
      setError(reason(err));
    } finally {
      setWeighing(false);
    }
  };

  const forget = async () => {
    if (!clip) return;
    setForgetting(true);
    try {
      await deleteClip(clip.id);
      reset();
    } catch (err) {
      setError(reason(err));
    } finally {
      setForgetting(false);
    }
  };

  const summary = result?.summary;

  return (
    <Section title={tr("Test clip — 3D Weight")}>
      <Block>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {tr(
            "Upload a Kinect depth recording to check the 3D weight estimation without the weighing station. The frames are measured with the same depth-to-mass line a live reading uses, and nothing is saved to the flock's history.",
          )}
        </p>

        <div className="mt-3">
          <label htmlFor="depth-file" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {tr("Depth recording")}
          </label>
          <input
            id="depth-file"
            type="file"
            accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,.mp4,.mov,.avi,.mkv,.m4v,.webm"
            disabled={uploading}
            onChange={onFile}
            className="cb-input mt-1.5 block w-full text-sm file:mr-3 file:rounded file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-semibold"
          />
          <Hint>
            {uploading
              ? tr("Uploading and reading the clip… a long clip takes a while.")
              : tr("A recording of the depth view, not the colour camera. Up to {n} MB and 10 minutes.", {
                  n: MAX_UPLOAD_MB,
                })}
          </Hint>
        </div>

        {error && (
          <p role="alert" className="mt-2 text-xs leading-relaxed" style={{ color: "var(--status-red-text)" }}>
            {error}
          </p>
        )}

        {clip && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2" style={{ background: "var(--surface-raised)" }}>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {clip.name}
                </p>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {clock(clip.duration_s)} · {clip.width}×{clip.height} · {clip.fps.toFixed(0)} fps ·{" "}
                  {megabytes(clip.bytes)}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary tap text-xs"
                disabled={forgetting || weighing}
                onClick={forget}
              >
                {forgetting ? tr("Removing…") : tr("Remove clip")}
              </button>
            </div>

            <button
              type="button"
              className="btn-primary tap text-sm disabled:opacity-50"
              disabled={weighing}
              onClick={weigh}
            >
              {weighing ? tr("Weighing the clip…") : tr("Check weights")}
            </button>

            {result && summary && (
              <div className="rounded-md p-3" style={{ border: "1px solid var(--border-subtle)" }}>
                {summary.samples === 0 ? (
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {tr("No frames could be read from this clip.")}
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {tr("Estimated weight: {median} (±{sd} g)", {
                        median: grams(summary.median_g),
                        sd: summary.std_dev_g ?? 0,
                      })}
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                      {tr("{used} of {taken} sampled frames could be measured.", {
                        used: summary.samples,
                        taken: result.sampling.taken,
                      })}
                      {result.sampling.truncated
                        ? ` ${tr("The clip was long, so the weighing stopped early.")}`
                        : ""}
                    </p>

                    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                      <Stat label={tr("Median")} value={grams(summary.median_g)} />
                      <Stat label={tr("Spread")} value={`±${summary.std_dev_g ?? 0} g`} />
                      <Stat label={tr("Lightest")} value={grams(summary.min_g)} />
                      <Stat label={tr("Heaviest")} value={grams(summary.max_g)} />
                      <Stat label={tr("Frames used")} value={summary.samples} />
                      <Stat
                        label={tr("Confidence")}
                        value={summary.confidence === null ? "—" : `${Math.round(summary.confidence * 100)}%`}
                      />
                    </dl>

                    {result.per_frame.length > 0 && (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-left text-xs tabular-nums">
                          <thead>
                            <tr style={{ color: "var(--text-tertiary)" }}>
                              <th className="py-1 pr-3 font-semibold">{tr("At")}</th>
                              <th className="py-1 font-semibold">{tr("Weight")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.per_frame.map((sample) => (
                              <tr key={sample.t} style={{ color: "var(--text-secondary)" }}>
                                <td className="py-1 pr-3 font-mono">{clock(sample.t)}</td>
                                <td className="py-1">{grams(sample.mass_g)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}

                <p className="mt-2 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {tr(
                    "A test clip writes nothing. The growth chart only ever sees weights from the live station or a person's scale.",
                  )}
                </p>
              </div>
            )}
          </div>
        )}
      </Block>
    </Section>
  );
}
