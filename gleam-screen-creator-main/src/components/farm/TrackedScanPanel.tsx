import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  startTrack,
  stopTrack,
  trackFile,
  trackFrame,
  trackStatus,
  type TrackSample,
  type TrackSummary,
} from "@/lib/api-client";
import { Hint } from "./SettingsParts";
import { T, tr } from "@/lib/i18n";

/**
 * "Follow every bird": the tracked scan of an uploaded clip (vision clip_scan.py).
 *
 * The older checks above look at single moments. This reads the clip from start to end, one frame every 2 s,
 * keeps each bird's number (ByteTrack plus klydel's stable IDs), and judges huddling and inactivity with klydel's
 * rules on the frames it can trust. Frozen or skipped stretches of recording are gaps: unknown, not calm.
 *
 * The frame strip is the screen's focal point and doubles as the scrubber: one column per sampled frame in three
 * labelled lanes (footage, huddling, inactive), so where the gaps and the events are is visible before any number
 * is read, and the picture under it shows the frame the slider points at with every bird's number drawn on it.
 * Nothing here is saved to the flock's history.
 */

const WINDOWS = [
  { seconds: 120, label: T("2 minutes (quick test)") },
  { seconds: 300, label: T("5 minutes") },
  { seconds: 600, label: T("10 minutes") },
  { seconds: 1800, label: T("30 minutes (thesis rule)") },
];

const GAP_TEXT: Record<string, string> = {
  frozen_frame: T("the picture froze"),
  timestamp_jump: T("time was skipped"),
  unreadable_frame: T("a frame could not be read"),
  excluded_interval: T("marked as bad"),
  too_few_tracked_birds: T("no birds were tracked"),
  tracker_warmup: T("settling after a gap"),
};

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function minutes(seconds: number): string {
  return seconds % 60 === 0 ? tr("{n} min", { n: seconds / 60 }) : tr("{n} s", { n: seconds });
}

function reason(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return tr("Your session ended. Sign in again, then try the clip.");
    if (err.status === 429)
      return tr("Too many uploads or checks in a short time. Wait a few minutes, then try again.");
    switch (err.message) {
      case "scan_busy":
        return tr(
          "Another clip is being followed right now. Wait for it to finish, then try again.",
        );
      case "model_unavailable":
        return tr(
          "The detector has no model loaded, so no bird can be followed. Add the model, then try again.",
        );
      case "unknown_clip":
        return tr("That clip is no longer stored. Upload it again.");
      case "invalid_settings":
      case "invalid_zones":
        return err.detail ?? tr("The scan settings were refused.");
    }
    return err.detail ?? tr("The scan could not be run. Try again.");
  }
  return tr("Could not reach the camera service. Check the connection and try again.");
}

/** Where the slider can stop: every sampled frame that has a picture. */
function frameTimes(samples: TrackSample[]): number[] {
  return samples.filter((s) => s.frame_no !== null).map((s) => s.t);
}

function isEvent(s: TrackSample): boolean {
  return s.status !== "VALID" || (s.huddles?.length ?? 0) > 0 || (s.inactive?.length ?? 0) > 0;
}

