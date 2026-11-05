import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import {
  ApiError,
  analyzeClipAt,
  clipFrame,
  deleteClip,
  sweepClip,
  uploadClip,
  type VideoAnalysisResult,
  type VideoConclusion,
  type VideoSweepResult,
  type VisionBehavior,
  type VisionClip,
} from "@/lib/api-client";
import { Block, Hint, Section } from "./SettingsParts";
import { T, tr } from "@/lib/i18n";

/**
 * The behaviour analysis, run against a recording instead of the camera.
 *
 * Why this screen exists: a model that has just been swapped in should not
 * have to wait for the flock to do something interesting before anyone knows
 * whether it works, and the camera is not always reachable. Upload a clip,
 * scrub to a moment, and see what the same pipeline the live camera feeds
 * makes of it.
 *
 * Three things are deliberate:
 *
 * 1. Nothing is saved. The clip lives in the vision container's temp directory
 *    for two hours, and the readings never reach `behavior_snapshots` — a
 *    recording is not a reading, and inventing history for the trend chart
 *    would make every later chart wrong.
 * 2. A clip has no clock, so the night rule cannot apply. Everything here is
 *    judged by the daytime rules, and the screen says so.
 * 3. The annotations are the point. "It sees nothing" and "it sees the wrong
 *    thing" look identical in a table of counts, and completely different with
 *    the boxes drawn on the frame.
 */

/** Mirrors the API's own default, so an oversized file is refused before it travels. */
const MAX_UPLOAD_MB = 2560;

const CONCLUSION_TEXT: Record<VideoConclusion, string> = {
  no_samples: T("No frames could be read from this clip."),
  model_unavailable: T(
    "The detector has no model loaded, so nothing was counted. Add the model, then try again.",
  ),
  nothing_usable: T("None of the sampled moments could be measured."),
  both_sustained: T("Both inactivity and huddling last through the clip."),
  inactivity_sustained: T("Inactivity lasts through the clip."),
  huddling_sustained: T("Huddling lasts through the clip."),
  inactivity_seen: T("Inactivity appears, but not for long enough to raise an alarm."),
  huddling_seen: T("Huddling appears, but not for long enough to raise an alarm."),
  nothing_alarming: T("Nothing alarming in the sampled moments."),
};

const WARNING_TEXT: Record<string, string> = {
  model_unavailable: T("No detector model is loaded, so nothing was counted."),
  too_dark: T("The picture is too dark to judge."),
  no_birds: T("No birds were found in this frame."),
  no_frame: T("No frame could be read."),
  video_frame_unavailable: T("That moment could not be read from the file."),
  camera_moved: T("The picture moved; movement was measured after lining the frames up."),
};

/** What to tell the operator when a call is refused. */
function reason(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return tr("Your session ended. Sign in again, then try the clip.");
    if (err.status === 429) return tr("Too many uploads or checks in a short time. Wait a few minutes, then try again.");
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
      case "video_frame_unavailable":
        return tr("There is no usable frame at that moment. Try another point.");
    }
    return err.detail ?? tr("The check could not be run. Try again.");
  }
  return tr("Could not reach the camera service. Check the connection and try again.");
}

