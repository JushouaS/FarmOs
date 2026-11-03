import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, CheckCircle2, Film, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ApiError, DEMO_VIDEO_MAX_MB, convertVideo, detectVideo, type VideoDetection } from "@/lib/api-client";
import { DEFAULT_LIGHTING, isNightCycle, type LightingHours } from "@/lib/farm/lighting";
import { VIDEO_WEIGHT_ERROR_PERCENT, estimateVideoWeights, type VideoWeights } from "@/lib/farm/video-weight";
import { T, tr } from "@/lib/i18n";

/* "Test video" on Live Camera: pick a clip from this device, the trained
 * detector (running on the camera computer, see cerebroil-stream/demo_detect.py)
 * checks it, and the clip plays back with the boxes it found drawn over it.
 * Nothing is saved and the live camera is not touched. */

const MAX_BYTES = DEMO_VIDEO_MAX_MB * 1024 * 1024;
const ANALYZED_SECONDS = 30;
/* Bird states, indexed by the code the camera computer sends:
 * 0 moving, 1 resting (still at night), 2 inactive (still by day while the flock moves),
 * 3 huddling, 4 inactivity (the whole flock still by day). */
const STATE_COLORS = ["#34d399", "#a78bfa", "#fbbf24", "#60a5fa", "#fb7185"];
const STATE_NAMES = [T("Moving"), T("Resting"), T("Inactive"), T("Huddling"), T("Inactivity")];
const LEGEND_ORDER = [0, 1, 4, 2, 3];
/** States shared by many birds are labelled once, on the lowest numbered bird, with a count. */
const GROUP_STATES = [1, 3, 4];