/** One column per frame, three lanes. Drawn as one SVG; the range input below it is the control. */
function FrameStrip({ samples, cursor }: { samples: TrackSample[]; cursor: number | null }) {
  const n = samples.length;
  const lanes = [
    { key: "footage", label: tr("Footage") },
    { key: "huddle", label: tr("Huddling") },
    { key: "inactive", label: tr("Inactive") },
  ];
  return (
    <div
      className="grid grid-cols-[4.75rem_1fr] items-stretch gap-x-2 text-[11px]"
      aria-hidden="true"
    >
      <div className="grid grid-rows-3 gap-y-1" style={{ color: "var(--text-secondary)" }}>
        {lanes.map((lane) => (
          <span key={lane.key} className="flex h-4 items-center">
            {lane.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${Math.max(n, 1)} 14`}
        preserveAspectRatio="none"
        className="h-[3.5rem] w-full rounded-sm"
        style={{ background: "var(--surface-sunken)" }}
      >
        {samples.map((s, i) => {
          const footage =
            s.status === "GAP"
              ? "var(--status-red)"
              : s.status === "RECOVERING"
                ? "var(--status-amber)"
                : "var(--status-green)";
          return (
            <g key={`${s.t}-${i}`}>
              <rect
                x={i}
                y={0}
                width={1.02}
                height={4}
                fill={footage}
                opacity={s.status === "VALID" ? 0.45 : 1}
              />
              {(s.huddles?.length ?? 0) > 0 && (
                <rect x={i} y={5} width={1.02} height={4} fill="var(--status-amber)" />
              )}
              {(s.inactive?.length ?? 0) > 0 && (
                <rect x={i} y={10} width={1.02} height={4} fill="var(--status-blue)" />
              )}
            </g>
          );
        })}
        {cursor !== null && n > 0 && (
          <rect
            x={Math.max(0, cursor - 0.4)}
            y={0}
            width={Math.max(0.8, n / 400)}
            height={14}
            fill="var(--brand)"
          />
        )}
      </svg>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg p-2" style={{ background: "var(--surface-raised)" }}>
      <dt className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
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

function headline(summary: TrackSummary): string {
  const b = summary.behaviour;
  if (!b.judged_frames) {
    return tr("No frame of this clip could be trusted, so nothing was judged.");
  }
  const huddling =
    b.frames_with_huddling > 0
      ? tr("Huddling on {n} of {total} trusted frames ({pct}%).", {
          n: b.frames_with_huddling,
          total: b.judged_frames,
          pct: Math.round((b.huddling_share ?? 0) * 100),
        })
      : tr("No huddling on any of the {total} trusted frames.", { total: b.judged_frames });
  const window = minutes(b.inactivity_window_s);
  const inactivity = !b.window_fits
    ? tr("No stretch of trusted footage lasted {window}, so inactivity could not be judged.", {
        window,
      })
    : b.inactive_birds.length > 0
      ? tr("{n} birds stayed put for {window} or longer.", { n: b.inactive_birds.length, window })
      : tr("No bird stayed put for {window}.", { window });
  return `${huddling} ${inactivity}`;
}

async function save(clipId: string, kind: "samples" | "mot") {
  const { blob, filename } = await trackFile(clipId, kind);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TrackedScanPanel({ clipId }: { clipId: string }) {
  const [windowS, setWindowS] = useState(1800);
  const [summary, setSummary] = useState<TrackSummary | null>(null);
  const [samples, setSamples] = useState<TrackSample[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [downloading, setDownloading] = useState<"samples" | "mot" | null>(null);
  const [index, setIndex] = useState(0);
  const [picture, setPicture] = useState<string | null>(null);
  const [pictureBusy, setPictureBusy] = useState(false);
  const pictureRef = useRef<HTMLDivElement>(null);

  const running = summary?.status === "running";
  const finished = summary !== null && !running;

  // A scan started earlier (or by someone else on this clip) is picked up rather than started twice.
  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setSamples([]);
    setError(null);
    setPicture(null);
    setIndex(0);
    trackStatus(clipId)
      .then((s) => !cancelled && setSummary(s))
      .catch(() => undefined); // no scan yet: the empty state below is the answer
    return () => {
      cancelled = true;
    };
  }, [clipId]);

  // Progress every 2 s while it runs; the frames once it stops.
  useEffect(() => {
    if (!summary) return;
    let cancelled = false;
    if (running) {
      const timer = setTimeout(async () => {
        try {
          const next = await trackStatus(clipId);
          if (!cancelled) setSummary(next);
        } catch (err) {
          if (!cancelled) setError(reason(err));
        }
      }, 2000);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
    if (samples.length === 0 && summary.progress.frames_done > 0) {
      trackStatus(clipId, true)
        .then((full) => {
          if (cancelled) return;
          setSummary(full);
          setSamples(full.samples);
        })
        .catch((err) => !cancelled && setError(reason(err)));
    }
    return () => {
      cancelled = true;
    };
  }, [clipId, summary, running, samples.length]);

  const times = useMemo(() => frameTimes(samples), [samples]);
  const byTime = useMemo(() => new Map(samples.map((s) => [s.t, s])), [samples]);
  const selectedT = times[Math.min(index, Math.max(times.length - 1, 0))];
  const selected = selectedT !== undefined ? byTime.get(selectedT) : undefined;
  const cursor = selected ? samples.indexOf(selected) : null;

  // The numbered picture for the selected frame. Debounced: the slider fires once per step while dragged.
  useEffect(() => {
    if (selectedT === undefined) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPictureBusy(true);
      try {
        const shot = await trackFrame(clipId, selectedT);
        if (!cancelled) setPicture(`data:${shot.content_type};base64,${shot.image}`);
      } catch {
        if (!cancelled) setPicture(null);
      } finally {
        if (!cancelled) setPictureBusy(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [clipId, selectedT]);

  const start = async () => {
    setError(null);
    setStarting(true);
    setSamples([]);
    setPicture(null);
    setIndex(0);
    try {
      setSummary(await startTrack(clipId, { inactivity_window_s: windowS }));
    } catch (err) {
      setError(reason(err));
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    setStopping(true);
    try {
      await stopTrack(clipId);
    } catch (err) {
      setError(reason(err));
    } finally {
      setStopping(false);
    }
  };

  const download = async (kind: "samples" | "mot") => {
    setDownloading(kind);
    try {
      await save(clipId, kind);
    } catch (err) {
      setError(reason(err));
    } finally {
      setDownloading(null);
    }
  };

  const jump = useCallback(
    (direction: 1 | -1) => {
      const framed = samples.filter((s) => s.frame_no !== null);
      for (let i = index + direction; i >= 0 && i < framed.length; i += direction) {
        if (isEvent(framed[i])) {
          setIndex(i);
          return;
        }
      }
    },
    [samples, index],
  );

  const goTo = (t: number) => {
    let best = 0;
    times.forEach((x, i) => {
      if (Math.abs(x - t) < Math.abs(times[best] - t)) best = i;
    });
    setIndex(best);
    pictureRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const p = summary?.progress;
  const pct =
    p && p.frames_expected
      ? Math.min(100, Math.round((p.frames_done / p.frames_expected) * 100))
      : 0;
  const gapReasons = summary
    ? Object.entries(summary.gap_reasons).filter(([code]) => code !== "tracker_warmup")
    : [];

  return (
    <div
      className="space-y-3 rounded-md p-3 sm:p-4"
      style={{ border: "1px solid var(--border-default)" }}
    >
      <div>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {tr("Follow every bird")}
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {tr(
            "Reads the whole clip one frame every 2 seconds, keeps each bird's number from start to end, and judges huddling and inactivity on the frames it can trust. Frozen or skipped stretches are marked as gaps. Nothing is saved.",
          )}
        </p>
      </div>

      {!running && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <label
              htmlFor="track-window"
              className="text-xs font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {tr("Inactive when a bird stays put for")}
            </label>
            <select
              id="track-window"
              value={windowS}
              onChange={(e) => setWindowS(Number(e.target.value))}
              className="cb-input tap mt-1 block w-full text-sm"
            >
              {WINDOWS.map((w) => (
                <option key={w.seconds} value={w.seconds}>
                  {tr(w.label)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn-primary tap text-sm"
            disabled={starting}
            onClick={start}
          >
            {starting
              ? tr("Starting…")
              : finished
                ? tr("Follow the birds again")
                : tr("Follow every bird")}
          </button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="text-xs leading-relaxed"
          style={{ color: "var(--status-red-text)" }}
        >
          {error}
        </p>
      )}

      {running && p && (
        <div className="space-y-2">
          <div
            role="progressbar"
            aria-label={tr("Frames read")}
            aria-valuemin={0}
            aria-valuemax={p.frames_expected}
            aria-valuenow={p.frames_done}
            className="h-2 w-full overflow-hidden rounded-full"
            style={{ background: "var(--surface-sunken)" }}
          >
            <div className="h-full" style={{ width: `${pct}%`, background: "var(--brand)" }} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              className="text-xs tabular-nums"
              style={{ color: "var(--text-secondary)" }}
              aria-live="polite"
            >
              {tr("{done} of {total} frames read ({at} of {length} of video).", {
                done: p.frames_done,
                total: p.frames_expected,
                at: clock(p.video_seconds_done),
                length: clock(p.video_seconds_total),
              })}
              {p.eta_s !== null ? ` ${tr("About {time} left.", { time: clock(p.eta_s) })}` : ""}
            </p>
            <button
              type="button"
              className="btn-secondary tap text-sm"
              disabled={stopping}
              onClick={stop}
            >
              {stopping ? tr("Stopping…") : tr("Stop")}
            </button>
          </div>
        </div>
      )}

      {summary?.status === "failed" && (
        <p role="alert" className="text-xs" style={{ color: "var(--status-red-text)" }}>
          {tr("The scan stopped with an error: {error}", { error: summary.error ?? tr("unknown") })}
        </p>
      )}

      {finished && summary && summary.status !== "failed" && (
        <div className="space-y-3">
          <p
            className="text-sm font-semibold leading-snug"
            style={{ color: "var(--text-primary)" }}
          >
            {headline(summary)}
          </p>
          {summary.status === "cancelled" && (
            <Hint>
              {tr("Stopped early: only the first {at} of the clip was read.", {
                at: clock(summary.progress.video_seconds_done),
              })}
            </Hint>
          )}
          {summary.settings.zones.count === 0 && (
            <p className="text-xs leading-relaxed" style={{ color: "var(--status-amber-text)" }}>
              {tr(
                "No feeder or drinker zones were used, so birds crowding at a feeder count as huddling. Draw the zones under Feeder and Drinker Zones, then follow the birds again.",
              )}
            </p>
          )}

          {summary.progress.frames_done === 0 ? null : samples.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              {tr("Loading the frames…")}
            </p>
          ) : (
            <>
              <FrameStrip samples={samples} cursor={cursor} />
              <div>
                <div
                  className="flex flex-wrap items-center justify-between gap-2 text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <label htmlFor="track-frame">{tr("Frame")}</label>
                  <span className="font-mono tabular-nums">
                    {selected ? clock(selected.t) : "0:00"} /{" "}
                    {clock(summary.progress.video_seconds_total)}
                  </span>
                </div>
                <input
                  id="track-frame"
                  type="range"
                  min={0}
                  max={Math.max(times.length - 1, 0)}
                  step={1}
                  value={Math.min(index, Math.max(times.length - 1, 0))}
                  onChange={(e) => setIndex(Number(e.target.value))}
                  aria-valuetext={selected ? `${clock(selected.t)}, ${selected.status}` : undefined}
                  className="mt-1 block w-full"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary tap text-xs"
                    onClick={() => jump(-1)}
                  >
                    {tr("Previous event")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary tap text-xs"
                    onClick={() => jump(1)}
                  >
                    {tr("Next event")}
                  </button>
                </div>
              </div>

              <div ref={pictureRef} className="space-y-1">
                <div
                  className="relative w-full overflow-hidden rounded-md"
                  style={{ border: "1px solid var(--border-default)", minHeight: "9rem" }}
                >
                  {picture ? (
                    <img
                      src={picture}
                      alt={tr("Frame with each tracked bird's number")}
                      className="block h-auto w-full select-none"
                      draggable={false}
                    />
                  ) : (
                    <div
                      className="flex h-36 items-center justify-center px-4 text-center text-xs"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {pictureBusy ? tr("Reading the frame…") : tr("No picture for this frame.")}
                    </div>
                  )}
                </div>
                {selected && (
                  <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {selected.status === "VALID"
                      ? tr(
                          "{birds} birds tracked, {huddles} huddle groups, {inactive} inactive, {feeding} at a feeder.",
                          {
                            birds: selected.n_birds ?? 0,
                            huddles: selected.huddles?.length ?? 0,
                            inactive: selected.inactive?.length ?? 0,
                            feeding: selected.feeding ?? 0,
                          },
                        )
                      : tr("Not judged: {why}.", {
                          why: tr(GAP_TEXT[selected.reason] ?? selected.reason),
                        })}{" "}
                    {tr(
                      "Green boxes are tracked birds, amber ones were given back after a missed frame, violet ones are inactive, grey ones marked + were seen but not tracked and count for huddling only, and red frames are huddles.",
                    )}
                  </p>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Fact label={tr("Frames read")} value={summary.progress.frames_done} />
                <Fact label={tr("Trusted frames")} value={summary.counts.VALID} />
                <Fact label={tr("Gap frames")} value={summary.counts.GAP} />
                <Fact
                  label={tr("Birds in view (average)")}
                  value={summary.tracking.mean_birds_per_frame.toFixed(1)}
                />
                <Fact
                  label={tr("Numbers handed out per bird")}
                  value={
                    summary.tracking.ids_per_bird === null
                      ? "-"
                      : summary.tracking.ids_per_bird.toFixed(2)
                  }
                />
                <Fact
                  label={tr("Longest trusted stretch")}
                  value={clock(summary.behaviour.longest_judged_stretch_s)}
                />
              </dl>

              {gapReasons.length > 0 && (
                <Hint>
                  {tr("Gaps: {list}.", {
                    list: gapReasons
                      .map(([code, n]) => `${tr(GAP_TEXT[code] ?? code)} (${n})`)
                      .join(", "),
                  })}
                </Hint>
              )}

              {summary.behaviour.inactive_birds.length > 0 && (
                <div>
                  <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                    {tr("Birds that stayed put")}
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {summary.behaviour.inactive_birds.slice(0, 12).map((b) => (
                      <li key={b.bird}>
                        <button
                          type="button"
                          className="btn-secondary tap text-xs tabular-nums"
                          onClick={() => goTo(b.from_s)}
                          title={tr("Show the first frame where bird {bird} was inactive", {
                            bird: b.bird,
                          })}
                        >
                          {tr("Bird {bird}: {from} to {to}", {
                            bird: b.bird,
                            from: clock(b.from_s),
                            to: clock(b.to_s),
                          })}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {summary.behaviour.inactive_birds.length > 12 && (
                    <Hint>
                      {tr("and {n} more in the CSV.", {
                        n: summary.behaviour.inactive_birds.length - 12,
                      })}
                    </Hint>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary tap text-sm"
                  disabled={downloading !== null}
                  onClick={() => download("samples")}
                >
                  {downloading === "samples" ? tr("Preparing…") : tr("Download frames (CSV)")}
                </button>
                <button
                  type="button"
                  className="btn-secondary tap text-sm"
                  disabled={downloading !== null}
                  onClick={() => download("mot")}
                >
                  {downloading === "mot"
                    ? tr("Preparing…")
                    : tr("Download tracks for scoring (MOT)")}
                </button>
              </div>
              <Hint>
                {tr(
                  "Rules from the klydel branch of BehaviorMonitoring (commit {commit}). Inactive means a bird stayed within half a body length; it is a reason to go and look, not a diagnosis.",
                  { commit: summary.settings.klydel_commit },
                )}
              </Hint>
            </>
          )}
        </div>
      )}
    </div>
  );
}
