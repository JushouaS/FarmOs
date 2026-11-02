import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { ApiError, changePassword } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { weaknesses } from "./AccountSection";
import { tr } from "@/lib/i18n";

/* Shown after signing in with a temporary password (a new account, or one an administrator reset). Nothing
 * else in the app opens until the person has chosen their own password. The API refuses every other request
 * from such a session too, so this is not only a screen. */
export function ChangePasswordGate() {
  const { logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = weaknesses(next);
  const mismatch = again !== "" && again !== next;
  const ready = current !== "" && next !== "" && missing.length === 0 && again === next && next !== current;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      // The API signed every session out; going back to the sign-in page, where the new password is used.
      setDone(true);
      window.setTimeout(() => void logout(), 1800);
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof ApiError
          ? err.status === 401
            ? tr("That is not the temporary password you were given.")
            : (err.detail ?? tr("Could not change the password. Try again."))
          : tr("Could not change the password. Check the connection and try again."),
      );
    }
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <div>
      <label htmlFor={id} className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{label}</label>
      <input id={id} type="password" value={value} autoComplete={autoComplete}
        onChange={(e) => { setError(null); set(e.target.value); }} className="cb-input mt-1.5 block w-full text-sm" />
    </div>
  );

  return (
    <div className="flex min-h-dvh items-center justify-center p-4 sm:p-6" style={{ background: "var(--surface-page)" }}>
      <section role="dialog" aria-modal="true" aria-labelledby="change-pw-title" className="cb-card w-full max-w-md space-y-4 p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--brand-muted)", color: "var(--brand)" }}>
            <KeyRound className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h1 id="change-pw-title" className="font-display text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
              {tr("Choose your own password")}
            </h1>
            <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>{tr("The one you were given is only for this first sign-in.")}</p>
          </div>
        </div>

        {done ? (
          <p role="status" className="text-sm font-semibold" style={{ color: "var(--status-green-text)" }}>
            {tr("Password changed. Signing you out, then sign in with the new one.")}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {field("gate-current", tr("Temporary password"), current, setCurrent, "current-password")}
            {field("gate-new", tr("New password"), next, setNext, "new-password")}
            {next !== "" && missing.length > 0 && (
              <p className="text-xs" style={{ color: "var(--status-red-text)" }}>{tr("The new password needs {missing}.", { missing: missing.join(", ") })}</p>
            )}
            {next !== "" && next === current && (
              <p className="text-xs" style={{ color: "var(--status-red-text)" }}>{tr("Choose a password different from the temporary one.")}</p>
            )}
            {field("gate-again", tr("New password again"), again, setAgain, "new-password")}
            {mismatch && <p className="text-xs" style={{ color: "var(--status-red-text)" }}>{tr("The two new passwords are different.")}</p>}
            {error && <p role="alert" className="text-sm" style={{ color: "var(--status-red-text)" }}>{error}</p>}
            <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => void logout()} disabled={busy} className="btn-ghost tap justify-center">{tr("Sign out")}</button>
              <button type="submit" disabled={!ready || busy} className="btn-primary tap justify-center disabled:opacity-50">
                {busy ? tr("Changing…") : tr("Change password")}
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              {tr("At least 12 characters, with an uppercase letter, a lowercase letter, a number and a symbol.")}
            </p>
          </form>
        )}
      </section>
    </div>
  );
}
