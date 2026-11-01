import { T, tr } from "@/lib/i18n";

/**
 * Text that comes from the database in English (an alert's kind and message, a
 * notification's body). It is looked up in the dictionary as it stands; a
 * sentence nobody has translated shows in English, so nothing breaks when new
 * alerts arrive.
 */

/**
 * Alert messages the system writes itself, with a number or a name in them. They
 * are matched by shape, so the sentence can be translated with the numbers kept.
 */
const MESSAGE_PATTERNS: [RegExp, string, string[]][] = [
  [
    /^Inactive birds: (\d+)\. They have not moved for (\d+) minutes while the rest of the flock is active\.$/,
    T("Inactive birds: {n}. They have not moved for {m} minutes while the rest of the flock is active."),
    ["n", "m"],
  ],
  [
    /^Most of the flock has been still for (\d+) minutes during the day\. Check the temperature, lights and water\.$/,
    T("Most of the flock has been still for {m} minutes during the day. Check the temperature, lights and water."),
    ["m"],
  ],
  [
    /^Huddling: (\d+)% of the birds \((\d+)\) have stayed together for (\d+) minutes\. Check the temperature\.$/,
    T("Huddling: {p}% of the birds ({n}) have stayed together for {m} minutes. Check the temperature."),
    ["p", "n", "m"],
  ],
  [
    /^Mortality spike in (.+): (\d+) deaths today \(previous: (\d+)\)\.$/,
    T("Mortality spike in {house}: {n} deaths today (previous: {p})."),
    ["house", "n", "p"],
  ],
];

/** An alert's message (or a notification's text) in the current language. */
export function alertMessage(message: string): string {
  const direct = tr(message);
  if (direct !== message) return direct;
  for (const [pattern, template, names] of MESSAGE_PATTERNS) {
    const m = message.match(pattern);
    if (m) return tr(template, Object.fromEntries(names.map((name, i) => [name, m[i + 1]])));
  }
  return message;
}

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
