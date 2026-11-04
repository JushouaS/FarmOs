import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { fetchKinectChickens, fetchKinectTicket, type KinectChickens } from "@/lib/api-client";
import { tr } from "@/lib/i18n";

/* Live view of the Kinect: the normal colour picture, or the depth as a 3D view.
 *
 * The browser cannot reach the Kinect, so the kinect-bridge program on the
 * farm PC streams it over a WebSocket (see kinect-bridge/). The page tells the
 * bridge which one it wants ("color" or "depth"), so only that one is sent.
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

type Mode = "picture" | "depth";
const MODE_KEY = "cb-kinect-view";
const want = (m: Mode) => JSON.stringify({ want: m === "picture" ? "color" : "depth" });
/** The view this viewer used last time, or the picture. */
function savedMode(): Mode {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(MODE_KEY) === "depth" ? "depth" : "picture";
  } catch {
    return "picture";
  }
}

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

export function KinectDepthView({ fallback, onFlock }: { fallback: ReactNode; onFlock?: (flock: KinectChickens | null) => void }) {
  // The page that holds this view can show the weights too (Weight Classification), without asking the finder twice.
  const onFlockRef = useRef(onFlock);
  onFlockRef.current = onFlock;
  const [live, setLive] = useState(false);
  const [fps, setFps] = useState(0);
  const [turned, setTurned] = useState(false);
  const [mode, setMode] = useState<Mode>(savedMode);
  const modeRef = useRef<Mode>(mode);
  const wsRef = useRef<WebSocket | null>(null);
  const [chickens, setChickens] = useState<KinectChickens | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const urlRef = useRef<string | null>(null);
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

    const connect = async () => {
      // The bridge may want a ticket, which the API gives to signed-in viewers.
      let ticket: string | null = null;
      try {
        ticket = await fetchKinectTicket();
      } catch {
        /* not reachable right now: try without, and the retry below tries again */
      }
      if (closed) return;
      const query = ticket ? `?t=${encodeURIComponent(ticket)}` : "";
      // On a public https address the browser needs a secure connection, which the public gateway passes on to the bridge.
      const address =
        window.location.protocol === "https:"
          ? `wss://${window.location.host}/kinect/${query}`
          : `ws://${window.location.hostname}:${BRIDGE_PORT}/${query}`;
      const socket = new WebSocket(address);
      ws = socket;
      wsRef.current = socket;
      socket.binaryType = "arraybuffer";
      // The bridge sends depth until told otherwise.
      socket.onopen = () => socket.send(want(modeRef.current));
      socket.onmessage = (e) => {
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
        // A picture is a JPEG, which starts FF D8; a depth frame never does.
        const first = new Uint8Array(buf, 0, 2);
        if (first[0] === 0xff && first[1] === 0xd8) {
          if (modeRef.current !== "picture") return;
          const url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
          const img = imgRef.current;
          const old = urlRef.current;
          if (img) {
            img.src = url;
            urlRef.current = url;
            if (old) URL.revokeObjectURL(old);
          } else {
            URL.revokeObjectURL(url);
          }
          count++;
          setLive(true);
          return;
        }
        if (modeRef.current !== "depth") return;
        const head = new DataView(buf);
        const width = head.getUint16(0, true);
        const height = head.getUint16(2, true);
        if (buf.byteLength < 8 + width * height * 2) return;
        frameRef.current = { width, height, depth: new Uint16Array(buf, 8, width * height) };
        dirtyRef.current = true;
        count++;
        setLive(true);
      };
      socket.onclose = () => {
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
      wsRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, []);

  // On the picture, ask for the chicken outlines every second or two. Asking is also what keeps the
  // finder working, so it stops when the page is on the depth view or closed.
  useEffect(() => {
    if (!live || mode !== "picture") {
      setChickens(null);
      onFlockRef.current?.(null);
      return;
    }
    let stop = false;
    let timer: number | undefined;
    const ask = async () => {
      const answer = await fetchKinectChickens();
      if (stop) return;
      setChickens(answer);
      onFlockRef.current?.(answer);
      timer = window.setTimeout(ask, 1500);
    };
    void ask();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [live, mode]);

  // Choosing the other view: tell the bridge, and remember the choice.
  useEffect(() => {
    modeRef.current = mode;
    frameRef.current = null;
    dirtyRef.current = true;
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* private window: it just starts on the picture next time */
    }
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(want(mode));
  }, [mode]);

  // Draw the newest frame whenever it or the view changes.
  useEffect(() => {
    if (!live || mode !== "depth") return;
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
  }, [live, mode]);

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
      {mode === "depth" ? (
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
      ) : (
        <>
          <img ref={imgRef} alt={tr("Live picture from the Kinect.")} className="absolute inset-0 h-full w-full object-contain" />
          {/* The outlines, in the same shape as the picture so they sit exactly on the birds */}
          {chickens?.ok && chickens.birds && chickens.width && chickens.height && Date.now() / 1000 - (chickens.at ?? 0) < 10 && (
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${chickens.width} ${chickens.height}`}
              preserveAspectRatio="xMidYMid meet"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              {chickens.birds.map((b, i) => (
                <polygon
                  key={i}
                  points={b.polygon.map(([x, y]) => `${(x * chickens.width!).toFixed(1)},${(y * chickens.height!).toFixed(1)}`).join(" ")}
                  fill="rgba(52, 211, 153, 0.18)"
                  stroke="#34d399"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {/* Each bird's estimated weight, at the middle of its outline */}
              {chickens.birds.map((b, i) =>
                b.weightG != null && b.polygon.length > 0 ? (
                  <text
                    key={`w${i}`}
                    x={(b.polygon.reduce((n, p) => n + p[0], 0) / b.polygon.length) * chickens.width!}
                    y={(b.polygon.reduce((n, p) => n + p[1], 0) / b.polygon.length) * chickens.height!}
                    fontSize={chickens.height! * 0.032}
                    fontWeight="600"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#fff"
                    stroke="#000"
                    strokeWidth={chickens.height! * 0.008}
                    paintOrder="stroke"
                  >
                    {b.weightG} g
                  </text>
                ) : null,
              )}
            </svg>
          )}
        </>
      )}
      <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded bg-black/75 px-2 py-1 font-mono text-xs text-[var(--brand)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
        {mode === "picture" ? tr("Live picture") : tr("Live 3D depth")} · {fps} fps
      </div>
      <div
        role="group"
        aria-label={tr("Kinect view")}
        className="absolute right-2 top-2 flex overflow-hidden rounded-md border border-white/15 bg-black/75 text-xs font-medium"
      >
        {(["picture", "depth"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className="tap px-2.5 py-1 transition-colors"
            style={mode === m ? { background: "var(--brand)", color: "var(--text-inverse)" } : { color: "rgba(255,255,255,0.8)" }}
          >
            {m === "picture" ? tr("Picture") : tr("Depth 3D")}
          </button>
        ))}
      </div>
      {mode === "picture" && chickens && (
        <p
          role="status"
          className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/75 px-2 py-1 text-xs text-white/85"
        >
          {chickens.ok && chickens.count != null
            ? chickens.weight
              ? chickens.count === 1
                ? tr("1 chicken found · about {g} g", { g: chickens.weight.meanG })
                : tr("{n} chickens found · average about {g} g", { n: chickens.count, g: chickens.weight.meanG })
              : chickens.count === 1
                ? tr("1 chicken found")
                : tr("{n} chickens found", { n: chickens.count })
            : chickens.status === "not_running" || chickens.status === "bridge_unreachable" || chickens.status === "model_not_installed"
              ? tr("Chicken finder is not running")
              : tr("Looking for chickens…")}
          {chickens.ok && chickens.weight && (
            <span className="block text-[11px] text-white/60">
              {tr("Rough estimate: one bird can be off by about {pct}%", { pct: chickens.weight.errorPercent })}
            </span>
          )}
        </p>
      )}
      {mode === "depth" && (
        <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs text-white/60">
          {tr("Drag to turn the view")}
        </p>
      )}
      {mode === "depth" && turned && (
        <button
          type="button"
          onClick={reset}
          className="tap absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 text-xs font-medium text-white/80 hover:text-white"
        >
          {tr("Reset view")}
        </button>
      )}
    </>
  );
}
