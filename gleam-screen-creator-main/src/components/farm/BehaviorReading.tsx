import { useEffect, useState } from "react";
import { getBehavior, type BehaviorReport } from "@/lib/api-client";
import { tr } from "@/lib/i18n";

/**
 * The last real reading from the camera, under the behaviour breakdown.
 *
 * The breakdown above is a model of the whole house; this line is what the
 * camera actually saw. They are kept apart on purpose, because their
 * denominators differ: 4,200 birds live in the house, but only the ones
 * standing in this camera's view are counted here. Mixing the two would
 * produce a percentage that means nothing.
 *
 * Every number shown is traceable: how many birds, how many of them still,
 * how many in a huddle, and how many were standing at a feeder and therefore
 * left out of the huddle count. If the reading could not be trusted — dark
 * picture, camera moved, no model — it says that instead of showing zeros,
 * because "0 birds inactive" and "we could not see" are very different news.
 */
export function BehaviorReading({ cameraId = "CAM-01" }: { cameraId?: string }) {
  const [report, setReport] = useState<BehaviorReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getBehavior(cameraId)
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [cameraId]);

  if (failed) {
    return (
      <p className="mt-3 border-t border-[var(--border-subtle)] pt-2.5 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
        {tr("No camera reading available.")}
      </p>
    );
  }

  if (!report) {
    return (
      <p className="mt-3 border-t border-[var(--border-subtle)] pt-2.5 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
        {tr("Loading the last camera reading…")}
      </p>
    );
  }

  const latest = report.latest;
  if (!latest) {
    return (
      <p className="mt-3 border-t border-[var(--border-subtle)] pt-2.5 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
        {tr("The camera has not taken a reading yet.")}
      </p>
    );
  }

  const at = new Date(latest.at);
  const when = Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  // Withheld readings get one plain sentence rather than a row of zeros.
  const withheld = !latest.reliable || latest.movement_status === "unknown";

  return (
    <div className="mt-3 border-t border-[var(--border-subtle)] pt-2.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
          {tr("Camera reading")}
        </span>
        <span className="font-mono tabular-nums">{when}</span>
      </div>

      {withheld ? (
        <p className="mt-1">{tr("Nothing could be judged from this reading — the picture was too dark or unclear.")}</p>
      ) : latest.suppressed ? (
        <p className="mt-1">
          {tr("Sleeping — night hours, so inactivity and crowding are not flagged.")}
        </p>
      ) : (
        <p className="mt-1">
          {latest.movement_label === "Inactive"
            ? tr("{n} of {total} birds were still.", {
                n: latest.inactive_count ?? 0,
                total: latest.bird_count ?? 0,
              })
            : tr("{total} birds seen, moving normally.", { total: latest.bird_count ?? 0 })}
          {(latest.huddled_count ?? 0) > 0 &&
            " " +
              tr("{n} packed together.", { n: latest.huddled_count ?? 0 })}
          {(latest.zone_count ?? 0) > 0 &&
            " " +
              tr("{n} at feeders, not counted as crowding.", { n: latest.zone_count ?? 0 })}
        </p>
      )}

      {(report.sustained.inactivity || report.sustained.huddling) && (
        <p className="mt-1 font-semibold" style={{ color: "var(--status-red-text)" }}>
          {report.sustained.inactivity && tr("Inactivity has lasted several readings.")}
          {report.sustained.inactivity && report.sustained.huddling && " "}
          {report.sustained.huddling && tr("Crowding has lasted several readings.")}
        </p>
      )}
      <p className="mt-1" style={{ color: "var(--text-tertiary)" }}>
        {tr("Times are in {tz}.", { tz: report.timezone })}
      </p>
    </div>
  );
}
