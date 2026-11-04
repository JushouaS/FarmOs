import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  ApiError,
  fetchVisionCameras,
  saveCameraSource,
  testCameraSource,
  type CameraSource,
} from "@/lib/api-client";
import { Block, Hint, MonoVal, NOT_ALLOWED, Row, SaveRow, Section, useSaver } from "./SettingsParts";
import { localeTag, tr } from "@/lib/i18n";

/* The camera's RTSP link: the one input this system used to need a hand-edited
 * .env for, and a container restart after every change.
 *
 * Saving it here is enough. Both services that open the camera —
 * cerebroil-stream (the page you watch) and packages/vision (the analysis) —
 * re-read it every few seconds and reopen the camera, so the picture comes back
 * on its own. The password stays on the server: the page only ever holds the
 * link with "***" in its place, which is also why the field starts empty.
 */

/** How often the camera service is asked whether the link is up. */
const STATUS_POLL_MS = 10_000;
/** After a save, the services need a poll or two before the new link is open. */
const AFTER_SAVE_MS = 12_000;

type LinkState = "checking" | "connected" | "offline" | "unreachable";

const STATE_LABEL: Record<LinkState, string> = {
  checking: "Checking…",
  connected: "Camera connected",
  offline: "No signal",
  unreachable: "Camera service unreachable",
};

function stateColor(state: LinkState): string {
  if (state === "connected") return "var(--status-green-text)";
  if (state === "offline") return "var(--status-amber-text)";
  return "var(--status-red-text)";
}

export function CameraSourceSection({ camera, canManage }: { camera: CameraSource | null; canManage: boolean }) {
  const router = useRouter();
  const saver = useSaver();
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<LinkState>("checking");
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);
  // Bumped after a save so the poll below keeps running long enough to see the
  // services pick the new link up, instead of judging it a second too early.
  const [settleUntil, setSettleUntil] = useState(0);

  const stored = camera?.rtspUrl ?? null;
  const source = camera?.source ?? "none";

  // Follow the saved link: after a save the router reloads the page data, and
  // the field should go back to empty ("keep what is saved") rather than hold
  // a link that is now the current one.
  useEffect(() => {
    setDraft("");
    setTestNote(null);
  }, [stored]);

  // Ask the camera service whether it has a picture, for as long as this card
  // is on screen — and a little longer after a save.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const cameras = await fetchVisionCameras();
        if (!alive) return;
        setState(cameras.find((c) => c.camera_id === "CAM-01")?.connected ? "connected" : "offline");
      } catch {
        if (alive) setState("unreachable");
      }
    };
    void tick();
    const id = setInterval(tick, STATUS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [settleUntil]);

  const trimmed = draft.trim();
  const dirty = trimmed.length > 0;

  const save = async () => {
    if (!canManage || !dirty) return;
    const ok = await saver.run(() => saveCameraSource(trimmed), tr("Saved. The camera reconnects in a moment."));
    if (!ok) return;
    setSettleUntil(Date.now());
    await router.invalidate();
  };

  const clear = async () => {
    if (!canManage) return;
    const ok = await saver.run(() => saveCameraSource(""), tr("Cleared. The .env link is used again, if there is one."));
    if (!ok) return;
    setSettleUntil(Date.now());
    await router.invalidate();
  };

  const test = async () => {
    if (!dirty || testing) return;
    setTesting(true);
    setTestNote(null);
    try {
      const result = await testCameraSource(trimmed);
      setTestNote(
        result.ok
          ? {
              ok: true,
              text: tr("The service opened it: {w}×{h} in {ms} ms.", {
                w: result.width ?? 0,
                h: result.height ?? 0,
                ms: result.ms ?? 0,
              }),
            }
          : { ok: false, text: result.error ?? tr("The link did not open.") },
      );
    } catch (err) {
      setTestNote({
        ok: false,
        text:
          err instanceof ApiError
            ? (err.detail ?? tr("The camera service could not test it."))
            : tr("Could not reach the camera service."),
      });
    } finally {
      setTesting(false);
    }
  };

  const sourceLine =
    source === "settings"
      ? tr("Saved here{when}.", {
          when: camera?.updatedAt ? ` ${new Date(camera.updatedAt).toLocaleString(localeTag())}` : "",
        })
      : source === "environment"
        ? tr("From the deployment's .env — no link has been saved here yet.")
        : tr("No camera link is set.");

  return (
    <Section title={tr("Camera")}>
      <Row label={tr("Camera status")} sub={tr("Asked of the camera service every few seconds.")}>
        <span className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: stateColor(state) }}>
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: "currentColor" }} />
          {tr(STATE_LABEL[state])}
        </span>
      </Row>

      <Row label={tr("Link in use")} sub={sourceLine}>
        <MonoVal value={stored ?? tr("Not set")} />
      </Row>

      <Block>
        <label htmlFor="camera-rtsp" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {tr("RTSP link")}
        </label>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          {tr(
            "The address the camera answers on, login included — rtsp://user:password@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0.",
          )}
        </p>
        <input
          id="camera-rtsp"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          disabled={!canManage}
          placeholder={stored ?? "rtsp://user:password@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0"}
          onChange={(e) => {
            saver.setNote(null);
            setTestNote(null);
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          className="cb-input mt-2 block w-full font-mono text-sm disabled:opacity-60"
        />
        <Hint>
          {stored
            ? tr("Leave the field empty to keep the link above. The password is not sent back to this page, so a new link has to be the whole link.")
            : tr("The password is kept on the server once saved: this page will show it with *** in its place.")}
        </Hint>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void test()}
            disabled={!canManage || !dirty || testing}
            className="tap rounded-full border border-[var(--border-default)] bg-[var(--surface-raised)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--brand)] disabled:opacity-50"
          >
            {testing ? tr("Opening…") : tr("Test link")}
          </button>
          {source === "settings" && canManage && (
            <button
              type="button"
              onClick={() => void clear()}
              disabled={saver.busy}
              className="tap rounded-full border border-[var(--border-default)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
              style={{ color: "var(--text-secondary)" }}
            >
              {tr("Clear")}
            </button>
          )}
        </div>
        {testNote && (
          <p
            role="status"
            className="mt-2 text-xs font-semibold"
            style={{ color: testNote.ok ? "var(--status-green-text)" : "var(--status-red-text)" }}
          >
            {testNote.text}
          </p>
        )}

        <Hint>
          {tr(
            "The live view and the analysis both reopen the camera with the saved link within about ten seconds — no restart.",
          )}
        </Hint>

        {!canManage ? (
          <Hint>{tr(NOT_ALLOWED)}</Hint>
        ) : (
          <SaveRow
            onSave={() => void save()}
            busy={saver.busy}
            disabled={!dirty}
            note={saver.note}
            label={tr("Save Link")}
          />
        )}
      </Block>
    </Section>
  );
}
