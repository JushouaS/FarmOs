import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { tr } from "@/lib/i18n";

/* Live 3D view of the Kinect depth camera.
 *
 * The browser cannot reach the Kinect, so the kinect-bridge program on the
 * farm PC streams the depth frames over a WebSocket (see kinect-bridge/).
 * While the bridge is not running this shows `fallback` (the camera service's
 * video feed) and keeps retrying, so the page works with or without the
 * sensor. The frames are drawn as a point cloud on a plain 2D canvas, so
 * there is no 3D library to load: each depth pixel becomes a point in space,
 * is turned by the viewer's drag, and is projected back to the screen. */

const BRIDGE_PORT = 8181;
const RETRY_MS = 4000;
const TURN_PER_PX = 0.006;
const TURN_PER_KEY = 0.08;
const MAX_PITCH = 1.2;

type Intrinsics = {
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  minMm: number;
  maxMm: number;
};
type Frame = { width: number; height: number; depth: Uint16Array };

/* near = yellow, middle = green, far = blue, packed as ABGR for a Uint32Array view of ImageData. */
const PALETTE = (() => {
  const stops = [
    [253, 224, 71],
    [52, 211, 153],
    [59, 130, 246],
  ];
  const out = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (stops.length - 1);
    const a = stops[Math.min(Math.floor(t), stops.length - 2)];
    const b = stops[Math.min(Math.floor(t), stops.length - 2) + 1];
    const f = t - Math.min(Math.floor(t), stops.length - 2);
    const [r, g, bl] = [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f));
    out[i] = (255 << 24) | (bl << 16) | (g << 8) | r;
  }
  return out;
})();

