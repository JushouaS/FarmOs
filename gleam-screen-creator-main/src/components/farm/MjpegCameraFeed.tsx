import { useEffect, useRef, useState } from "react";
import { tr } from "@/lib/i18n";

type FeedState = "connecting" | "live" | "reconnecting";

interface Props {
  src: string;
  alt: string;
  className?: string;
  /** Called once when the camera path fails this many times in a row before any picture has arrived (default 2). */
  onUnreachable?: () => void;
  unreachableAfter?: number;
}

function findMarker(bytes: Uint8Array, start: number, marker: number): number {
  for (let i = start; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === marker) return i;
  }
  return -1;
}

export function MjpegCameraFeed({ src, alt, className, onUnreachable, unreachableAfter = 2 }: Props) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<FeedState>("connecting");
  const [hasFrame, setHasFrame] = useState(false);
  // Kept in a ref so a new callback from the page does not restart the connection.
  const unreachableRef = useRef(onUnreachable);
  unreachableRef.current = onUnreachable;

  useEffect(() => {
    let stopped = false;
    let lastFrameUrl: string | null = null;
    let lastPaintAt = 0;
    let retryCount = 0;
    let failuresBeforeFirstFrame = 0;
    let reported = false;
    let activeController: AbortController | null = null;
    const objectUrls = new Set<string>();
    const revokeTimers = new Set<number>();

    const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    const connect = async () => {
      while (!stopped) {
        activeController = new AbortController();
        let idleWatchdog: number | null = null;
        try {
          const response = await fetch(src, {
            credentials: "include",
            cache: "no-store",
            signal: activeController.signal,
          });
          if (!response.ok) throw new Error(`Camera stream returned HTTP ${response.status}`);
          if (!response.body) throw new Error("Camera stream did not provide a response body");

          setState(lastFrameUrl ? "reconnecting" : "connecting");
          const reader = response.body.getReader();
          let buffer = new Uint8Array(0);
          let lastDataAt = performance.now();
          idleWatchdog = window.setInterval(() => {
            if (performance.now() - lastDataAt > 10_000) activeController?.abort();
          }, 2_000);

          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) throw new Error("Camera stream ended");
            lastDataAt = performance.now();

            const combined = new Uint8Array(buffer.length + value.length);
            combined.set(buffer);
            combined.set(value, buffer.length);
            buffer = combined;

            while (true) {
              const start = findMarker(buffer, 0, 0xd8);
              if (start < 0) {
                buffer = buffer.slice(Math.max(0, buffer.length - 1));
                break;
              }
              const end = findMarker(buffer, start + 2, 0xd9);
              if (end < 0) {
                if (start > 0) buffer = buffer.slice(start);
                break;
              }

              const frame = buffer.slice(start, end + 2);
              buffer = buffer.slice(end + 2);
              const now = performance.now();
              if (now - lastPaintAt < 100) continue;

              lastPaintAt = now;
              retryCount = 0;
              const url = URL.createObjectURL(new Blob([frame], { type: "image/jpeg" }));
              objectUrls.add(url);
              const previousUrl = lastFrameUrl;
              lastFrameUrl = url;
              if (imageRef.current) imageRef.current.src = url;
              setState("live");
              setHasFrame(true);

              if (previousUrl) {
                const timer = window.setTimeout(() => {
                  URL.revokeObjectURL(previousUrl);
                  objectUrls.delete(previousUrl);
                  revokeTimers.delete(timer);
                }, 2_000);
                revokeTimers.add(timer);
              }
            }
          }
        } catch {
          if (stopped) break;
          setState(lastFrameUrl ? "reconnecting" : "connecting");
          // Nothing has ever arrived and the camera path keeps failing: let the page say so instead of spinning.
          if (!lastFrameUrl && !reported && ++failuresBeforeFirstFrame >= unreachableAfter && unreachableRef.current) {
            reported = true;
            unreachableRef.current();
          }
          await sleep(Math.min(1_000 * 2 ** retryCount, 8_000));
          retryCount = Math.min(retryCount + 1, 3);
        } finally {
          if (idleWatchdog !== null) window.clearInterval(idleWatchdog);
          activeController = null;
        }
      }
    };

    void connect();
    return () => {
      stopped = true;
      activeController?.abort();
      for (const timer of revokeTimers) window.clearTimeout(timer);
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [src, unreachableAfter]);

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black">
      {/* Hidden until the first picture arrives, so an empty image never shows the browser's broken-image icon. */}
      <img ref={imageRef} alt={alt} className={className} style={hasFrame ? undefined : { visibility: "hidden" }} />
      {state !== "live" && (
        <div className="absolute inset-x-0 bottom-3 text-center text-xs text-white/80" role="status">
          {state === "connecting" ? tr("Connecting to camera…") : tr("Camera stream interrupted; reconnecting…")}
        </div>
      )}
    </div>
  );
}