/** The time of day in a recording's file name ("..._0600_to_0700.mkv", "...T06:15:00"), or null. */
function timeInName(name: string): [number, number] | null {
  const m = name.match(/(?:^|\D)([01]\d|2[0-3])([0-5]\d)_to_\d{4}/) ?? name.match(/T([01]\d|2[0-3])[:.-]?([0-5]\d)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Night or day for a clip: from the time in its name and the lighting hours in Settings, else day. */
function guessNight(name: string, lighting: LightingHours): boolean {
  const t = timeInName(name);
  if (!t) return false;
  const when = new Date();
  when.setHours(t[0], t[1], 0, 0);
  return isNightCycle(when, lighting);
}
/** Containers every browser plays. Anything else (MKV, AVI, ...) is converted first. */
const PLAYABLE = /\.(mp4|m4v|webm|mov)$/i;

function errorText(err: unknown, wasCut: boolean): string {
  if (err instanceof ApiError) {
    if (err.message === "model_not_installed") return tr("The detector is not installed on the camera computer yet.");
    if (err.message === "converter_not_installed") return tr("The video converter is not installed on the camera computer yet.");
    // The camera computer answered "no such route": it still runs an older version.
    if (err.status === 404 || err.message === "demo_convert_error" || err.message === "demo_detect_error") {
      return tr("The camera computer needs an update before it can do this. Update it, then try again.");
    }
    if (err.message === "unreadable_video") {
      return wasCut
        ? tr("This video cannot be cut at {mb} MB because its index is at the end of the file. Use an MKV or WebM file, or a smaller clip.", { mb: DEMO_VIDEO_MAX_MB })
        : tr("The video could not be read. Try an MP4 or WebM file.");
    }
    if (err.message === "video_too_large" || err.status === 413) return tr("That video is over {mb} MB.", { mb: DEMO_VIDEO_MAX_MB });
    if (err.message === "vision_service_unavailable" || err.status === 503) return tr("The camera computer is not reachable.");
    if (err.status === 401) return tr("Your session ended. Sign in again.");
    if (err.status === 403) return tr("Your account can watch the camera but cannot start checks. Ask an administrator for the Operator role.");
    if (err.status === 429) return tr("Another video is being checked. Try again in a minute.");
  }
  return tr("Could not check the video. Try again.");
}

/** Index of the last sampled frame at or before time t, or -1. */
function frameAt(frames: VideoDetection["frames"], t: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function VideoDetectDialog({ lighting = DEFAULT_LIGHTING, standardG = 1000 }: { lighting?: LightingHours; standardG?: number }) {
  const [open, setOpen] = useState(false);
  // Was the clip filmed with the lights off? Still birds are then resting, not inactive.
  const [night, setNight] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"converting" | "checking" | null>(null);
  const [cutFrom, setCutFrom] = useState<number | null>(null); // size of the original when it was over the limit
  const [needsConvert, setNeedsConvert] = useState(false);
  // What was chosen, as it was (the file in state changes when it is cut or converted), and how long it plays.
  const [original, setOriginal] = useState<{ name: string; bytes: number } | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [lengthFailed, setLengthFailed] = useState(false);
  // Asked once per file: "this is not ideal, use it anyway?"
  const [confirmOpen, setConfirmOpen] = useState(false);
  const acknowledged = useRef(false);
  const converted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VideoDetection | null>(null);
  // Birds in the frame on screen: [all, inactive, huddling]
  const [inFrame, setInFrame] = useState<[number, number, number]>([0, 0, 0]);
  const weightsRef = useRef<VideoWeights | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Full screen is for the video AND the readings drawn over it, so it is this box that goes full screen.
  const stageRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  // A rough weight for each bird, from the size of its box around the standard weight for the grow-out day.
  const weights = useMemo(
    () => (result ? estimateVideoWeights(result.frames, result.width, result.height, standardG) : null),
    [result, standardG],
  );
  weightsRef.current = weights;

  // The video's own full screen button (beside the volume) is the one to use. On its own it would make only the video
  // full screen, and the boxes and weights drawn over it would be lost, so the request is moved to the box that holds
  // both. Pressing the button again while the box is full screen leaves full screen.
  const lastFullscreen = useRef<Element | null>(null);
  useEffect(() => {
    const onChange = () => {
      const now = document.fullscreenElement;
      const before = lastFullscreen.current;
      lastFullscreen.current = now;
      const video = videoRef.current;
      if (now && now === video) {
        if (before && before === stageRef.current) void document.exitFullscreen().catch(() => {});
        else {
          // If the box cannot go full screen, the video goes (without the readings) rather than nothing happening.
          void document
            .exitFullscreen()
            .then(() => stageRef.current?.requestFullscreen())
            .catch(() => video.requestFullscreen().catch(() => {}));
        }
      }
      setFullscreen(now != null && now === stageRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Draw the boxes of the sampled frame that matches the video's current time.
  useEffect(() => {
    if (!result) return;
    let raf = 0;
    let shown = "";
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!video || !canvas || !ctx) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      const idx = video.currentTime <= result.analyzed_seconds + 0.5 ? frameAt(result.frames, video.currentTime) : -1;
      const boxes = idx >= 0 ? result.frames[idx].boxes : [];
      // The video is fitted inside this box (with bars at the sides or top in full screen); the boxes follow it.
      const scale = Math.min(w / result.width, h / result.height);
      const offX = (w - result.width * scale) / 2;
      const offY = (h - result.height * scale) / 2;
      ctx.lineWidth = 2;
      ctx.font = "12px ui-monospace, monospace";
      let inactive = 0;
      let huddling = 0;
      const groupCount: Record<number, number> = {};
      const groupLabelId: Record<number, number> = {};
      for (const b of boxes) {
        if (b[7] === 2 || b[7] === 4) inactive++;
        if (b[7] === 3) huddling++;
        if (GROUP_STATES.includes(b[7])) {
          groupCount[b[7]] = (groupCount[b[7]] ?? 0) + 1;
          groupLabelId[b[7]] = Math.min(groupLabelId[b[7]] ?? Infinity, b[6]);
        }
      }
      for (const [x, y, bw, bh, conf, , id, stateCode] of boxes) {
        const state = stateCode ?? 0;
        const color = STATE_COLORS[state] ?? STATE_COLORS[0];
        ctx.strokeStyle = color;
        ctx.lineWidth = state >= 2 ? 3 : 2;
        ctx.strokeRect(x * scale + offX, y * scale + offY, bw * scale, bh * scale);
        // The bird's estimated weight, in the middle of its box.
        const grams = id != null ? weightsRef.current?.byId.get(id) : undefined;
        if (grams != null) {
          const text = `${grams} g`;
          ctx.font = "bold 12px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(0,0,0,0.85)";
          ctx.strokeText(text, (x + bw / 2) * scale + offX, (y + bh / 2) * scale + offY + 4);
          ctx.fillStyle = "#fff";
          ctx.fillText(text, (x + bw / 2) * scale + offX, (y + bh / 2) * scale + offY + 4);
          ctx.textAlign = "left";
          ctx.font = "12px ui-monospace, monospace";
          ctx.strokeStyle = color;
          ctx.lineWidth = state >= 2 ? 3 : 2;
        }
        // Moving birds only get their number, and a group (huddle, resting, flock inactivity) one label, so the picture stays readable.
        let label = "";
        if (state === 0 || id == null) label = `${id != null ? `#${id} ` : ""}${Math.round(conf * 100)}%`;
        else if (GROUP_STATES.includes(state)) label = id === groupLabelId[state] ? `${tr(STATE_NAMES[state])} x${groupCount[state]}` : "";
        else label = `#${id} ${tr(STATE_NAMES[state])}`;
        if (!label) continue;
        const tw = ctx.measureText(label).width + 8;
        const ly = Math.max(0, y * scale + offY - 16);
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(x * scale + offX, ly, tw, 16);
        ctx.fillStyle = color;
        ctx.fillText(label, x * scale + offX + 4, ly + 12);
      }
      const key = `${boxes.length}/${inactive}/${huddling}`;
      if (key !== shown) {
        shown = key;
        setInFrame([boxes.length, inactive, huddling]);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [result]);

  const reset = () => {
    setFile(null);
    setBusy(false);
    setStage(null);
    setCutFrom(null);
    setNeedsConvert(false);
    setOriginal(null);
    setDuration(null);
    setLengthFailed(false);
    setConfirmOpen(false);
    acknowledged.current = false;
    converted.current = false;
    setNight(false);
    setError(null);
    setResult(null);
    setInFrame([0, 0, 0]);
  };

  const chooseNight = (value: boolean) => {
    if (value === night) return;
    setNight(value);
    // The answer depends on it, so the old one is dropped; press "Check video" again.
    setResult(null);
    setInFrame([0, 0, 0]);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setResult(null);
    setInFrame([0, 0, 0]);
    setError(null);
    setNight(guessNight(picked.name, lighting));
    setOriginal({ name: picked.name, bytes: picked.size });
    setDuration(null);
    setLengthFailed(false);
    acknowledged.current = false;
    converted.current = false;
    // A file over the limit is cut to exactly the limit, so only that part is uploaded.
    const tooBig = picked.size > MAX_BYTES;
    setCutFrom(tooBig ? picked.size : null);
    setNeedsConvert(tooBig || !PLAYABLE.test(picked.name));
    setFile(tooBig ? new File([picked.slice(0, MAX_BYTES)], picked.name, { type: picked.type }) : picked);
  };

  const check = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let current = file;
      let didConvert = false;
      const convert = async () => {
        setStage("converting");
        current = await convertVideo(file);
        didConvert = true;
        converted.current = true;
        setFile(current);
        setNeedsConvert(false);
      };
      if (needsConvert) await convert();
      setStage("checking");
      try {
        setResult(await detectVideo(current, night));
      } catch (err) {
        // The camera computer may not be able to decode this codec (H.265, VP9, ...): convert once and try again.
        if (didConvert || !(err instanceof ApiError) || err.message !== "unreadable_video") throw err;
        await convert();
        setStage("checking");
        setResult(await detectVideo(current, night));
      }
    } catch (err) {
      setError(errorText(err, cutFrom != null));
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  // What is not ideal about the file that was chosen. A good file (MP4 or WebM, under the size limit, no longer than
  // the part that is checked) has none, and then nothing is asked.
  const ext = original ? (original.name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toUpperCase() : "";
  const sizeMb = original ? Math.max(1, Math.round(original.bytes / 1048576)) : 0;
  const longClip = duration != null && duration > ANALYZED_SECONDS + 0.5;
  const checklist = original
    ? [
        PLAYABLE.test(original.name)
          ? { ok: true, text: tr("Format: {ext}", { ext }) }
          : { ok: false, text: tr("Format: {ext}. It is converted first, which adds time on the camera computer.", { ext: ext || "?" }) },
        original.bytes <= MAX_BYTES
          ? { ok: true, text: tr("Size: {size} MB", { size: sizeMb }) }
          : { ok: false, text: tr("Size: {size} MB. Only the first {mb} MB are used, and an MP4 whose index is at the end cannot be cut that way and will fail.", { size: sizeMb, mb: DEMO_VIDEO_MAX_MB }) },
        duration == null
          ? {
              ok: true,
              text: lengthFailed
                ? tr("Length: could not be read from the file")
                : PLAYABLE.test(original.name)
                  ? tr("Length: reading it…")
                  : tr("Length: not known until it is converted"),
            }
          : longClip
            ? { ok: false, text: tr("Length: {n} seconds. Only the first {seconds} seconds are checked.", { n: Math.round(duration), seconds: ANALYZED_SECONDS }) }
            : { ok: true, text: tr("Length: {n} seconds", { n: Math.max(1, Math.round(duration)) }) },
      ]
    : [];
  const issues = checklist.filter((row) => !row.ok).map((row) => row.text);

  /** "Check video": a file that is not ideal gets one question first, with the cost and a way back. */
  const requestCheck = () => {
    if (issues.length > 0 && !acknowledged.current) setConfirmOpen(true);
    else void check();
  };

  const className = result ? result.names["0"] ?? "item" : "";
  const behavior = result?.behavior;
  // The check stops at ANALYZED_SECONDS, so only a clip that long (or longer) was cut short.
  const partly = result != null && result.analyzed_seconds >= ANALYZED_SECONDS - 0.5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="tactile-btn tap flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] px-2.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          title={tr("Test the detector on a video")}
          aria-label={tr("Test video")}
        >
          <Film className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{tr("Test video")}</span>
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="font-display text-xl">{tr("Test the detector on a video")}</DialogTitle>
          <DialogDescription>
            {tr("Choose a short video clip. The trained model checks it and marks what it finds. Nothing is saved.")}
          </DialogDescription>
          <p className="text-sm text-[var(--text-secondary)]">
            {tr("Best: an MP4 or WebM clip under {mb} MB and {seconds} seconds or shorter. Other files still work, but take longer.", { mb: DEMO_VIDEO_MAX_MB, seconds: ANALYZED_SECONDS })}
          </p>
        </DialogHeader>

        <input ref={inputRef} type="file" accept="video/*,.mkv,.avi" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onPick} />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="tap rounded-full border border-[var(--border-default)] bg-[var(--surface-raised)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--brand)] disabled:opacity-60"
          >
            {file ? tr("Choose another video") : tr("Choose video")}
          </button>
          <button
            type="button"
            onClick={requestCheck}
            disabled={!file || busy}
            className="tap inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {tr("Check video")}
          </button>
          <p className="text-xs text-[var(--text-tertiary)]">
            {file ? file.name : tr("Larger files are cut to {mb} MB. Only the first {seconds} seconds are checked.", { mb: DEMO_VIDEO_MAX_MB, seconds: ANALYZED_SECONDS })}
          </p>
        </div>

        {/* When the clip was filmed decides what a still bird means: sleeping at night, a bird to check by day. */}
        <div role="radiogroup" aria-label={tr("When was this recorded?")} className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span>{tr("Recorded during:")}</span>
          {[
            { value: false, label: tr("Day") },
            { value: true, label: tr("Night") },
          ].map((option) => (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={night === option.value}
              disabled={busy}
              onClick={() => chooseNight(option.value)}
              className={`tap rounded-full border px-3 py-1 font-medium disabled:opacity-60 ${
                night === option.value
                  ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                  : "border-[var(--border-default)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:border-[var(--brand)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {original && !result && (
          <ul aria-label={tr("What was chosen")} className="space-y-1 text-xs">
            {checklist.map((row) => (
              <li key={row.text} className="flex items-start gap-1.5" style={{ color: row.ok ? "var(--text-secondary)" : "var(--status-amber-text)" }}>
                {row.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-green)]" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{row.text}</span>
              </li>
            ))}
          </ul>
        )}
        {busy && (
          <p role="status" className="text-sm text-[var(--text-secondary)]">
            {stage === "converting"
              ? tr("Converting the video so it can play here. This can take a minute or two.")
              : tr("Checking the video. This can take a minute or two.")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--status-red-text)" }}>
            {error}
          </p>
        )}

        {url && (
          <div
            ref={stageRef}
            className={`relative overflow-hidden bg-black ${fullscreen ? "" : "rounded-xl border border-[var(--border-default)]"}`}
          >
            <video
              ref={videoRef}
              src={url}
              controls
              disablePictureInPicture
              playsInline
              muted
              className={fullscreen ? "block h-full w-full object-contain" : "block max-h-[50vh] w-full"}
              onLoadedMetadata={(e) => {
                // How long the file the person chose plays (a converted copy is shorter, so it does not count).
                const seconds = e.currentTarget.duration;
                if (!converted.current && Number.isFinite(seconds)) setDuration(seconds);
              }}
              onError={() => {
                if (!converted.current) setLengthFailed(true);
                setNeedsConvert(true);
              }}
            />
            {result && <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-full w-full" />}
          </div>
        )}

        {result && (
          <div className="space-y-1.5 text-sm">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]" aria-label={tr("Colors")}>
              {LEGEND_ORDER.map((i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATE_COLORS[i] }} aria-hidden="true" />
                  {tr(STATE_NAMES[i])}
                </li>
              ))}
            </ul>
            <p className="font-mono text-xs text-[var(--brand)]">
              {tr("In this frame: {n} birds, {i} inactive, {h} huddling", { n: inFrame[0], i: inFrame[1], h: inFrame[2] })}
            </p>
            <p className="text-[var(--text-secondary)]">
              {tr("{frames} frames checked. Most in one frame: {max}. Average: {mean}.", {
                frames: result.summary.frames,
                max: result.summary.max_per_frame,
                mean: result.summary.mean_per_frame,
              })}
            </p>
            {behavior && (
              <>
                <p
                  className="font-medium"
                  style={{
                    color: behavior.params.night
                      ? STATE_COLORS[1]
                      : behavior.inactive_birds.length
                        ? STATE_COLORS[2]
                        : (behavior.flock_still_share ?? 0) >= 0.5
                          ? STATE_COLORS[4]
                          : "var(--text-secondary)",
                  }}
                >
                  {behavior.params.night
                    ? tr("Recorded at night: still birds are resting, so none is called inactive.")
                    : behavior.inactive_birds.length
                      ? tr("Inactive: {n} birds stayed still for {s} seconds or more while the rest of the flock moved.", {
                          n: behavior.inactive_birds.length,
                          s: behavior.params.inactive_seconds,
                        })
                      : result.analyzed_seconds < behavior.params.inactive_seconds
                        ? tr("The clip is shorter than {s} seconds, too short to call a bird inactive.", { s: behavior.params.inactive_seconds })
                        : (behavior.flock_still_share ?? 0) >= 0.5
                          ? tr("Most of the flock was still during the day, so no single bird stands out. Check the house.")
                          : tr("No inactive birds found.")}
                </p>
                <p className="font-medium" style={{ color: behavior.huddles.length ? STATE_COLORS[3] : "var(--text-secondary)" }}>
                  {behavior.huddles.length
                    ? tr("Huddles: {n}. Up to {p}% of the birds were in a huddle.", {
                        n: behavior.huddles.length,
                        p: Math.round(behavior.fdi_peak * 100),
                      }) +
                      (behavior.fdi_warning
                        ? " " + tr("That is above the {p}% warning level.", { p: Math.round(behavior.params.fdi_warning * 100) })
                        : "")
                    : result.analyzed_seconds < behavior.params.huddle_seconds
                      ? tr("The clip is shorter than {s} seconds, too short to call a huddle.", { s: behavior.params.huddle_seconds })
                      : tr("No huddles found.")}
                </p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {tr("Test settings: a bird is inactive after {a} seconds without moving, and a huddle is {m} or more touching birds that stay together for {h} seconds. In a real house these times are much longer.", {
                    a: behavior.params.inactive_seconds,
                    m: behavior.params.huddle_min_birds,
                    h: behavior.params.huddle_seconds,
                  })}
                </p>
              </>
            )}
            {result &&
              (weights ? (
                <>
                  <p className="font-medium text-[var(--text-primary)]">
                    {tr("Estimated weights: {n} birds, average {avg} g, from {min} g to {max} g. One bird can be off by about {pct}%.", {
                      n: weights.n,
                      avg: weights.averageG,
                      min: weights.minG,
                      max: weights.maxG,
                      pct: VIDEO_WEIGHT_ERROR_PERCENT,
                    })}
                  </p>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    {tr("Each weight comes from the size of the bird's box, around the standard weight for the grow-out day in Settings. Birds of a different age shift together, and a bird nearer the camera looks heavier, so treat them as a rough guide.")}
                  </p>
                </>
              ) : (
                <p className="text-xs text-[var(--text-tertiary)]">
                  {tr("Too few birds were followed to estimate weights (at least 5 are needed).")}
                </p>
              ))}
            {partly && (
              <p className="text-xs text-[var(--text-tertiary)]">
                {tr("Only the first {seconds} seconds were checked.", { seconds: Math.round(result.analyzed_seconds) })}
              </p>
            )}
            <p className="text-xs text-[var(--text-tertiary)]">
              {tr("The model marks the objects it was trained on ({name}). Other scenes can give false boxes.", { name: className })}
            </p>
          </div>
        )}

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{tr("This video is not ideal")}</AlertDialogTitle>
              <AlertDialogDescription>{tr("It can still be checked, but:")}</AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
              {issues.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <p className="text-sm text-[var(--text-secondary)]">
              {tr("This can take a few minutes on the camera computer. For a quick check, use an MP4 or WebM clip under {mb} MB and {seconds} seconds or shorter.", { mb: DEMO_VIDEO_MAX_MB, seconds: ANALYZED_SECONDS })}
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => inputRef.current?.click()}>{tr("Choose another video")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  acknowledged.current = true;
                  void check();
                }}
              >
                {tr("Use it anyway")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
