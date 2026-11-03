/* ─── Day and night ───────────────────────────────────────────────────────── */

/** When the day starts and when the night starts, local time as "HH:MM" (Settings > Light and night hours). */
export interface LightingHours {
  dayStart: string;
  nightStart: string;
}

/** Day 05:00 to 16:59, night the rest, until Settings says otherwise. */
export const DEFAULT_LIGHTING: LightingHours = { dayStart: "05:00", nightStart: "17:00" };

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** "17:00" -> "5:00 PM". */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = (h ?? 0) % 12 || 12;
  return `${hour}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`;
}

/**
 * Between the day start and the night start (05:00 and 17:00 unless Settings says otherwise) it is day;
 * the rest is night, and the night may run past midnight. At night still birds are asleep, so the
 * inactivity alerts are not raised.
 */
export function isNightCycle(date: Date = new Date(), lighting: LightingHours = DEFAULT_LIGHTING): boolean {
  const now = date.getHours() * 60 + date.getMinutes();
  const day = minutesOf(lighting.dayStart);
  const night = minutesOf(lighting.nightStart);
  const isDay = day < night ? now >= day && now < night : now >= day || now < night;
  return !isDay;
}
