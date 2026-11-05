import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import {
  ApiError,
  birdWeightsAt,
  clipFrame,
  deleteClip,
  uploadClip,
  type BirdWeightEstimate,
  type BirdWeightsResult,
  type VisionClip,
} from "@/lib/api-client";
import { Block, Hint, Section } from "./SettingsParts";
import { tr } from "@/lib/i18n";

/**
 * A rough weight for each bird, from an ordinary colour video.
 *
 * Kept apart from the behaviour test and from the 3D weight test on purpose: the behaviour test says what the birds are
 * doing, the 3D test weighs a Kinect depth recording, and this one guesses weights from how big each bird looks in a
 * normal overhead picture. It is a guide, not a measurement, and the screen says so:
 *
 * 1. Mass is taken as proportional to (the bird's box area) to the power 1.5. That has no scale of its own, so the flock's
 *    average weight is something the operator types in (a scale reading, or the breed standard for the day). The average
 *    on the screen is therefore the one that was typed, never a finding.
 * 2. A bird whose box overlaps another, or is cut by the edge of the picture, is shown but not weighed: its size says
 *    nothing about its weight.
 * 3. Nothing is saved, like every other clip test.
 */

const MAX_UPLOAD_MB = 2560;

function reason(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return tr("Your session ended. Sign in again, then try the clip.");
    if (err.status === 429)
      return tr("Too many uploads or checks in a short time. Wait a few minutes, then try again.");
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
      case "model_unavailable":
        return tr("No detector model is loaded, so no birds can be found.");
      case "invalid_mean_weight":
        return tr("Type the flock's average weight in grams, for example 1100.");
    }
    return err.detail ?? tr("The check could not be run. Try again.");
  }
  return tr("Could not reach the camera service. Check the connection and try again.");
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function grams(g: number | null): string {
  return g === null ? "—" : `${Math.round(g).toLocaleString()} g`;
}

