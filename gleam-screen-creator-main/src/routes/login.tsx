import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef, type FormEvent } from "react";
import { useAuth, MfaRequiredError, type LoginError } from "@/lib/auth-context";
import { CerebroilLogo } from "@/components/farm/SideNav";
import { Chicken, type ChickenMood } from "@/components/farm/Chicken";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign In - Cerebroil" },
      { name: "description", content: "Sign in to Cerebroil CV Flock Monitor." },
    ],
  }),
  component: LoginPage,
});

/* Design read: sign-in for farm staff, minimal frosted-glass language over a
 * calm emerald field. Dials ENERGY 2 / RHYTHM 1 / MOTION 2.
 *
 * Glass is used on exactly two elements (R-10): the sign-in card and the
 * theme toggle. The two blurred colour fields behind them exist so the glass
 * has something to frost (R-01); both reuse the brand emerald and the CV lime
 * accent, no new colours. The chicken is the identity motif and its motion
 * reports sign-in state (see Chicken.tsx). */

const glassCard = {
  background: "color-mix(in srgb, var(--surface-card) 58%, transparent)",
  border: "1px solid color-mix(in srgb, var(--text-primary) 10%, transparent)",
  boxShadow:
    "var(--shadow-elev-3), inset 0 1px 0 color-mix(in srgb, #ffffff 10%, transparent)",
  WebkitBackdropFilter: "blur(24px) saturate(150%)",
  backdropFilter: "blur(24px) saturate(150%)",
} as const;

const fieldClass =
  "w-full rounded-xl border px-4 py-3 text-sm outline-none transition-[border-color,box-shadow] duration-150 " +
  "border-[color:var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-sunken)_55%,transparent)] " +
  "text-[color:var(--text-primary)] placeholder:text-[color:var(--text-tertiary)] placeholder:opacity-70 " +
  "focus:border-[color:var(--brand)] focus:ring-4 focus:ring-[color:var(--brand-muted)]";

const primaryBtnClass =
  "tactile-btn tap w-full rounded-xl py-3 text-sm font-semibold transition-[background-color,opacity] duration-150 " +
  "bg-[color:var(--brand)] text-[color:var(--text-inverse)] hover:bg-[color:var(--brand-hover)] disabled:opacity-70";

