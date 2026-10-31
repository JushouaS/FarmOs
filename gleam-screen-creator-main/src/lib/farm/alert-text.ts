import { tr } from "@/lib/i18n";

/**
 * Text that comes from the database in English (an alert's kind and message, a
 * notification's body). It is looked up in the dictionary as it stands; a
 * sentence nobody has translated shows in English, so nothing breaks when new
 * alerts arrive.
 */

/** "CRITICAL_EVENT" -> "Critical event" */
export function humanizeKind(kind: string): string {
  const words = kind.toLowerCase().replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An alert's kind as shown in a list. English keeps the stored code ("FEED_CYCLE"); other languages show the translated name when there is one. */
export function alertKindLabel(kind: string): string {
  const direct = tr(kind);
  if (direct !== kind) return direct;
  const human = humanizeKind(kind);
  const translated = tr(human);
  return translated !== human ? translated : kind;
}

/** An alert's kind as a short title (the pop-ups). */
export function alertKindTitle(kind: string): string {
  const direct = tr(kind);
  return direct !== kind ? direct : tr(humanizeKind(kind));
}
