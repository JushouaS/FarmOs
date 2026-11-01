import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { POLICY_SUMMARY } from "@/lib/privacy-policy";
import { tr } from "@/lib/i18n";

/* Shown once after signing in, and again whenever the Privacy Policy changes, until the
 * person agrees. Declining signs them out. Nothing else in the app opens before this. */
export function PrivacyGate() {
  const { acceptPrivacy, logout } = useAuth();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const agree = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await acceptPrivacy();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4 sm:p-6" style={{ background: "var(--surface-page)" }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-gate-title"
        className="cb-card w-full max-w-lg space-y-5 p-6 sm:p-8"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--brand-muted)", color: "var(--brand)" }}>
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h1 id="privacy-gate-title" className="font-display text-xl font-bold tracking-tight sm:text-2xl" style={{ color: "var(--text-primary)" }}>
              {tr("Your privacy")}
            </h1>
            <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>{tr("Please read this before you continue.")}</p>
          </div>
        </div>

        <ul className="space-y-3">
          {POLICY_SUMMARY.map((line) => (
            <li key={line} className="flex gap-3 text-base leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--brand)" }} aria-hidden="true" />
              <span>{tr(line)}</span>
            </li>
          ))}
        </ul>

        <Link
          to="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="tap inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
          style={{ color: "var(--brand)" }}
        >
          {tr("Read the full Privacy Policy")}
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </Link>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3.5" style={{ borderColor: "var(--border-default)", background: "var(--surface-raised)" }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-[var(--brand)]"
          />
          <span className="text-base leading-snug" style={{ color: "var(--text-primary)" }}>
            {tr("I have read and understood the Privacy Policy, and I agree to how my personal information is handled.")}
          </span>
        </label>

        {failed && (
          <p role="alert" className="text-sm" style={{ color: "var(--status-red-text)" }}>
            {tr("Your agreement could not be saved. Check your connection and try again.")}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => void logout()} disabled={busy} className="btn-ghost tap justify-center">
            {tr("Decline and sign out")}
          </button>
          <button type="button" onClick={agree} disabled={!checked || busy} className="btn-primary tap justify-center disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? tr("Saving…") : tr("Agree and continue")}
          </button>
        </div>
      </section>
    </div>
  );
}
