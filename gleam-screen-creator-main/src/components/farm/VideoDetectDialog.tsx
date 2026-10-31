import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Film, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ApiError, DEMO_VIDEO_MAX_MB, convertVideo, detectVideo, type VideoDetection } from "@/lib/api-client";
import { T, tr } from "@/lib/i18n";

/* "Test video" on Live Camera: pick a clip from this device, the trained
 * detector (running on the camera computer, see cerebroil-stream/demo_detect.py)
 * checks it, and the clip plays back with the boxes it found drawn over it.
 * Nothing is saved and the live camera is not touched. */

const MAX_BYTES = DEMO_VIDEO_MAX_MB * 1024 * 1024;
const ANALYZED_SECONDS = 30;
/** Box colors by bird state: moving, inactivity (still with the flock), inactive (still while the flock moves), huddling. */
const STATE_COLORS = ["#34d399", "#94a3b8", "#fbbf24", "#60a5fa"];
const STATE_NAMES = [T("Moving"), T("Inactivity"), T("Inactive"), T("Huddling")];
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

export function VideoDetectDialog() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"converting" | "checking" | null>(null);
  const [cutFrom, setCutFrom] = useState<number | null>(null); // size of the original when it was over the limit
  const [needsConvert, setNeedsConvert] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VideoDetection | null>(null);
  // Birds in the frame on screen: [all, inactive, huddling]
  const [inFrame, setInFrame] = useState<[number, number, number]>([0, 0, 0]);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

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
      const scale = w / result.width;
      ctx.lineWidth = 2;
      ctx.font = "12px ui-monospace, monospace";
      let inactive = 0;
      let huddling = 0;
      let huddleLabelId = Infinity; // a huddle is labelled once, on its lowest numbered bird
      for (const b of boxes) {
        if (b[7] === 2) inactive++;
        if (b[7] === 3) {
          huddling++;
          huddleLabelId = Math.min(huddleLabelId, b[6]);
        }
      }
      for (const [x, y, bw, bh, conf, , id, stateCode] of boxes) {
        const state = stateCode ?? 0;
        const color = STATE_COLORS[state] ?? STATE_COLORS[0];
        ctx.strokeStyle = color;
        ctx.lineWidth = state >= 2 ? 3 : 2;
        ctx.strokeRect(x * scale, y * scale, bw * scale, bh * scale);
        // Moving birds only get their number, and a huddle one label, so the picture stays readable.
        let label = "";
        if (state === 0 || id == null) label = `${id != null ? `#${id} ` : ""}${Math.round(conf * 100)}%`;
        else if (state === 3) label = id === huddleLabelId ? `${tr(STATE_NAMES[3])} x${huddling}` : "";
        else label = `#${id} ${tr(STATE_NAMES[state])}`;
        if (!label) continue;
        const tw = ctx.measureText(label).width + 8;
        const ly = Math.max(0, y * scale - 16);
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(x * scale, ly, tw, 16);
        ctx.fillStyle = color;
        ctx.fillText(label, x * scale + 4, ly + 12);
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
    setError(null);
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
      let converted = false;
      const convert = async () => {
        setStage("converting");
        current = await convertVideo(file);
        converted = true;
        setFile(current);
        setNeedsConvert(false);
      };
      if (needsConvert) await convert();
      setStage("checking");
      try {
        setResult(await detectVideo(current));
      } catch (err) {
        // The camera computer may not be able to decode this codec (H.265, VP9, ...): convert once and try again.
        if (converted || !(err instanceof ApiError) || err.message !== "unreadable_video") throw err;
        await convert();
        setStage("checking");
        setResult(await detectVideo(current));
      }
    } catch (err) {
      setError(errorText(err, cutFrom != null));
    } finally {
      setBusy(false);
      setStage(null);
    }
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
            onClick={check}
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

        {cutFrom != null && (
          <p className="text-xs text-[var(--text-tertiary)]">
            {tr("This file is {size} MB. Only the first {mb} MB are used.", { size: Math.round(cutFrom / 1048576), mb: DEMO_VIDEO_MAX_MB })}
          </p>
        )}
        {needsConvert && !busy && !result && (
          <p className="text-xs text-[var(--text-tertiary)]">{tr("This video is converted first so it can play here.")}</p>
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
          <div className="relative overflow-hidden rounded-xl border border-[var(--border-default)] bg-black">
            <video
              ref={videoRef}
              src={url}
              controls
              playsInline
              muted
              className="block max-h-[50vh] w-full"
              onError={() => setNeedsConvert(true)}
            />
            {result && <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-full w-full" />}
          </div>
        )}

        {result && (
          <div className="space-y-1.5 text-sm">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]" aria-label={tr("Colors")}>
              {STATE_NAMES.map((name, i) => (
                <li key={name} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATE_COLORS[i] }} aria-hidden="true" />
                  {tr(name)}
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
                <p className="font-medium" style={{ color: behavior.inactive_birds.length ? STATE_COLORS[2] : "var(--text-secondary)" }}>
                  {behavior.inactive_birds.length
                    ? tr("Inactive: {n} birds stayed still for {s} seconds or more while the rest of the flock moved.", {
                        n: behavior.inactive_birds.length,
                        s: behavior.params.inactive_seconds,
                      })
                    : result.analyzed_seconds < behavior.params.inactive_seconds
                      ? tr("The clip is shorter than {s} seconds, too short to call a bird inactive.", { s: behavior.params.inactive_seconds })
                      : behavior.flock_moving != null && behavior.flock_moving < 0.2
                        ? tr("Most of the flock was still, so no single bird is called inactive.")
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
      </DialogContent>
    </Dialog>
  );
}
