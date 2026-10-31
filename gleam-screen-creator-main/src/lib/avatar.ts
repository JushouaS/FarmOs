import { useSyncExternalStore } from "react";
import { tr } from "@/lib/i18n";

/**
 * Profile photo, kept in this browser.
 *
 * The API has no endpoint for profile images, so the photo lives in
 * localStorage, keyed by user. That means it follows the person on this
 * browser only; moving it to the server needs a column and an upload route.
 *
 * An upload is cropped to a centred square and shrunk to 256px before it is
 * stored, so a 2 MB photo becomes roughly 20 KB and can't fill the
 * browser's storage quota.
 */

const PREFIX = "cb-avatar:";
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg"]);
const MAX_INPUT_MB = 2;
const MAX_INPUT_BYTES = MAX_INPUT_MB * 1024 * 1024;
const SIZE = 256;

/** For the file input's `accept` attribute: JPG and PNG only. */
export const AVATAR_ACCEPT = ".jpg,.jpeg,.png,image/jpeg,image/png";

/** One line for the UI that states the rules, in the current language. */
export const avatarRules = () => tr("JPG or PNG, up to {mb} MB.", { mb: MAX_INPUT_MB });

/** A problem the person can fix (wrong file, too big); the message is for them. */
export class AvatarError extends Error {}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab changing the photo.
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith(PREFIX)) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function read(userKey: string | null | undefined): string | null {
  if (!userKey) return null;
  try {
    return localStorage.getItem(PREFIX + userKey);
  } catch {
    return null; // storage blocked (private window, site data off)
  }
}

/** The stored photo as a data URL, or null. Null on the server, so the first
 *  client render matches the server's and hydration stays quiet. */
export function useAvatar(userKey: string | null | undefined): string | null {
  return useSyncExternalStore(
    subscribe,
    () => read(userKey),
    () => null,
  );
}

/** Crop to a centred square, shrink, and store. Throws AvatarError for
 *  problems the person can fix. */
export async function saveAvatar(userKey: string, file: File): Promise<void> {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new AvatarError(tr("Only JPG and PNG images are allowed."));
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new AvatarError(tr("That image is over {mb} MB. Choose a smaller one.", { mb: MAX_INPUT_MB }));
  }
  if (typeof createImageBitmap === "undefined") {
    throw new AvatarError(tr("This browser can't process images. Try a current Chrome, Edge, Firefox or Safari."));
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new AvatarError(tr("That file couldn't be read as an image."));
  }

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new AvatarError(tr("This browser can't process images."));
  }
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    SIZE,
    SIZE,
  );
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  try {
    localStorage.setItem(PREFIX + userKey, dataUrl);
  } catch {
    throw new AvatarError(tr("This browser wouldn't save the photo (storage is full or blocked)."));
  }
  notify();
}

export function removeAvatar(userKey: string): void {
  try {
    localStorage.removeItem(PREFIX + userKey);
  } catch {
    /* nothing stored, or storage blocked */
  }
  notify();
}
