import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, type FormEvent } from "react";
import { useAuth, MfaRequiredError, type LoginError } from "@/lib/auth-context";
import { Icon } from "@/components/farm/Icon";

const TITLE = "Sign In | CereBroiler";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: "Authenticate to FARM_OS operations console." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { login, isAuthenticated, verifyMfa, verifyMfaBackupCode } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptsHint, setAttemptsHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [contactSent, setContactSent] = useState(false);

  // MFA state
  const [mfaPending, setMfaPending] = useState(false);
  const [mfaToken, setMfaToken] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState("");

  // Already authenticated — redirect to dashboard via effect (not during render).
  useEffect(() => {
    if (isAuthenticated) navigate({ to: "/" });
  }, [isAuthenticated, navigate]);

  if (isAuthenticated) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setAttemptsHint(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate({ to: "/" });
    } catch (err) {
      if (err instanceof MfaRequiredError) {
        setMfaPending(true);
        return;
      }
      const code = err instanceof Error ? err.message : "login_failed";
      const messages: Record<string, string> = {
        invalid_credentials: "Invalid email or password.",
        email_taken: "That email is already registered.",
        user_disabled: "This account has been disabled.",
        account_locked: "This account is temporarily locked.",
        login_failed: "Could not reach the authentication service.",
      };
      setError(messages[code] ?? `Authentication failed (${code}).`);
      const loginErr = err as LoginError;
      if (loginErr.attemptsRemaining !== undefined && loginErr.attemptsRemaining >= 0) {
        setAttemptsHint(`${loginErr.attemptsRemaining} attempt${loginErr.attemptsRemaining === 1 ? "" : "s"} remaining before lockout.`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (useBackupCode) {
        await verifyMfaBackupCode(backupCode);
      } else {
        await verifyMfa(mfaToken);
      }
      navigate({ to: "/" });
    } catch (err) {
      const code = err instanceof Error ? err.message : "mfa_failed";
      setError(code === "invalid_mfa_token" ? "Invalid verification code." : code === "invalid_backup_code" ? "Invalid backup code." : "Verification failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleContactSubmit = (e: FormEvent) => {
    e.preventDefault();
    const subject = encodeURIComponent(`Access Request from ${contactName}`);
    const body = encodeURIComponent(
      `Name: ${contactName}\nEmail: ${contactEmail}\n\nMessage:\n${contactMessage}`,
    );
    window.location.href = `mailto:santos.jushouaoswald22@gmail.com?subject=${subject}&body=${body}`;
    setContactSent(true);
    setTimeout(() => {
      setShowContact(false);
      setContactSent(false);
      setContactName("");
      setContactEmail("");
      setContactMessage("");
    }, 2000);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 data-grid-bg">
      {/* Accent gradient bar across the top of the viewport. */}
      <div className="absolute inset-x-0 top-0 h-1 accent-gradient" />

      <div className="w-full max-w-sm">
        {/* Brand block */}
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2">
            <Icon name="precision_manufacturing" size={28} className="text-accent-cyan" />
            <span className="font-headline-md text-headline-md font-bold tracking-tighter text-on-surface">
              CereBroiler
            </span>
          </div>
        </div>

        {/* Sign-in card */}
        <div className="clinical-card p-8">
          {mfaPending ? (
            <></>
          ) : showContact ? (
            <>
              {contactSent ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10">
                  <Icon name="check_circle" size={28} className="text-accent-teal" />
                  <span className="text-sm text-on-surface">Opening email client...</span>
                </div>
              ) : (
                <form onSubmit={handleContactSubmit} className="space-y-4">
                  <div className="mb-2 flex flex-col items-center gap-1">
                    <Icon name="mail" size={22} className="text-accent-cyan" />
                    <h2 className="text-sm font-semibold text-on-surface">Request access</h2>
                    <p className="text-xs text-on-surface-variant">We'll get back to you shortly</p>
                  </div>
                  <div className="space-y-3">
                    <div className="relative">
                      <Icon name="person" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                      <input
                        type="text"
                        required
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        placeholder="Name"
                        className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 pl-9 pr-3 text-xs text-on-surface transition-colors focus:border-accent-cyan focus:outline-none"
                      />
                    </div>
                    <div className="relative">
                      <Icon name="mail" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                      <input
                        type="email"
                        required
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="Email"
                        className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 pl-9 pr-3 text-xs text-on-surface transition-colors focus:border-accent-cyan focus:outline-none"
                      />
                    </div>
                    <textarea
                      required
                      rows={3}
                      value={contactMessage}
                      onChange={(e) => setContactMessage(e.target.value)}
                      placeholder="Why do you need access?"
                      className="w-full resize-none rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 px-3 text-xs text-on-surface transition-colors focus:border-accent-cyan focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowContact(false)}
                      className="flex-1 rounded-lg border border-outline-variant py-2.5 text-xs text-on-surface-variant transition-colors hover:border-error hover:text-error"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-xs font-medium text-background transition-colors hover:bg-primary/80"
                    >
                      <Icon name="send" size={14} />
                      Send
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <>
              <div className="mb-6">
                <h1 className="font-headline-sm text-headline-sm text-on-surface">
                  Sign In
                </h1>
                <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
                  Enter your credentials to access the operations dashboard.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <div className="flex items-start gap-3 rounded-lg border border-error/30 bg-error-container/40 p-3">
                    <Icon name="error" size={18} className="mt-px shrink-0 text-error" />
                    <div className="flex flex-col">
                      <span className="font-body-md text-body-md text-on-error-container">
                        {error}
                      </span>
                      {attemptsHint && (
                        <span className="mt-0.5 text-xs text-on-error-container/80">
                          {attemptsHint}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="login-email" className="font-label-caps text-label-caps text-on-surface-variant">
                    EMAIL
                  </label>
                  <div className="relative">
                    <Icon name="mail" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                    <input
                      id="login-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="operator@facility.com"
                      className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-4 font-body-md text-body-md text-on-surface transition-colors focus:border-accent-cyan focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="login-password" className="font-label-caps text-label-caps text-on-surface-variant">
                    PASSWORD
                  </label>
                  <div className="relative">
                    <Icon name="lock" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                    <input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-11 font-body-md text-body-md text-on-surface transition-colors focus:border-accent-cyan focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((p) => !p)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-on-surface-variant transition-colors hover:text-on-surface"
                      tabIndex={-1}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      <Icon name={showPassword ? "visibility_off" : "visibility"} size={18} />
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 font-label-caps text-label-caps text-white accent-gradient transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      AUTHENTICATING...
                    </>
                  ) : (
                    <>
                      <Icon name="login" size={16} />
                      SIGN_IN
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 border-t border-outline-variant/30 pt-4 text-center">
                <p className="text-xs text-on-surface-variant/60">
                  Need access?{" "}
                  <button
                    type="button"
                    onClick={() => setShowContact(true)}
                    className="text-on-surface-variant transition-colors hover:text-primary hover:underline"
                  >
                    Contact us
                  </button>
                </p>
              </div>
            </>
          )}

          {mfaPending && (
            <>
              <div className="mb-6">
                <h1 className="font-headline-sm text-headline-sm text-on-surface">
                  Two-Factor Verification
                </h1>
                <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
                  {useBackupCode
                    ? "Enter a backup code to sign in."
                    : "Enter the 6-digit code from your authenticator app."}
                </p>
              </div>

              <form onSubmit={handleMfaSubmit} className="space-y-5">
                {error && (
                  <div className="flex items-start gap-3 rounded-lg border border-error/30 bg-error-container/40 p-3">
                    <Icon name="error" size={18} className="mt-px shrink-0 text-error" />
                    <span className="font-body-md text-body-md text-on-error-container">
                      {error}
                    </span>
                  </div>
                )}

                {useBackupCode ? (
                  <div className="space-y-1.5">
                    <label htmlFor="mfa-backup" className="font-label-caps text-label-caps text-on-surface-variant">
                      BACKUP CODE
                    </label>
                    <input
                      id="mfa-backup"
                      type="text"
                      required
                      autoComplete="off"
                      value={backupCode}
                      onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                      placeholder="XXXXXXXXXX"
                      className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 px-4 font-body-md text-body-md text-center tracking-widest text-on-surface transition-colors focus:border-accent-cyan focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label htmlFor="mfa-token" className="font-label-caps text-label-caps text-on-surface-variant">
                      VERIFICATION CODE
                    </label>
                    <input
                      id="mfa-token"
                      type="text"
                      required
                      autoComplete="off"
                      inputMode="numeric"
                      maxLength={9}
                      value={mfaToken}
                      onChange={(e) => setMfaToken(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                      className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 px-4 font-body-md text-body-md text-center tracking-widest text-on-surface transition-colors focus:border-accent-cyan focus:outline-none"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 font-label-caps text-label-caps text-white accent-gradient transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      VERIFYING...
                    </>
                  ) : (
                    <>
                      <Icon name="verified_user" size={16} />
                      VERIFY
                    </>
                  )}
                </button>

                <div className="flex items-center justify-between text-xs text-on-surface-variant">
                  <button
                    type="button"
                    onClick={() => {
                      setUseBackupCode((v) => !v);
                      setError(null);
                    }}
                    className="transition-colors hover:text-primary hover:underline"
                  >
                    {useBackupCode ? "Use authenticator app" : "Use backup code"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMfaPending(false);
                      setError(null);
                    }}
                    className="transition-colors hover:text-error hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
