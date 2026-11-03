import { fetchPushKey, subscribePush, unsubscribePush } from "@/lib/api-client";

/* Browser push for the Settings card: ask the browser's permission, subscribe this
 * browser to the server's push key, and tell the API. The service worker that
 * shows the notices is public/sw.js. */

export type PushProblem = "unsupported" | "denied" | "not_configured" | "failed";

/** Thrown with the reason push could not be turned on in this browser. */
export class PushError extends Error {
  constructor(public problem: PushProblem) {
    super(problem);
  }
}

export const pushSupported = (): boolean =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** The server's key arrives as base64url text; the browser wants bytes. */
function keyBytes(base64Url: string): Uint8Array {
  const padded = base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** True when this browser already has a push subscription. */
export async function pushSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return Boolean(await reg?.pushManager.getSubscription());
}

/** Must be called from a click (the browser asks for permission then). */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new PushError("unsupported");
  const { publicKey } = await fetchPushKey();
  if (!publicKey) throw new PushError("not_configured");
  if ((await Notification.requestPermission()) !== "granted") throw new PushError("denied");
  try {
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
    await subscribePush(sub.toJSON());
  } catch {
    throw new PushError("failed");
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await unsubscribePush(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}