function why(bird: BirdWeightEstimate): string {
  switch (bird.reason) {
    case "overlaps_another_bird":
      return tr("Overlaps another bird, so its size says nothing about its weight");
    case "cut_by_edge":
      return tr("Cut by the edge of the picture");
    case "too_small":
      return tr("Too small to measure");
    default:
      return "";
  }
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

export function BirdWeightSection() {
  const [clip, setClip] = useState<VisionClip | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [frame, setFrame] = useState<string | null>(null);
  const [frameBusy, setFrameBusy] = useState(false);
  const [meanText, setMeanText] = useState("");
  const [result, setResult] = useState<BirdWeightsResult | null>(null);

  const reset = useCallback(() => {
    setClip(null);
    setT(0);
    setFrame(null);
    setResult(null);
    setError(null);
  }, []);

  // The plain picture at the chosen moment, debounced like the behaviour test: dragging the slider fires a change per pixel.
  useEffect(() => {
    if (!clip) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setFrameBusy(true);
      try {
        const shot = await clipFrame(clip.id, t, false);
        if (!cancelled) setFrame(`data:${shot.content_type};base64,${shot.image}`);
      } catch {
        if (!cancelled) setFrame(null);
      } finally {
        if (!cancelled) setFrameBusy(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [clip, t]);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
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
      if (clip) await deleteClip(clip.id).catch(() => undefined);
      setClip(await uploadClip(file));
      setFrame(null);
      setT(0);
    } catch (err) {
      setError(reason(err));
    } finally {
      setUploading(false);
    }
  };

  const estimate = async () => {
    if (!clip) return;
    const meanG = Number(meanText.replace(",", "."));
    if (!Number.isFinite(meanG) || meanG <= 0) {
      setError(tr("Type the flock's average weight in grams, for example 1100."));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      setResult(await birdWeightsAt(clip.id, t, meanG));
    } catch (err) {
      setError(reason(err));
    } finally {
      setBusy(false);
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

  const shown =
    result && result.t === t ? `data:${result.content_type};base64,${result.image}` : frame;
  const summary = result?.summary;

  return (
    <Section title={tr("Test clip — Weight")}>
      <Block>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {tr(
            "Upload an ordinary colour video of the pen to get a rough weight for each bird from how big it looks. This is a guide, not a measurement: it needs the flock's average weight from you, and only compares the birds' sizes with each other. Nothing is saved to the flock's history.",
          )}
        </p>

        <div className="mt-3">
          <label
            htmlFor="bird-weight-file"
            className="text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {tr("Video file")}
          </label>
          <input
            id="bird-weight-file"
            type="file"
            accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,.mp4,.mov,.avi,.mkv,.m4v,.webm"
            disabled={uploading}
            onChange={onFile}
            className="cb-input mt-1.5 block w-full text-sm file:mr-3 file:rounded file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-semibold"
          />
          <Hint>
            {uploading
              ? tr("Uploading and reading the clip… a long clip takes a while.")
              : tr("MP4 (H.264) works best. Up to {n} MB and 1 hour.", { n: MAX_UPLOAD_MB })}
          </Hint>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-2 text-xs leading-relaxed"
            style={{ color: "var(--status-red-text)" }}
          >
            {error}
          </p>
        )}

        {clip && (
          <div className="mt-4 space-y-3">
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2"
              style={{ background: "var(--surface-raised)" }}
            >
              <div className="min-w-0">
                <p
                  className="truncate text-sm font-semibold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {clip.name}
                </p>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {clock(clip.duration_s)} · {clip.width}×{clip.height} · {clip.fps.toFixed(0)} fps
                  · {megabytes(clip.bytes)}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary tap text-xs"
                disabled={forgetting || busy}
                onClick={forget}
              >
                {forgetting ? tr("Removing…") : tr("Remove clip")}
              </button>
            </div>

            <div
              className="relative w-full overflow-hidden rounded-md"
              style={{ border: "1px solid var(--border-default)", minHeight: "9rem" }}
            >
              {shown ? (
                <img
                  src={shown}
                  alt={tr("Frame from the clip with each bird's estimated weight")}
                  className="block h-auto w-full select-none"
                  draggable={false}
                />
              ) : (
                <div
                  className="flex h-36 items-center justify-center px-4 text-center text-xs"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {frameBusy
                    ? tr("Reading the frame…")
                    : tr("No picture at this point. Try another moment.")}
                </div>
              )}
            </div>

            <div>
              <div
                className="flex items-center justify-between text-xs"
                style={{ color: "var(--text-secondary)" }}
              >
                <label htmlFor="bird-weight-time">{tr("Moment")}</label>
                <span className="font-mono tabular-nums">
                  {clock(t)} / {clock(clip.duration_s)}
                </span>
              </div>
              <input
                id="bird-weight-time"
                type="range"
                min={0}
                max={Math.max(clip.duration_s, 0.1)}
                step={0.2}
                value={t}
                onChange={(e) => setT(Number(e.target.value))}
                className="mt-1 block w-full"
              />
            </div>

            <div>
              <label
                htmlFor="bird-weight-mean"
                className="text-sm font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                {tr("Average weight of the flock (grams)")}
              </label>
              <input
                id="bird-weight-mean"
                type="number"
                inputMode="decimal"
                min={30}
                max={8000}
                step={10}
                value={meanText}
                onChange={(e) => setMeanText(e.target.value)}
                placeholder="1100"
                className="cb-input mt-1.5 block w-40 text-sm"
              />
              <Hint>
                {tr(
                  "A scale reading of a few birds from that day, or the breed standard for the grow-out day (about 1,100 g on day 24). The estimates are scaled so the weighed birds average this.",
                )}
              </Hint>
            </div>

            <button
              type="button"
              className="btn-primary tap text-sm disabled:opacity-50"
              disabled={busy}
              onClick={estimate}
            >
              {busy ? tr("Estimating…") : tr("Estimate weights")}
            </button>

            {result && summary && (
              <div className="rounded-md p-3" style={{ border: "1px solid var(--border-subtle)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {summary.weighed === 0
                    ? tr("No bird could be weighed at this moment.")
                    : tr("{n} of {total} birds weighed at {time}", {
                        n: summary.weighed,
                        total: summary.birds,
                        time: clock(result.t),
                      })}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label={tr("Average (as typed)")} value={grams(result.mean_g)} />
                  <Stat label={tr("Lightest")} value={grams(summary.min_g)} />
                  <Stat label={tr("Heaviest")} value={grams(summary.max_g)} />
                  <Stat
                    label={tr("Spread")}
                    value={summary.spread_percent === null ? "—" : `${summary.spread_percent}%`}
                  />
                </dl>
                <p
                  className="mt-2 text-xs leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {tr(
                    "Rough guide only: one bird's estimate can be well off, and the average is the one you typed, not a finding. Birds drawn grey with a dash were seen but not weighed.",
                  )}
                </p>

                <ul
                  className="mt-3 divide-y text-sm"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  {result.birds.map((bird, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-3 py-1.5"
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      <span style={{ color: "var(--text-secondary)" }}>
                        {tr("Bird {n}", { n: i + 1 })}
                      </span>
                      <span className="text-right">
                        <span
                          className="font-mono font-semibold tabular-nums"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {grams(bird.weight_g)}
                        </span>
                        {bird.reason && (
                          <span className="block text-xs" style={{ color: "var(--text-tertiary)" }}>
                            {why(bird)}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Block>
    </Section>
  );
}