/* ── Theme toggle (glass, top right) ─────────────────────────────── */
function ThemeToggle() {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));
  }, []);

  const toggle = () => {
    const root = document.documentElement;
    const goLight = !root.classList.contains("light");
    root.classList.toggle("light", goLight);
    setIsLight(goLight);
    try {
      localStorage.setItem("theme", goLight ? "light" : "dark");
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="tactile-btn tap flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:text-[color:var(--text-primary)]"
      style={{ ...glassCard, boxShadow: "none", color: "var(--text-secondary)" }}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
    >
      {isLight ? (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="5" />
          <path strokeLinecap="round" d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      ) : (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  );
}

/* ── Main Login Page ─────────────────────────────────────────────── */
function LoginPage() {
  const { login, isAuthenticated, verifyMfa, verifyMfaBackupCode } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  // Set before login() resolves so the routing effect below can tell a
  // fresh sign-in (show the success beat first) from a user who was
  // already signed in when they opened /login (route away immediately).
  const signedInHere = useRef(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  const [mfaPending, setMfaPending] = useState(false);
  const [mfaToken, setMfaToken] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [backupCode, setBackupCode] = useState("");

  // Focus the first field on mouse/keyboard devices only: on phones an
  // autofocus throws the keyboard over the page before anyone asked for it.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) usernameRef.current?.focus();
  }, []);

  // Route away once authenticated. A fresh sign-in gets a short success
  // beat first so the confirmation state is actually visible.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (signedInHere.current) {
      const t = setTimeout(() => navigate({ to: "/" }), 900);
      return () => clearTimeout(t);
    }
    navigate({ to: "/" });
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setHint(null);
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      setShaking(true);
      return;
    }
    setLoading(true);
    try {
      signedInHere.current = true;
      await login(username, password);
      setSignedIn(true);
    } catch (err) {
      signedInHere.current = false;
      if (err instanceof MfaRequiredError) {
        setMfaPending(true);
        return;
      }
      const code = err instanceof Error ? err.message : "login_failed";
      const msgs: Record<string, string> = {
        invalid_credentials: "Incorrect username or password.",
        user_disabled: "This account is disabled. Contact your administrator.",
        account_locked: "Account temporarily locked due to too many failed attempts.",
        rate_limit_exceeded: "Too many attempts. Wait a minute and try again.",
        login_failed: "Could not reach the server. Check your connection.",
      };
      setError(msgs[code] ?? `Login failed (${code})`);
      const le = err as LoginError;
      if (le.attemptsRemaining !== undefined && le.attemptsRemaining >= 0)
        setHint(`${le.attemptsRemaining} attempt${le.attemptsRemaining !== 1 ? "s" : ""} remaining.`);
      setShaking(true);
    } finally {
      setLoading(false);
    }
  };

  const handleMfa = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (useBackup) await verifyMfaBackupCode(backupCode);
      else await verifyMfa(mfaToken);
      navigate({ to: "/" });
    } catch (err) {
      const code = err instanceof Error ? err.message : "mfa_failed";
      setError(
        code === "invalid_mfa_token"
          ? "Incorrect code. Try again."
          : code === "invalid_backup_code"
            ? "Incorrect backup code."
            : "Verification failed. Try again.",
      );
      setShaking(true);
    } finally {
      setLoading(false);
    }
  };

  const mood: ChickenMood = signedIn
    ? "happy"
    : shaking
      ? "error"
      : pwFocused && !showPw
        ? "shy"
        : "idle";

  return (
    <div className="relative min-h-dvh overflow-hidden" style={{ background: "var(--surface-page)" }}>
      {/* Colour fields for the glass to frost */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div
          className="animate-drift-slow absolute -left-24 top-[12%] h-[26rem] w-[26rem] rounded-full blur-3xl sm:h-[34rem] sm:w-[34rem]"
          style={{ background: "color-mix(in srgb, var(--brand) 20%, transparent)" }}
        />
        <div
          className="animate-drift-slower absolute -bottom-32 -right-24 h-[24rem] w-[24rem] rounded-full blur-3xl sm:h-[30rem] sm:w-[30rem]"
          style={{ background: "color-mix(in srgb, var(--cv-accent) 12%, transparent)" }}
        />
      </div>

      {/* Top bar: wordmark + theme */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="flex items-center gap-2.5">
          <CerebroilLogo size={32} />
          <span className="font-display text-base font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Cerebroil
          </span>
        </div>
        <ThemeToggle />
      </header>

      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col items-center justify-center px-4 pb-10 pt-24 lg:flex-row lg:gap-20 lg:px-8 lg:py-16">
        {/* Phones/tablets: perched on the card's top edge. Desktop: stands beside it. */}
        <div className="relative z-20 -mb-[9px] w-28 sm:w-32 lg:mb-0 lg:w-[22rem]">
          <div className="lg:hidden">
            <Chicken mood={mood} showGround={false} />
          </div>
          <div className="hidden lg:block">
            <Chicken mood={mood} />
          </div>
        </div>

        <div className="relative z-10 w-full max-w-[380px]">
          <div
            className={`rounded-3xl p-6 sm:p-8 ${shaking ? "animate-card-shake" : ""}`}
            style={glassCard}
            onAnimationEnd={(e) => {
              if (e.animationName === "cardShake") setShaking(false);
            }}
          >
            {signedIn ? (
              /* ── Success ── */
              <div role="status" className="flex flex-col items-center gap-3 py-8 text-center">
                <div
                  className="animate-success-pop flex h-14 w-14 items-center justify-center rounded-full"
                  style={{ background: "var(--brand-muted)" }}
                >
                  <svg className="h-7 w-7" style={{ color: "var(--brand)" }} fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.5l5 5 10-11" />
                  </svg>
                </div>
                <h1 className="font-display text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
                  Signed in
                </h1>
              </div>
            ) : !mfaPending ? (
              <>
                <h1 className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
                  Sign in
                </h1>
                <p className="mt-1.5 text-sm" style={{ color: "var(--text-tertiary)" }}>
                  Demo access{" "}
                  <span className="font-mono text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                    admin / admin
                  </span>
                </p>

                {error && (
                  <div
                    role="alert"
                    className="mt-5 rounded-xl px-3.5 py-3 text-sm animate-spring-in"
                    style={{ background: "var(--status-red-bg)", border: "1px solid var(--status-red-border)" }}
                  >
                    <p className="font-medium" style={{ color: "var(--status-red-text)" }}>{error}</p>
                    {hint && (
                      <p className="mt-0.5 font-mono text-[11px] tabular-nums" style={{ color: "var(--status-red)" }}>
                        {hint}
                      </p>
                    )}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
                  <div>
                    <label htmlFor="login-username" className="mb-1.5 block text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                      Username
                    </label>
                    <input
                      ref={usernameRef}
                      id="login-username"
                      type="text"
                      required
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="admin"
                      className={fieldClass}
                    />
                  </div>

                  <div>
                    <label htmlFor="login-password" className="mb-1.5 block text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="login-password"
                        type={showPw ? "text" : "password"}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onFocus={() => setPwFocused(true)}
                        onBlur={() => setPwFocused(false)}
                        placeholder="••••••••"
                        className={`${fieldClass} pr-12`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((p) => !p)}
                        className="tactile-btn absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg transition-colors hover:text-[color:var(--text-primary)]"
                        style={{ color: "var(--text-tertiary)" }}
                        aria-label={showPw ? "Hide password" : "Show password"}
                        aria-pressed={showPw}
                      >
                        {showPw ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </div>

                  <button type="submit" disabled={loading} className={`${primaryBtnClass} mt-2`}>
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <Spinner />
                        Signing in
                      </span>
                    ) : (
                      "Sign in"
                    )}
                  </button>
                </form>
              </>
            ) : (
              /* ── Two-step verification ── */
              <>
                <h1 className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
                  Verify it's you
                </h1>
                <p className="mt-1.5 text-sm" style={{ color: "var(--text-tertiary)" }}>
                  {useBackup ? "Enter a backup code." : "Enter the 6-digit code from your authenticator."}
                </p>

                {error && (
                  <div
                    role="alert"
                    className="mt-5 rounded-xl px-3.5 py-3 text-sm font-medium animate-spring-in"
                    style={{ background: "var(--status-red-bg)", border: "1px solid var(--status-red-border)", color: "var(--status-red-text)" }}
                  >
                    {error}
                  </div>
                )}

                <form onSubmit={handleMfa} className="mt-6 space-y-4">
                  <label htmlFor="login-mfa" className="sr-only">
                    {useBackup ? "Backup code" : "Verification code"}
                  </label>
                  {useBackup ? (
                    <input
                      id="login-mfa"
                      type="text"
                      required
                      autoComplete="off"
                      value={backupCode}
                      onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                      placeholder="XXXXXXXXXX"
                      className={`${fieldClass} text-center font-mono tracking-widest`}
                    />
                  ) : (
                    <input
                      id="login-mfa"
                      type="text"
                      required
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={9}
                      value={mfaToken}
                      onChange={(e) => setMfaToken(e.target.value.replace(/\D/g, ""))}
                      placeholder="000 000"
                      className={`${fieldClass} text-center font-mono text-lg tracking-[0.3em] tabular-nums`}
                    />
                  )}

                  <button type="submit" disabled={loading} className={primaryBtnClass}>
                    {loading ? "Verifying" : "Verify"}
                  </button>

                  <div className="flex justify-between text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setUseBackup((v) => !v);
                        setError(null);
                      }}
                      className="tap font-medium hover:underline"
                      style={{ color: "var(--brand)" }}
                    >
                      {useBackup ? "Use authenticator" : "Use backup code"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMfaPending(false);
                        setError(null);
                      }}
                      className="tap font-medium hover:underline"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>

          {!signedIn && !mfaPending && (
            <p className="mt-5 text-center text-xs" style={{ color: "var(--text-tertiary)" }}>
              No account?{" "}
              <a
                href="mailto:support@cerebroil.dev?subject=Account%20Request"
                className="font-medium hover:underline"
                style={{ color: "var(--brand)" }}
              >
                Contact admin
              </a>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

/* ── Icons ───────────────────────────────────────────────────────── */
function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
      />
    </svg>
  );
}
