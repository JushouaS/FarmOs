import { Fragment, useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { tl } from "./tl";
import { ceb } from "./ceb";

/**
 * The language of the whole app.
 *
 * Every piece of text on screen goes through `tr("English text")`. The English
 * sentence is its own lookup key, so a sentence nobody has translated yet simply
 * shows in English instead of breaking, and the dictionaries (tl.ts, ceb.ts)
 * read side by side with the code. Numbers and names go in as {placeholders}:
 *
 *   tr("Day {day} of {total}", { day: 16, total: 45 })
 *
 * The language lives in the browser (so it works on the sign-in page, before
 * anyone is signed in) and on the account (so it follows you to another
 * device). Changing it remounts the screen, which is how every `tr()` call
 * picks up the new language without each component having to subscribe.
 */

export type Lang = "en" | "tl" | "ceb";

/** Each language in its own words, so a person can find theirs. */
export const LANGUAGES: ReadonlyArray<{ code: Lang; name: string; short: string }> = [
  { code: "en", name: "English", short: "EN" },
  { code: "tl", name: "Tagalog", short: "TL" },
  { code: "ceb", name: "Cebuano", short: "CEB" },
];

const STORAGE_KEY = "cb-language";
/** Set when the language was changed while signed out, so the account gets it after sign-in. */
const UNSYNCED_KEY = "cb-language-unsynced";

const dictionaries: Record<Lang, Record<string, string>> = { en: {}, tl, ceb };

let current: Lang = "en";
const listeners = new Set<() => void>();

const isLang = (v: unknown): v is Lang => v === "en" || v === "tl" || v === "ceb";

function apply(next: Lang) {
  if (next === current) return;
  current = next;
  try {
    document.documentElement.lang = next;
  } catch {
    /* no document (server render) */
  }
  listeners.forEach((l) => l());
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};

const store = (lang: Lang, unsynced?: boolean) => {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
    if (unsynced === true) localStorage.setItem(UNSYNCED_KEY, "1");
    if (unsynced === false) localStorage.removeItem(UNSYNCED_KEY);
  } catch {
    /* storage blocked: the choice lasts until the page is closed */
  }
};

const stored = (): Lang | null => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
};

/**
 * Translate a sentence into the current language. Missing translations show the
 * English. `{name}` placeholders are filled from `vars` in every language.
 */
export function tr(text: string, vars?: Record<string, string | number>): string {
  const raw = (current === "en" ? undefined : dictionaries[current][text]) ?? text;
  return vars ? raw.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole)) : raw;
}

/**
 * Marks a sentence that sits at the top level of a file (a list of labels, say),
 * where `tr()` cannot run yet. It changes nothing; it only puts the sentence in
 * the dictionary. Show it with `tr(label)` where it is displayed.
 */
export const T = (text: string): string => text;

/** The language in use, for code that picks a locale or a model language. */
export const getLanguage = (): Lang => current;

/** Locale tag for dates and numbers in the current language. */
export const localeTag = (lang: Lang = current): string => (lang === "tl" ? "fil-PH" : lang === "ceb" ? "ceb-PH" : "en-US");

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user, updateProfile } = useAuth();
  const lang = useSyncExternalStore(subscribe, getLanguage, () => "en" as Lang);
  const accountLang = user?.analysisLanguage;

  // This browser's last choice. Read after mount so the server render and the
  // first client render match.
  useEffect(() => {
    const s = stored();
    if (s) apply(s);
  }, []);

  // A new device has no choice yet: take the account's.
  useEffect(() => {
    if (accountLang && !stored()) {
      apply(accountLang);
      store(accountLang);
    }
  }, [accountLang]);

  // A choice made on the sign-in page reaches the account once someone is signed in.
  useEffect(() => {
    if (!user || !accountLang) return;
    let unsynced = false;
    try {
      unsynced = localStorage.getItem(UNSYNCED_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (unsynced && current !== accountLang) {
      updateProfile({ analysisLanguage: current }).catch(() => {});
    }
    if (unsynced) store(current, false);
  }, [user, accountLang, updateProfile]);

  // Remounting is what makes every tr() call read the new language.
  return <Fragment key={lang}>{children}</Fragment>;
}

/** The current language and a way to change it (saved here, and to the account when signed in). */
export function useLanguage() {
  const { user, updateProfile } = useAuth();
  const lang = useSyncExternalStore(subscribe, getLanguage, () => "en" as Lang);

  const setLanguage = useCallback(
    (next: Lang) => {
      apply(next);
      store(next, user ? undefined : true);
      if (user) updateProfile({ analysisLanguage: next }).catch(() => {});
    },
    [user, updateProfile],
  );

  return { lang, setLanguage };
}