export function KinectDepthView({ fallback }: { fallback: ReactNode }) {
  const [live, setLive] = useState(false);
  const [fps, setFps] = useState(0);
  const [turned, setTurned] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intrinsicsRef = useRef<Intrinsics | null>(null);
  const frameRef = useRef<Frame | null>(null);
  const viewRef = useRef({ yaw: 0, pitch: 0 });
  const dirtyRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // Connect to the bridge, and reconnect while the page is open.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    let closed = false;
    let count = 0;

    const connect = () => {
      ws = new WebSocket(`ws://${window.location.hostname}:${BRIDGE_PORT}`);
      ws.binaryType = "arraybuffer";
      ws.onmessage = (e) => {
        if (typeof e.data === "string") {
          try {
            const hello = JSON.parse(e.data);
            if (hello.type === "hello") intrinsicsRef.current = hello;
          } catch {
            /* ignore a message that is not JSON */
          }
          return;
        }
        const buf = e.data as ArrayBuffer;
        if (buf.byteLength < 8) return;
        const head = new DataView(buf);
        const width = head.getUint16(0, true);
        const height = head.getUint16(2, true);
        if (buf.byteLength < 8 + width * height * 2) return;
        frameRef.current = { width, height, depth: new Uint16Array(buf, 8, width * height) };
        dirtyRef.current = true;
        count++;
        setLive(true);
      };
      ws.onclose = () => {
        frameRef.current = null;
        setLive(false);
        if (!closed) retry = window.setTimeout(connect, RETRY_MS);
      };
    };

    connect();
    const meter = window.setInterval(() => {
      setFps(count);
      count = 0;
    }, 1000);
    return () => {
      closed = true;
      window.clearTimeout(retry);
      window.clearInterval(meter);
      ws?.close();
    };
  }, []);

  // Draw the newest frame whenever it or the view changes.
  useEffect(() => {
    if (!live) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let image: ImageData | null = null;
    let zbuf: Float32Array | null = null;
    let pivot = 1500; // the point the view turns around, kept near the middle of the scene
    let raf = 0;

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        image = null;
        dirtyRef.current = true;
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    fit();

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const frame = frameRef.current;
      const k = intrinsicsRef.current;
      if (!dirtyRef.current || !frame || !k) return;
      dirtyRef.current = false;

      const W = canvas.width;
      const H = canvas.height;
      if (!image || !zbuf) {
        image = ctx.createImageData(W, H);
        zbuf = new Float32Array(W * H);
      }
      const px = new Uint32Array(image.data.buffer);
      px.fill(0xff000000);
      zbuf.fill(Infinity);

      const depth = frame.depth;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < depth.length; i += 7) {
        if (depth[i]) {
          sum += depth[i];
          n++;
        }
      }
      if (n) pivot += (sum / n - pivot) * 0.1;

      const { yaw, pitch } = viewRef.current;
      const cyaw = Math.cos(yaw);
      const syaw = Math.sin(yaw);
      const cpit = Math.cos(pitch);
      const spit = Math.sin(pitch);
      const scale = Math.min(W / frame.width, H / frame.height);
      const f = k.fx * scale;
      // Turned away from the sensor the points spread apart, so each one is drawn a pixel larger.
      const size = Math.max(1, Math.ceil(scale)) + (yaw || pitch ? 1 : 0);
      const span = k.maxMm - k.minMm;

      for (let v = 0; v < frame.height; v++) {
        for (let u = 0; u < frame.width; u++) {
          const z = depth[v * frame.width + u];
          if (!z) continue;
          const X = ((u - k.cx) * z) / k.fx;
          const Y = (-(v - k.cy) * z) / k.fy;
          const rz = z - pivot;
          const x1 = X * cyaw + rz * syaw;
          const z1 = -X * syaw + rz * cyaw;
          const y2 = Y * cpit - z1 * spit;
          const z2 = Y * spit + z1 * cpit;
          const w = z2 + pivot;
          if (w < 100) continue;
          const sx = Math.round(W / 2 + (f * x1) / w);
          const sy = Math.round(H / 2 - (f * y2) / w);
          const shade = PALETTE[Math.max(0, Math.min(255, (((z - k.minMm) / span) * 255) | 0))];
          for (let dy = 0; dy < size; dy++) {
            const row = sy + dy;
            if (row < 0 || row >= H) continue;
            for (let dx = 0; dx < size; dx++) {
              const col = sx + dx;
              if (col < 0 || col >= W) continue;
              const at = row * W + col;
              if (w < zbuf[at]) {
                zbuf[at] = w;
                px[at] = shade;
              }
            }
          }
        }
      }
      ctx.putImageData(image, 0, 0);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [live]);

  const turn = (dYaw: number, dPitch: number) => {
    const view = viewRef.current;
    view.yaw += dYaw;
    view.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, view.pitch + dPitch));
    dirtyRef.current = true;
    setTurned(true);
  };
  const reset = () => {
    viewRef.current = { yaw: 0, pitch: 0 };
    dirtyRef.current = true;
    setTurned(false);
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const from = dragRef.current;
    if (!from) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    turn((e.clientX - from.x) * TURN_PER_PX, (e.clientY - from.y) * TURN_PER_PX);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-TURN_PER_KEY, 0],
      ArrowRight: [TURN_PER_KEY, 0],
      ArrowUp: [0, -TURN_PER_KEY],
      ArrowDown: [0, TURN_PER_KEY],
    };
    const s = step[e.key];
    if (!s) return;
    e.preventDefault();
    turn(s[0], s[1]);
  };

  if (!live) return <>{fallback}</>;

  return (
    <>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={tr("Live 3D depth view from the Kinect. Drag or use the arrow keys to turn it.")}
        className="absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--brand)]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (dragRef.current = null)}
        onPointerCancel={() => (dragRef.current = null)}
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
      />
      <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded bg-black/75 px-2 py-1 font-mono text-[10px] text-[var(--brand)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
        {tr("Live 3D depth")} · {fps} fps
      </div>
      <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[10px] text-white/60">
        {tr("Drag to turn the view")}
      </p>
      {turned && (
        <button
          type="button"
          onClick={reset}
          className="tap absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 text-[10px] font-medium text-white/80 hover:text-white"
        >
          {tr("Reset view")}
        </button>
      )}
    </>
  );
}