function motionPct(value: number | undefined): string {
  return `${((value ?? 0) * 100).toFixed(1)}%`;
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

function tone(status: string): string {
  if (status === "critical") return "var(--status-red-text)";
  if (status === "warning") return "var(--status-amber-text, #d97706)";
  return "var(--status-green-text)";
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

/** The two verdicts and the counts behind them, in one small grid. */
function Readings({ behavior, warnings }: { behavior: VisionBehavior; warnings: string[] }) {
  return (
    <div className="mt-2 space-y-2">
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <Stat label={tr("Birds")} value={behavior.bird_count ?? 0} />
        <Stat label={tr("At feeder")} value={behavior.zone_count ?? 0} />
        <Stat label={tr("Counted")} value={behavior.evaluable_count ?? 0} />
        <Stat label={tr("Inactive")} value={behavior.inactive_count ?? 0} />
        <Stat label={tr("Huddled")} value={behavior.huddled_count ?? 0} />
        <Stat label={tr("Movement")} value={motionPct(behavior.movement_index)} />
      </dl>
      <div className="flex flex-wrap gap-2 text-xs">
        <span
          className="rounded-full border px-2.5 py-1 font-semibold"
          style={{
            color: tone(behavior.movement_status),
            borderColor: "var(--border-default)",
          }}
        >
          {tr("Movement")}: {behavior.movement_label}
        </span>
        <span
          className="rounded-full border px-2.5 py-1 font-semibold"
          style={{
            color: tone(behavior.huddling_status),
            borderColor: "var(--border-default)",
          }}
        >
          {tr("Crowding")}: {behavior.huddling_label} · {motionPct(behavior.huddling_risk)}
        </span>
        {behavior.reliable === false && (
          <span className="rounded-full border px-2.5 py-1" style={{ borderColor: "var(--border-default)", color: "var(--text-tertiary)" }}>
            {tr("Not enough to judge")}
          </span>
        )}
      </div>
      {warnings.map((code) => (
        <Hint key={code}>{tr(WARNING_TEXT[code] ?? code)}</Hint>
      ))}
    </div>
  );
}

export function VideoTestSection() {
  const [clip, setClip] = useState<VisionClip | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<"analyze" | "sweep" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [t, setT] = useState(0);
  const [frame, setFrame] = useState<string | null>(null);
  const [frameBusy, setFrameBusy] = useState(false);
  const [analysis, setAnalysis] = useState<VideoAnalysisResult | null>(null);
  const [sweep, setSweep] = useState<VideoSweepResult | null>(null);

  const reset = useCallback(() => {
    setClip(null);
    setT(0);
    setFrame(null);
    setAnalysis(null);
    setSweep(null);
    setError(null);
  }, []);

  // One frame per seek, annotated. Debounced because dragging the slider fires
  // a change per pixel, and every one of them would decode the clip in an
  // environment that may only have one CPU to spare.
  useEffect(() => {
    if (!clip) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setFrameBusy(true);
      try {
        const shot = await clipFrame(clip.id, t, true);
        if (!cancelled) setFrame(`data:${shot.content_type};base64,${shot.image}`);
      } catch {
        // A frame that will not decode is not an error worth a banner: the
        // slider passes through them. The picture simply stays as it was.
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
    // Cleared straight away so picking the same file again still fires.
    event.target.value = "";
    if (!file) return;

    setError(null);
    setAnalysis(null);
    setSweep(null);
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(tr("The clip is larger than the {n} MB limit.", { n: MAX_UPLOAD_MB }));
      return;
    }

    setUploading(true);
    try {
      // One clip at a time: the previous one is only a test artefact, and the
      // alternative is a temp directory quietly filling with forgotten files.
      if (clip) await deleteClip(clip.id).catch(() => undefined);
      const stored = await uploadClip(file);
      setClip(stored);
      setFrame(null);
      setT(0);
    } catch (err) {
      setError(reason(err));
    } finally {
      setUploading(false);
    }
  };

  const analyse = async () => {
    if (!clip) return;
    setError(null);
    setBusy("analyze");
    try {
      setAnalysis(await analyzeClipAt(clip.id, t));
      setSweep(null);
    } catch (err) {
      setError(reason(err));
    } finally {
      setBusy(null);
    }
  };

  const analyseWhole = async () => {
    if (!clip) return;
    setError(null);
    setBusy("sweep");
    try {
      setSweep(await sweepClip(clip.id));
      setAnalysis(null);
    } catch (err) {
      setError(reason(err));
    } finally {
      setBusy(null);
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

  return (
    <Section title={tr("Test clip — Behaviour")}>
      <Block>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {tr(
            "Upload a recording to check the behaviour detection without the camera. It is measured exactly as a live reading is — same detector, same feeder zones, same thresholds — and nothing is saved to the flock's history.",
          )}
        </p>

        <div className="mt-3">
          <label htmlFor="clip-file" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {tr("Video file")}
          </label>
          <input
            id="clip-file"
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
                disabled={forgetting || busy !== null}
                onClick={forget}
              >
                {forgetting ? tr("Removing…") : tr("Remove clip")}
              </button>
            </div>

            {/* The wrapper is exactly the picture, same reasoning as the zone
                drawing: no letterbox margins to misread. */}
            <div
              className="relative w-full overflow-hidden rounded-md"
              style={{ border: "1px solid var(--border-default)", minHeight: "9rem" }}
            >
              {frame ? (
                <img src={frame} alt={tr("Annotated frame from the clip")} className="block h-auto w-full select-none" draggable={false} />
              ) : (
                <div className="flex h-36 items-center justify-center px-4 text-center text-xs" style={{ color: "var(--text-tertiary)" }}>
                  {frameBusy ? tr("Reading the frame…") : tr("No picture at this point. Try another moment.")}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-secondary)" }}>
                <label htmlFor="clip-time">{tr("Moment")}</label>
                <span className="font-mono tabular-nums">
                  {clock(t)} / {clock(clip.duration_s)}
                </span>
              </div>
              <input
                id="clip-time"
                type="range"
                min={0}
                max={Math.max(clip.duration_s, 0.1)}
                step={0.2}
                value={t}
                onChange={(e) => {
                  setT(Number(e.target.value));
                  setAnalysis(null);
                }}
                className="mt-1 block w-full"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary tap text-sm disabled:opacity-50"
                disabled={busy !== null}
                onClick={analyse}
              >
                {busy === "analyze" ? tr("Checking…") : tr("Check this moment")}
              </button>
              <button
                type="button"
                className="btn-secondary tap text-sm disabled:opacity-50"
                disabled={busy !== null || clip.duration_s < 1}
                onClick={analyseWhole}
              >
                {busy === "sweep" ? tr("Checking the whole clip…") : tr("Check the whole clip")}
              </button>
            </div>

            {analysis && (
              <div className="rounded-md p-3" style={{ border: "1px solid var(--border-subtle)" }}>
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
                  {tr("At {time}", { time: clock(analysis.t) })}
                </p>
                <Readings behavior={analysis.behaviour} warnings={analysis.warnings ?? []} />
              </div>
            )}

            {sweep && (
              <div className="rounded-md p-3" style={{ border: "1px solid var(--border-subtle)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {tr(CONCLUSION_TEXT[sweep.summary.conclusion])}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                  {tr("{used} of {taken} sampled moments could be measured.", {
                    used: sweep.summary.usable,
                    taken: sweep.summary.samples,
                  })}
                  {sweep.sampling.truncated ? ` ${tr("The clip was long, so the sweep stopped early.")}` : ""}
                </p>
                <p className="mt-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {tr("A clip has no clock, so the daytime rules apply to every frame of it.")}
                </p>

                {sweep.samples.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs tabular-nums">
                      <thead>
                        <tr style={{ color: "var(--text-tertiary)" }}>
                          <th className="py-1 pr-3 font-semibold">{tr("At")}</th>
                          <th className="py-1 pr-3 font-semibold">{tr("Birds")}</th>
                          <th className="py-1 pr-3 font-semibold">{tr("Movement")}</th>
                          <th className="py-1 font-semibold">{tr("Crowding")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sweep.samples.map((sample) => (
                          <tr key={sample.t} style={{ color: "var(--text-secondary)" }}>
                            <td className="py-1 pr-3 font-mono">{clock(sample.t)}</td>
                            <td className="py-1 pr-3">{sample.behavior.bird_count ?? 0}</td>
                            <td className="py-1 pr-3" style={{ color: tone(sample.behavior.movement_status) }}>
                              {sample.behavior.movement_label}
                            </td>
                            <td className="py-1" style={{ color: tone(sample.behavior.huddling_status) }}>
                              {sample.behavior.huddling_label}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {!sweep.model_loaded && (
                  <Hint>
                    {tr("No detector model is loaded, so these are measurements of nothing at all.")}
                  </Hint>
                )}
              </div>
            )}
          </div>
        )}
      </Block>
    </Section>
  );
}
