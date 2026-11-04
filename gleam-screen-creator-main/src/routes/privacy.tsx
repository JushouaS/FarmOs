import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { POLICY_SECTIONS, POLICY_UPDATED } from "@/lib/privacy-policy";
import { localeTag, tr } from "@/lib/i18n";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: tr("Privacy Policy — Cerebroil") }] }),
  component: PrivacyPage,
});

/* The Privacy Policy. It opens without signing in (from the sign-in page) and while the
 * agreement screen is up, so it stands on its own instead of inside the app's shell. */
function PrivacyPage() {
  const { isAuthenticated } = useAuth();
  const updated = new Date(`${POLICY_UPDATED}T00:00:00`).toLocaleDateString(localeTag(), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-dvh" style={{ background: "var(--surface-page)" }}>
      <header className="sticky top-0 z-10 border-b" style={{ background: "var(--surface-card)", borderColor: "var(--border-subtle)" }}>
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            to={isAuthenticated ? "/" : "/login"}
            className="tap inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
            style={{ color: "var(--brand)" }}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {isAuthenticated ? tr("Back to the app") : tr("Back to sign in")}
          </Link>
          <span className="font-display text-sm font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            {tr("Cerebroil")}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--brand-muted)", color: "var(--brand)" }}>
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "var(--text-primary)" }}>
              {tr("Privacy Policy")}
            </h1>
            <p className="mt-0.5 text-sm" style={{ color: "var(--text-tertiary)" }}>
              {tr("Last updated {date}", { date: updated })}
            </p>
          </div>
        </div>

        <div className="mt-8 space-y-8">
          {POLICY_SECTIONS.map((s, i) => (
            <section key={s.id} aria-labelledby={`privacy-${s.id}`}>
              <h2 id={`privacy-${s.id}`} className="flex items-baseline gap-3 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                <span className="font-mono text-sm" style={{ color: "var(--brand)" }}>{String(i + 1).padStart(2, "0")}</span>
                {tr(s.title)}
              </h2>
              <div className="mt-2.5 space-y-3 border-l pl-4 sm:ml-1" style={{ borderColor: "var(--border-subtle)" }}>
                {s.intro && (
                  <p className="text-base leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {tr(s.intro)}
                    {s.id === "contact" && (
                      <>
                        {" "}
                        <Link to="/contact" className="font-semibold hover:underline" style={{ color: "var(--brand)" }}>
                          {tr("Open the Contact page")}
                        </Link>
                      </>
                    )}
                  </p>
                )}
                {s.items && (
                  <ul className="space-y-2">
                    {s.items.map((item) => (
                      <li key={item} className="flex gap-3 text-base leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                        <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--brand)" }} aria-hidden="true" />
                        <span>{tr(item)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {s.outro && (
                  <p className="text-base leading-relaxed" style={{ color: "var(--text-secondary)" }}>{tr(s.outro)}</p>
                )}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
