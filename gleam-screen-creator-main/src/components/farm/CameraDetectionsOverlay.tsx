import { useEffect, useRef, useState } from "react";
import { fetchLiveDetections, type LiveDetectionSnapshot } from "@/lib/api-client";
import { tr } from "@/lib/i18n";

type Status = "loading" | "ready" | "unavailable";

const POLL_INTERVAL_MS = 4_000;

export function CameraDetectionsOverlay({ cameraId }: { cameraId: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState<LiveDetectionSnapshot | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setViewport({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    const poll = async () => {
      controller = new AbortController();
      try {
        const result = await fetchLiveDetections(cameraId, controller.signal);
        if (!stopped) {
          setSnapshot(result);
          setStatus("ready");
        }
      } catch {
        if (!stopped) {
          setSnapshot(null);
          setStatus("unavailable");
        }
      } finally {
        controller = null;
        if (!stopped) timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [cameraId]);

  const [frameWidth, frameHeight] = snapshot?.metrics.resolution ?? [0, 0];
  const scale =
    frameWidth > 0 && frameHeight > 0 && viewport.width > 0 && viewport.height > 0
      ? Math.min(viewport.width / frameWidth, viewport.height / frameHeight)
      : 0;
  const imageWidth = frameWidth * scale;
  const imageHeight = frameHeight * scale;
  const offsetX = (viewport.width - imageWidth) / 2;
  const offsetY = (viewport.height - imageHeight) / 2;
  const label =
    status === "loading"
      ? tr("Detecting chickens…")
      : status === "unavailable" || !snapshot?.model_loaded
        ? tr("Detector unavailable")
        : snapshot.detection_count === 0
          ? tr("No chickens detected")
          : tr("{n} chickens detected", { n: snapshot.detection_count });

  return (
    <div ref={viewportRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <div
        role="status"
        aria-live="polite"
        className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white shadow"
      >
        {label}
      </div>
      {status === "ready" &&
        snapshot?.model_loaded &&
        scale > 0 &&
        snapshot.detections.map((detection, index) => (
          <div
            key={`${index}-${detection.box_x}-${detection.box_y}`}
            aria-hidden="true"
            className="absolute rounded-sm border-2 border-lime-400 shadow-[0_0_6px_rgba(163,230,53,0.8)]"
            style={{
              left: offsetX + detection.box_x * scale,
              top: offsetY + detection.box_y * scale,
              width: detection.box_w * scale,
              height: detection.box_h * scale,
            }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded-t bg-lime-400 px-1 text-[10px] font-bold leading-4 text-black">
              {`Chicken ${Math.round((detection.confidence ?? 0) * 100)}%`}
            </span>
          </div>
        ))}
    </div>
  );
}
