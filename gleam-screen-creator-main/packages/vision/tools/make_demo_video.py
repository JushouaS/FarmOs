"""
Make a defence demo from a recording: the real "Follow every bird" scan, with its own decisions drawn on every
sampled frame, played back sped up. Nothing is drawn by hand; what is on screen is what the system decided.

    cd packages/vision
    python tools/make_demo_video.py --source "Day_12.mkv" --out ../../defense-demo/day12

Writes, in --out:
  <name>_demo.mp4      every sampled frame (one every --interval s of video) with bird numbers, huddle outlines,
                       inactive birds in violet, and a banner with the video time; --fps frames per second, so
                       the default (2 s samples, 15 fps) runs at 30x
  <name>_frames.csv    one row per sampled frame (the same CSV the website's "Download frames (CSV)" gives)
  <name>_summary.json  the scan summary (counts, huddling share, inactive birds and when, settings, klydel commit)
  <name>_highlights.txt the moments worth showing: first huddle, longest huddle stretch, each inactive bird,
                       with both the video time and the time in the demo video
  <name>_tracks_mot.txt the tracks in MOTChallenge format, for tools/track_clip.py score

Feeder zones: --zones takes klydel's configs/feeding_zones.json ({"ref_size": [w, h], "zones": [[x1, y1, x2, y2]]})
or a JSON list of polygons with points in 0..1 (what Settings saves). Without it no zone is used.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import clip_scan  # noqa: E402
from detector import Detector  # noqa: E402

LEGEND = "green = bird (number kept over time)   amber = given back after a miss   violet = inactive 30+ min   " \
         "red = huddle   grey + = seen, huddling only"


def load_zones(path: str | None, w: int, h: int) -> list:
    if not path:
        return []
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict) and "zones" in data:
        rw, rh = data.get("ref_size", [w, h])
        return [[[x1 / rw, y1 / rh], [x2 / rw, y1 / rh], [x2 / rw, y2 / rh], [x1 / rw, y2 / rh]]
                for x1, y1, x2, y2 in data["zones"]]
    return data


def ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return "ffmpeg"


def mmss(t: float) -> str:
    return f"{int(t // 60)}:{int(t % 60):02d}"


def caption(frame: np.ndarray, speed: float, zones_px: list) -> np.ndarray:
    """Zone outlines and a bottom strip with the legend and the playback speed."""
    out = frame
    for poly in zones_px:
        cv2.polylines(out, [np.array(poly, np.int32)], True, (230, 200, 60), 1, cv2.LINE_AA)
    h, w = out.shape[:2]
    scale = max(0.4, min(1.0, w / 1600))
    strip = int(30 * scale) + 6
    shade = out[h - strip:].copy()
    cv2.rectangle(shade, (0, 0), (w, strip), (20, 20, 20), -1)
    out[h - strip:] = cv2.addWeighted(shade, 0.75, out[h - strip:], 0.25, 0)
    text = f"{speed:g}x   system output, not edited   " + LEGEND + "   blue = feeder zone"
    cv2.putText(out, text, (8, h - strip // 2 + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.38 * scale * 1.3, (235, 235, 235), 1,
                cv2.LINE_AA)
    return out


def start_clock(given: str | None, stem: str) -> float | None:
    """Seconds since midnight at the start of the recording, from --start-clock or a name like Day_12_..._0600_to_0700."""
    import re
    m = re.match(r"^(\d{1,2}):?(\d{2})$", given) if given else re.search(r"_(\d{2})(\d{2})_to_\d{4}", stem)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 if m else None


def stamp(frame: np.ndarray, seconds: float) -> None:
    """The wall-clock time, top right."""
    s = int(seconds) % 86400
    text = f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"
    scale = max(0.5, min(1.2, frame.shape[1] / 1600))
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.7 * scale, 2)
    cv2.putText(frame, text, (frame.shape[1] - tw - 12, th + 12), cv2.FONT_HERSHEY_SIMPLEX, 0.7 * scale,
                (245, 245, 245), 2, cv2.LINE_AA)


def callout(frame: np.ndarray, text: str) -> None:
    """A large violet caption in the lower third."""
    h, w = frame.shape[:2]
    scale = max(0.6, min(1.4, w / 1100))
    (tw, th), base = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 2)
    x, y = max(10, (w - tw) // 2), int(h * 0.80)
    cv2.rectangle(frame, (x - 14, y - th - 14), (x + tw + 14, y + base + 10), (150, 60, 120), -1)
    cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), 2, cv2.LINE_AA)


def title_card(w: int, h: int, lines: list[str]) -> np.ndarray:
    card = np.full((h, w, 3), 24, np.uint8)
    scale = max(0.45, min(1.0, w / 1700))
    y = int(h * 0.28)
    for i, line in enumerate(lines):
        size = scale * (1.2 if i == 0 else 0.8)
        weight = 2 if i == 0 else 1
        (tw, th), _ = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, size, weight)
        cv2.putText(card, line, (max(10, (w - tw) // 2), y), cv2.FONT_HERSHEY_SIMPLEX, size,
                    (240, 240, 240) if i == 0 else (205, 205, 205), weight, cv2.LINE_AA)
        y += int(th * 2.6)
    return card


def highlights(samples, demo_at: dict[int, float], window_s: float) -> list[str]:
    demo_t = lambda s: demo_at.get(s.frame_no, 0.0)  # noqa: E731
    lines = []
    judged = [s for s in samples if s.judged]
    first_h = next((s for s in judged if s.huddles), None)
    if first_h:
        lines.append(f"first huddle: video {mmss(first_h.t)}  (demo {mmss(demo_t(first_h))}), "
                     f"{len(first_h.huddles)} group(s), birds " + "; ".join(",".join(map(str, i)) for i, _ in first_h.huddles))
    run = best = None
    for s in judged:
        if s.huddles:
            run = run or s
            if best is None or s.t - run.t > best[1].t - best[0].t:
                best = (run, s)
        else:
            run = None
    if best:
        a, b = best
        lines.append(f"longest unbroken huddling: video {mmss(a.t)}-{mmss(b.t)} ({(b.t - a.t) / 60:.1f} min)  "
                     f"(demo {mmss(demo_t(a))}-{mmss(demo_t(b))})")
    spans: dict[int, list] = {}
    for s in judged:
        for bid in s.inactive or []:
            sp = spans.setdefault(bid, [s, s])
            sp[1] = s
    for bid, (a, b) in sorted(spans.items(), key=lambda kv: kv[1][0].t):
        lines.append(f"bird {bid} inactive (stayed within half a body length for {window_s / 60:g}+ min): video "
                     f"{mmss(a.t)}-{mmss(b.t)}  (demo {mmss(demo_t(a))}-{mmss(demo_t(b))})")
    if not spans:
        lines.append(f"no bird was inactive for {window_s / 60:g} min in this recording")
    gaps = [s for s in samples if s.status == clip_scan.GAP]
    if gaps:
        lines.append(f"untrusted stretches (frozen/skipped/unreadable): {len(gaps)} samples, first at video {mmss(gaps[0].t)}")
    return lines


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    ap.add_argument("--source", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--name", default=None)
    ap.add_argument("--zones", default=None)
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--fps", type=float, default=15.0, help="demo video frame rate (default 15: 2 s samples at 30x)")
    ap.add_argument("--max-minutes", type=float, default=None, help="only the first N minutes of the recording")
    ap.add_argument("--hold", type=float, default=1.0,
                    help="seconds each picture with an inactive bird stays on screen (default 1), so it can be seen")
    ap.add_argument("--start-clock", default=None,
                    help="wall-clock time at the start, HH:MM (default: read from a name like ..._0600_to_0700)")
    args = ap.parse_args()

    src = Path(args.source)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    name = args.name or src.stem
    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        raise SystemExit(f"cannot open {src}")
    vfps, n_frames = cap.get(cv2.CAP_PROP_FPS), cap.get(cv2.CAP_PROP_FRAME_COUNT)
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    duration = n_frames / vfps if vfps else 0
    if args.max_minutes:
        duration = min(duration, args.max_minutes * 60)
    zones = load_zones(args.zones, w, h)
    zones_px = [[(x * w, y * h) for x, y in poly] for poly in zones]

    detector = Detector()
    if not detector.available:
        raise SystemExit(f"no detector: {detector.load_error}")
    settings = clip_scan.ScanSettings.from_env().with_overrides(interval=args.interval)
    detect = clip_scan.detector_fn(detector, settings)

    def frames():
        for t, n, img in clip_scan.sample_frames(str(src), args.interval):
            if args.max_minutes and t > args.max_minutes * 60:
                return
            yield t, n, img

    clip = SimpleNamespace(id="demo", name=name, path=str(src), duration=duration)
    job = clip_scan.ScanJob(clip, settings, zones, f"file:{Path(args.zones).name}" if args.zones else "none")
    started = time.time()
    print(f"scanning {src.name}: {w}x{h}, {vfps:g} fps, {duration / 60:.1f} min, one sample every {args.interval:g} s, "
          f"{len(zones)} zones", flush=True)
    job.run(detect, frames=frames())
    if job.status != "done":
        raise SystemExit(f"scan {job.status}: {job.error}")
    samples = job.snapshot()
    print(f"scan done in {time.time() - started:.0f} s: {len(samples)} samples", flush=True)

    summary = job.summary()
    (out / f"{name}_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    (out / f"{name}_frames.csv").write_text(job.samples_csv(), encoding="utf-8")
    (out / f"{name}_tracks_mot.txt").write_text(job.mot_text(), encoding="utf-8")
    by_no = {s.frame_no: s for s in samples if s.frame_no is not None}
    speed = args.interval * args.fps
    mp4 = out / f"{name}_demo.mp4"
    cmd = [ffmpeg_exe(), "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
           "-r", f"{args.fps:g}", "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "23",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(mp4)]
    enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    clock0 = start_clock(args.start_clock, src.stem)
    card = title_card(w, h, [
        f"{name.upper()}  -  {src.name}",
        "Follow every bird: ByteTrack + stable bird numbers (5-minute refind) + klydel's rules (a365f3d)",
        f"One picture every {args.interval:g} s of video, played at {speed:g}x. Pictures with an inactive bird are held.",
        "Inactive = a bird stayed within half a body length for 30 minutes.",
        "Huddle = 3+ birds touching, every pair within one body length, not mostly in a feeder zone (blue).",
        "Nothing is edited: every box, number and verdict is the system's own output.",
    ])
    written = int(args.fps * 4)
    for _ in range(written):
        enc.stdin.write(card.tobytes())
    demo_at: dict[int, float] = {}
    for t, n, img in frames():
        s = by_no.get(n)
        if img is None:
            img = np.zeros((h, w, 3), np.uint8)
        frame = clip_scan.annotate(img, s) if s is not None else img
        frame = caption(frame, speed, zones_px)
        if clock0 is not None:
            stamp(frame, clock0 + t)
        repeat = 1
        if s is not None and s.inactive:
            callout(frame, f"Bird {', '.join(map(str, s.inactive))}: still for 30+ minutes (inactive)")
            repeat = max(1, int(round(args.hold * args.fps)))
        demo_at.setdefault(n, written / args.fps)
        data = frame.tobytes()
        for _ in range(repeat):
            enc.stdin.write(data)
        written += repeat
    enc.stdin.close()
    if enc.wait() != 0:
        raise SystemExit("ffmpeg failed")
    hl = highlights(samples, demo_at, settings.inactivity_window_s)
    (out / f"{name}_highlights.txt").write_text("\n".join(hl) + "\n", encoding="utf-8")
    print(f"demo video: {mp4} ({written} frames, {written / args.fps / 60:.1f} min at {speed:g}x, "
          f"{mp4.stat().st_size / 1e6:.0f} MB)")
    for line in hl:
        print("  " + line)


if __name__ == "__main__":
    main()
