import type { LiveBehavior } from "@/lib/api-client";

/** One bird on the live monitor's watch list (still for a while, not yet inactive). */
export type WatchedBird = NonNullable<LiveBehavior["watch"]>[number];

/** The monitor's early-warning levels in minutes, as the camera computer reports them (5 and 15 by default). */
export function watchMinutes(monitor: LiveBehavior | null): [number, number] {
  const m = monitor?.watch_minutes;
  return Array.isArray(m) && m.length === 2 && m[0] > 0 && m[1] > m[0] ? [m[0], m[1]] : [5, 15];
}

/**
 * Splits the watch list: every bird still for the first level or longer, and the ones past the second level,
 * longest first. Null when the camera computer does not send a watch list (an older camera service).
 */
export function watchSummary(monitor: LiveBehavior | null): { all: WatchedBird[]; orange: WatchedBird[] } | null {
  if (!monitor || !Array.isArray(monitor.watch)) return null;
  const all = [...monitor.watch].sort((a, b) => b.still_seconds - a.still_seconds);
  return { all, orange: all.filter((w) => w.level === "orange") };
}

/**
 * Where a bird is in the camera picture, as one of nine areas, from its centre as a share of width and height.
 * The camera picture shows no bird numbers, so this is how the farmer finds the bird. The names are English keys;
 * show them with tr() (Tagalog and Cebuano are in messages/part30.ts).
 */
export function pictureArea(at: [number, number] | undefined): string {
  if (!at) return "Centre";
  const col = at[0] < 1 / 3 ? 0 : at[0] > 2 / 3 ? 2 : 1;
  const row = at[1] < 1 / 3 ? 0 : at[1] > 2 / 3 ? 2 : 1;
  return [
    ["Top left", "Top", "Top right"],
    ["Left", "Centre", "Right"],
    ["Bottom left", "Bottom", "Bottom right"],
  ][row][col];
}
