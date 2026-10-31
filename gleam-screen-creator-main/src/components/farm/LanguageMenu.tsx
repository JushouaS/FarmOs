import { useState } from "react";
import { Check, Languages } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LANGUAGES, tr, useLanguage } from "@/lib/i18n";

/* The language picker: a small button showing the current language code, which
 * opens a short list. It sits in the top bar and on the sign-in page, so a
 * person who cannot read English can change it before doing anything else. The
 * language names are written in their own language and never translated. */

export function LanguageMenu({ large = false }: { large?: boolean }) {
  const { lang, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find((l) => l.code === lang)!;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={tr("Language: {name}", { name: current.name })}
          title={tr("Language: {name}", { name: current.name })}
          className={`tap relative flex shrink-0 items-center justify-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] font-semibold text-[var(--text-secondary)] transition-all hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] ${large ? "h-10 px-3 text-sm" : "h-8 px-2 text-xs"}`}
        >
          <Languages className="h-4 w-4" aria-hidden="true" />
          <span className="font-mono">{current.short}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="w-48 rounded-2xl border border-[color:var(--border-default)] bg-[color:var(--surface-raised)] p-1.5 text-[color:var(--text-primary)] shadow-[var(--shadow-elev-3)]"
      >
        <div role="group" aria-label={tr("Language")}>
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              aria-pressed={lang === l.code}
              onClick={() => {
                setLanguage(l.code);
                setOpen(false);
              }}
              className="tap flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-[color:var(--surface-sunken)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--brand)]"
            >
              <span>{l.name}</span>
              {lang === l.code && <Check className="h-4 w-4 text-[color:var(--brand)]" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
