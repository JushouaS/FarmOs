/**
 * Demo day: the recorded demo (public/demo/) in place of the live farm.
 *
 * The demo is on whenever its video files are on this computer, unless this browser turned it off (Live Camera's
 * "Demo video" button). While it is on, a cookie tells the API to answer the overview and the sensor history as of the
 * recording's moment (DEMO_AT), so the readings and analytics match the videos. The loaders forward cookies, so this
 * reaches the server-rendered pages too.
 */
const STORE_KEY = "cerebroil.demoVideo";
const COOKIE = "cerebroil_demo";

export const DEMO_FILES = { behavior: "/demo/behavior.mp4", weight: "/demo/weight.mp4", scans: "/demo/behavior_scans.json" } as const;

let filesPromise: Promise<{ behavior: boolean; weight: boolean }> | null = null;

/** Which demo videos are on this computer (checked once per page load). */
export function demoFiles(): Promise<{ behavior: boolean; weight: boolean }> {
  const has = (url: string) =>
    fetch(url, { method: "HEAD", cache: "no-store" })
      .then((r) => r.ok && (r.headers.get("content-type") ?? "").startsWith("video/"))
      .catch(() => false);
  filesPromise ??= Promise.all([has(DEMO_FILES.behavior), has(DEMO_FILES.weight)]).then(([behavior, weight]) => ({ behavior, weight }));
  return filesPromise;
}

/** Whether this browser wants the demo (on unless turned off). */
export function demoWanted(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) !== "0";
  } catch {
    return true;
  }
}

function cookieOn(): boolean {
  return typeof document !== "undefined" && document.cookie.split("; ").includes(`${COOKIE}=1`);
}

function writeCookie(on: boolean) {
  document.cookie = on ? `${COOKIE}=1; path=/; max-age=31536000; SameSite=Lax` : `${COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * Make the cookie agree with the files and this browser's choice. Returns true when it changed, so the caller can
 * reload the page's data.
 */
export async function syncDemoCookie(): Promise<boolean> {
  const files = await demoFiles();
  const on = (files.behavior || files.weight) && demoWanted();
  if (on === cookieOn()) return false;
  writeCookie(on);
  return true;
}

/** Turn the demo on or off in this browser (the Live Camera button). */
export function setDemoWanted(on: boolean) {
  try {
    localStorage.setItem(STORE_KEY, on ? "1" : "0");
  } catch {}
  writeCookie(on);
}

/** The moment the page's data is for: the demo moment the API reported, or now. */
export function overviewNow(overview: any): number {
  const at = Date.parse(overview?.demo?.at ?? "");
  return Number.isFinite(at) ? at : Date.now();
}
