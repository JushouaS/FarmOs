import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useRef, type FormEvent } from "react";
import { useAuth, MfaRequiredError, type LoginError } from "@/lib/auth-context";
import { broilers, flockPopulation, modelTelemetry } from "@/lib/farm/dataset";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign In - Cerebroil" },
      { name: "description", content: "Sign in to Cerebroil CV Flock Monitor." },
    ],
  }),
  component: LoginPage,
});

/* ── Themed tokens: resolves to the correct palette in both modes ─── */
const T = {
  pageBg: "var(--surface-page)",
  cardBg: "var(--surface-card)",
  raised: "var(--surface-raised)",
  sunken: "var(--surface-sunken)",
  borderSubtle: "var(--border-subtle)",
  borderDefault: "var(--border-default)",
  borderStrong: "var(--border-strong)",
  textPrimary: "var(--text-primary)",
  textSecondary: "var(--text-secondary)",
  textTertiary: "var(--text-tertiary)",
  textDisabled: "var(--text-disabled)",
  textInverse: "var(--text-inverse)",
  brand: "var(--brand)",
  brandHover: "var(--brand-hover)",
  brandMuted: "var(--brand-muted)",
  cvAccent: "var(--cv-accent)",
  sidebarBg: "var(--sidebar-bg)",
  sidebarText: "var(--sidebar-text)",
  sidebarMuted: "var(--sidebar-muted)",
  sidebarActiveText: "var(--sidebar-active-text)",
  statusRedBg: "var(--status-red-bg)",
  statusRedBorder: "var(--status-red-border)",
  statusRed: "var(--status-red)",
  statusRedText: "var(--status-red-text)",
} as const;

/* ── Live telemetry ticker ─────────────────────────────────────────
 * Cycles stats from the same farm dataset the dashboard renders, so
 * the numbers stay consistent with the product's data (no invented
 * figures). Purpose: show the real-time stream this product delivers. */
interface TickerStat {
  label: string;
  value: string;
}

function useTelemetryTicker(): TickerStat {
  const stats = useMemo<TickerStat[]>(() => {
    const avgWeightG = Math.round(
      broilers.reduce((sum, b) => sum + b.weightG, 0) / broilers.length,
    );
    return [
      { label: "BIRDS TRACKED", value: `${flockPopulation()}` },
      { label: "AVG WEIGHT", value: `${avgWeightG} g` },
      { label: "INFERENCE", value: `${modelTelemetry.inferenceMs} ms` },
      { label: "STREAM", value: `${modelTelemetry.fps} fps` },
    ];
  }, []);

  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setIndex((v) => (v + 1) % stats.length),
      2600,
    );
    return () => clearInterval(id);
  }, [stats.length]);

  return stats[index % stats.length]!;
}

function TelemetryStrip() {
  const stat = useTelemetryTicker();
  const pipelineLive = modelTelemetry.pipelineStatus === "ACTIVE";

  return (
    <div
      className="flex items-center gap-2 rounded-lg px-3 py-2 animate-spring-in"
      style={{
        animationDelay: "440ms",
        background: `color-mix(in srgb, ${T.sidebarActiveText} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${T.sidebarActiveText} 14%, transparent)`,
      }}
      aria-label={`Pipeline ${modelTelemetry.pipelineStatus.toLowerCase()}, streaming telemetry`}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {pipelineLive && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            style={{ background: T.sidebarActiveText }}
          />
        )}
        <span
          className="relative inline-flex h-2.5 w-2.5 rounded-full"
          style={{ background: T.sidebarActiveText }}
        />
      </span>
      <span
        className="font-mono text-[11px] font-semibold tracking-wide"
        style={{ color: T.sidebarActiveText }}
      >
        {`PIPELINE ${modelTelemetry.pipelineStatus}`}
      </span>
      <span style={{ color: T.sidebarMuted }}>|</span>
      {/* key remount replays the ticker-in animation on each new value */}
      <span
        key={stat.label}
        className="animate-ticker-in inline-block min-w-[19ch] font-mono text-[11px] font-semibold tabular-nums"
        style={{ color: T.sidebarText }}
      >
        {stat.label} {stat.value}
      </span>
    </div>
  );
}

/* ── Animated Metric Pill ────────────────────────────────────────── */
function MetricPill({
  tag,
  desc,
  delay,
}: {
  tag: string;
  desc: string;
  delay: number;
}) {
  return (
    <li
      className="flex items-start gap-3 animate-spring-in"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span
        className="mt-0.5 shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide tabular-nums"
        style={{
          background: `color-mix(in srgb, ${T.sidebarActiveText} 14%, transparent)`,
          color: T.sidebarActiveText,
          border: `1px solid color-mix(in srgb, ${T.sidebarActiveText} 22%, transparent)`,
        }}
      >
        {tag}
      </span>
      <span
        className="text-sm leading-snug text-pretty"
        style={{ color: T.sidebarText }}
      >
        {desc}
      </span>
    </li>
  );
}

/* ── Floating Grid Dot Pattern (identity motif: monitoring grid) ─── */
function GridPattern() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.035]"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
    </svg>
  );
}

/* ── Theme Toggle ────────────────────────────────────────────────── */
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
      className="tactile-btn absolute right-6 top-6 flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
      style={{
        color: T.textTertiary,
        background: T.raised,
        border: `1px solid ${T.borderSubtle}`,
      }}
      aria-label="Toggle theme"
      title="Toggle light/dark mode"
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
  // Set before login() resolves so the routing effect below can tell a
  // fresh sign-in (show the success beat first) from a user who was
  // already signed in when they opened /login (route away immediately).
  const signedInHere = useRef(false);

  const [mfaPending, setMfaPending] = useState(false);
  const [mfaToken, setMfaToken] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [backupCode, setBackupCode] = useState("");

  const [usernameFocused, setUsernameFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

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
        account_locked:
          "Account temporarily locked due to too many failed attempts.",
        login_failed: "Could not reach the server. Check your connection.",
      };
      setError(msgs[code] ?? `Login failed (${code})`);
      const le = err as LoginError;
      if (
        le.attemptsRemaining !== undefined &&
        le.attemptsRemaining >= 0
      )
        setHint(
          `${le.attemptsRemaining} attempt${le.attemptsRemaining !== 1 ? "s" : ""} remaining.`
        );
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
            : "Verification failed. Try again."
      );
      setShaking(true);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    background: T.sunken,
    color: T.textPrimary,
    border: `1px solid ${T.borderDefault}`,
  };

  const inputFocusStyle = {
    background: T.sunken,
    color: T.textPrimary,
    border: `1px solid ${T.brand}`,
    boxShadow: `0 0 0 3px ${T.brandMuted}`,
  };

  return (
    <div
      className="relative flex min-h-screen"
      style={{ background: T.pageBg }}
    >
      {/* ─── Left Panel: Brand Showcase ─────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-5/12 flex-col justify-between relative overflow-hidden p-12"
        style={{
          background: T.sidebarBg,
          borderRight: `1px solid color-mix(in srgb, ${T.sidebarActiveText} 10%, transparent)`,
        }}
      >
        {/* Subtle grid texture */}
        <GridPattern />

        {/* Drifting ambient glows (2 elements only, slow loop) */}
        <div
          className="animate-drift-slow pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full blur-3xl"
          style={{
            background: `radial-gradient(circle, color-mix(in srgb, ${T.sidebarActiveText} 8%, transparent), transparent 70%)`,
          }}
        />
        <div
          className="animate-drift-slower pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full blur-3xl"
          style={{
            background: `radial-gradient(circle, color-mix(in srgb, ${T.sidebarActiveText} 5%, transparent), transparent 70%)`,
          }}
        />

        {/* Brand Header */}
        <div className="relative z-10 flex items-center gap-3 animate-spring-in">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl elevation-1"
            style={{
              background: `linear-gradient(135deg, ${T.sidebarActiveText}, color-mix(in srgb, ${T.sidebarActiveText} 75%, #059669))`,
            }}
          >
            <svg
              className="h-6 w-6"
              style={{ color: "#020617" }}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="4" />
              <path
                strokeLinecap="round"
                d="M3 9l2-3h14l2 3M3 9v9a2 2 0 002 2h14a2 2 0 002-2V9"
              />
              <circle
                cx="12"
                cy="12"
                r="1.5"
                fill="currentColor"
                stroke="none"
              />
            </svg>
          </div>
          <div>
            <div className="font-display text-xl font-bold tracking-tight text-white text-balance">
              Cerebroil
            </div>
            <div
              className="text-[11px] tracking-wide"
              style={{ color: T.sidebarMuted }}
            >
              Flock Monitor
            </div>
          </div>
        </div>

        {/* Feature Showcase */}
        <div className="relative z-10 space-y-8">
          <div>
            <h1 className="animate-spring-in text-[2.25rem] font-display font-extrabold leading-[1.15] tracking-tight text-white text-balance" style={{ animationDelay: "60ms" }}>
              Precision flock intelligence,
              <br />
              powered by smart monitoring.
            </h1>
            <p
              className="animate-spring-in mt-3 max-w-md text-sm leading-relaxed text-pretty"
              style={{ animationDelay: "120ms", color: T.sidebarText }}
            >
              Continuous bird tracking, weight estimation, and welfare telemetry in a single stream.
            </p>
          </div>

          {/* Animated capability list */}
          <ul className="space-y-2.5">
            <MetricPill tag="Detection" desc="Real-time multi-bird tracking and counting" delay={180} />
            <MetricPill tag="Weighing" desc="Continuous non-invasive weight estimation" delay={260} />
            <MetricPill tag="Activity" desc="Spatial localization & movement monitoring" delay={340} />
            <MetricPill tag="Alerts" desc="Automated anomaly & welfare alerts" delay={420} />
          </ul>

          {/* Live telemetry strip */}
          <TelemetryStrip />
        </div>

        {/* Footer */}
        <p
          className="relative z-10 font-mono text-[11px]"
          style={{ color: T.sidebarMuted }}
        >
          2025 Cerebroil // Thesis Project // Ross 308 Broiler Monitor
        </p>
      </div>

      {/* ─── Right Panel: Login Form ────────────────────────────────── */}
      <div className="relative flex flex-1 items-center justify-center p-6 lg:p-12">
        {/* Theme toggle */}
        <ThemeToggle />

        {/* Subtle background radial gradient */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at 50% 30%, color-mix(in srgb, ${T.brand} 4%, transparent), transparent 60%)`,
          }}
        />

        <div className="relative z-10 w-full max-w-[380px]">
          {/* Mobile logo */}
          <div className="mb-10 flex items-center gap-3 lg:hidden animate-spring-in">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{
                background: `linear-gradient(135deg, ${T.brand}, ${T.brandHover})`,
              }}
            >
              <svg
                className="h-5 w-5"
                style={{ color: T.textInverse }}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="4" />
                <path
                  strokeLinecap="round"
                  d="M3 9l2-3h14l2 3M3 9v9a2 2 0 002 2h14a2 2 0 002-2V9"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="1.5"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
            </div>
            <div>
              <div
                className="font-display text-lg font-bold tracking-tight"
                style={{ color: T.textPrimary }}
              >
                Cerebroil
              </div>
              <div
                className="font-mono text-[11px]"
                style={{ color: T.textTertiary }}
              >
                CV Flock Monitor
              </div>
            </div>
          </div>

          {/* Login Card: outer div runs the entrance, inner div the shake */}
          <div className="animate-spring-in" style={{ animationDelay: "200ms" }}>
            <div
              className={`rounded-2xl p-8 elevation-2 ${shaking ? "animate-card-shake" : ""}`}
              style={{
                background: T.cardBg,
                border: `1px solid ${T.borderDefault}`,
              }}
              onAnimationEnd={(e) => {
                if (e.animationName === "cardShake") setShaking(false);
              }}
            >
              {signedIn ? (
                /* ── Success state: confirm the action landed ──────── */
                <div className="flex flex-col items-center gap-4 py-6 text-center">
                  <div
                    className="animate-success-pop flex h-14 w-14 items-center justify-center rounded-full"
                    style={{
                      background: T.brandMuted,
                      border: `1px solid color-mix(in srgb, ${T.brand} 20%, transparent)`,
                    }}
                  >
                    <svg
                      className="h-7 w-7"
                      style={{ color: T.brand }}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.4}
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.5l5 5 10-11" />
                    </svg>
                  </div>
                  <div>
                    <h2
                      className="font-display text-xl font-bold tracking-tight text-balance"
                      style={{ color: T.textPrimary }}
                    >
                      Signed in
                    </h2>
                    <p
                      className="mt-1.5 text-sm"
                      style={{ color: T.textTertiary }}
                    >
                      Opening your dashboard...
                    </p>
                  </div>
                </div>
              ) : !mfaPending ? (
                <>
                  {/* Header */}
                  <div className="mb-6">
                    <h2
                      className="font-display text-2xl font-bold tracking-tight text-balance"
                      style={{ color: T.textPrimary }}
                    >
                      Welcome back
                    </h2>
                    <p
                      className="mt-1.5 text-sm text-pretty"
                      style={{ color: T.textTertiary }}
                    >
                      Sign in to access your Cerebroil monitoring dashboard.
                    </p>
                  </div>

                  {/* Demo access: the credentials this deployment accepts */}
                  <div
                    className="mb-6 flex items-center justify-between gap-3 rounded-lg px-3 py-2 animate-spring-in"
                    style={{
                      animationDelay: "480ms",
                      background: T.sunken,
                      border: `1px solid ${T.borderSubtle}`,
                    }}
                  >
                    <span className="label-section">Demo access</span>
                    <span
                      className="font-mono text-[11px] font-semibold tabular-nums"
                      style={{ color: T.textSecondary }}
                    >
                      admin / admin
                    </span>
                  </div>

                  {/* Error Alert */}
                  {error && (
                    <div
                      role="alert"
                      className="mb-5 flex items-start gap-3 rounded-xl p-3.5 animate-spring-in"
                      style={{
                        background: T.statusRedBg,
                        border: `1px solid ${T.statusRedBorder}`,
                      }}
                    >
                      <svg
                        className="mt-0.5 h-4 w-4 shrink-0"
                        style={{ color: T.statusRed }}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 8v4m0 4h.01"
                        />
                      </svg>
                      <div>
                        <p
                          className="text-sm font-medium"
                          style={{ color: T.statusRedText }}
                        >
                          {error}
                        </p>
                        {hint && (
                          <p
                            className="mt-0.5 font-mono text-[11px] tabular-nums"
                            style={{ color: T.statusRed }}
                          >
                            {hint}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                    {/* Username Field */}
                    <div className="animate-spring-in" style={{ animationDelay: "320ms" }}>
                      <label
                        htmlFor="login-username"
                        className="mb-2 block text-sm font-semibold"
                        style={{ color: T.textPrimary }}
                      >
                        Username
                      </label>
                      <input
                        id="login-username"
                        type="text"
                        required
                        autoFocus
                        autoComplete="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onFocus={() => setUsernameFocused(true)}
                        onBlur={() => setUsernameFocused(false)}
                        placeholder="admin"
                        className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all duration-150"
                        style={usernameFocused ? inputFocusStyle : inputStyle}
                      />
                    </div>

                    {/* Password Field */}
                    <div className="animate-spring-in" style={{ animationDelay: "400ms" }}>
                      <label
                        htmlFor="login-password"
                        className="mb-2 block text-sm font-semibold"
                        style={{ color: T.textPrimary }}
                      >
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
                          onFocus={() => setPasswordFocused(true)}
                          onBlur={() => setPasswordFocused(false)}
                          placeholder="Enter your password"
                          className="w-full rounded-xl px-4 py-3 pr-11 text-sm outline-none transition-all duration-150"
                          style={
                            passwordFocused ? inputFocusStyle : inputStyle
                          }
                        />
                        <button
                          type="button"
                          onClick={() => setShowPw((p) => !p)}
                          className="tactile-btn absolute right-3.5 top-1/2 -translate-y-1/2 transition-colors"
                          style={{ color: T.textTertiary }}
                          aria-label={showPw ? "Hide password" : "Show password"}
                        >
                          {showPw ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                      </div>
                    </div>

                    {/* Submit Button */}
                    <button
                      type="submit"
                      disabled={loading}
                      className="tactile-btn animate-spring-in w-full rounded-xl py-3 text-sm font-semibold transition-all duration-150"
                      style={{
                        animationDelay: "480ms",
                        background: loading
                          ? T.brandHover
                          : `linear-gradient(135deg, ${T.brand}, ${T.brandHover})`,
                        color: T.textInverse,
                        opacity: loading ? 0.8 : 1,
                        boxShadow: `0 2px 8px color-mix(in srgb, ${T.brand} 30%, transparent)`,
                      }}
                    >
                      {loading ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg
                            className="h-4 w-4 animate-spin"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                          Signing in...
                        </span>
                      ) : (
                        "Sign In"
                      )}
                    </button>
                  </form>

                  {/* Separator */}
                  <div className="my-6 flex items-center gap-3">
                    <div
                      className="h-px flex-1"
                      style={{ background: T.borderSubtle }}
                    />
                    <span
                      className="text-[11px] font-medium uppercase tracking-wider"
                      style={{ color: T.textDisabled }}
                    >
                      or
                    </span>
                    <div
                      className="h-px flex-1"
                      style={{ background: T.borderSubtle }}
                    />
                  </div>

                  {/* Contact Admin */}
                  <p
                    className="text-center text-xs"
                    style={{ color: T.textTertiary }}
                  >
                    No account?{" "}
                    <a
                      href="mailto:support@cerebroil.dev?subject=Account%20Request"
                      className="tactile-btn font-medium hover:underline"
                      style={{ color: T.brand }}
                    >
                      Contact administrator
                    </a>
                  </p>
                </>
              ) : (
                /* ── MFA / Two-Step Verification ──────────────────────── */
                <>
                  <div className="mb-7">
                    <div className="mb-3 flex items-center gap-2">
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-xl"
                        style={{
                          background: T.brandMuted,
                          border: `1px solid color-mix(in srgb, ${T.brand} 20%, transparent)`,
                        }}
                      >
                        <svg
                          className="h-4 w-4"
                          style={{ color: T.brand }}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                        >
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0110 0v4" />
                        </svg>
                      </div>
                    </div>
                    <h2
                      className="font-display text-xl font-bold tracking-tight text-balance"
                      style={{ color: T.textPrimary }}
                    >
                      Two-Step Verification
                    </h2>
                    <p
                      className="mt-1.5 text-sm text-pretty"
                      style={{ color: T.textTertiary }}
                    >
                      {useBackup
                        ? "Enter a backup code to continue."
                        : "Enter the 6-digit code from your authenticator app."}
                    </p>
                  </div>

                  {error && (
                    <div
                      className="mb-5 rounded-xl p-3.5 text-sm font-medium animate-spring-in"
                      style={{
                        background: T.statusRedBg,
                        border: `1px solid ${T.statusRedBorder}`,
                        color: T.statusRedText,
                      }}
                    >
                      {error}
                    </div>
                  )}

                  <form onSubmit={handleMfa} className="space-y-5">
                    <div>
                      <label
                        className="mb-2 block text-sm font-semibold"
                        style={{ color: T.textPrimary }}
                      >
                        {useBackup ? "Backup Code" : "Verification Code"}
                      </label>
                      {useBackup ? (
                        <input
                          type="text"
                          required
                          autoComplete="off"
                          value={backupCode}
                          onChange={(e) =>
                            setBackupCode(e.target.value.toUpperCase())
                          }
                          placeholder="XXXXXXXXXX"
                          className="w-full rounded-xl px-4 py-3 text-center font-mono text-sm tracking-widest outline-none transition-all duration-150"
                          style={inputStyle}
                        />
                      ) : (
                        <input
                          type="text"
                          required
                          inputMode="numeric"
                          maxLength={9}
                          value={mfaToken}
                          onChange={(e) =>
                            setMfaToken(e.target.value.replace(/\D/g, ""))
                          }
                          placeholder="000 000"
                          className="w-full rounded-xl px-4 py-3.5 text-center font-mono text-lg tracking-[0.3em] outline-none transition-all duration-150 tabular-nums"
                          style={inputStyle}
                        />
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="tactile-btn w-full rounded-xl py-3 text-sm font-semibold transition-all duration-150"
                      style={{
                        background: `linear-gradient(135deg, ${T.brand}, ${T.brandHover})`,
                        color: T.textInverse,
                        opacity: loading ? 0.8 : 1,
                        boxShadow: `0 2px 8px color-mix(in srgb, ${T.brand} 30%, transparent)`,
                      }}
                    >
                      {loading ? "Verifying..." : "Verify and Sign In"}
                    </button>

                    <div className="flex justify-between text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setUseBackup((v) => !v);
                          setError(null);
                        }}
                        className="tactile-btn font-medium hover:underline"
                        style={{ color: T.brand }}
                      >
                        {useBackup ? "Use authenticator" : "Use backup code"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMfaPending(false);
                          setError(null);
                        }}
                        className="tactile-btn font-medium hover:underline"
                        style={{ color: T.statusRed }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>

          {/* Security notice */}
          <div className="mt-5 flex items-center justify-center gap-2">
            <svg
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: T.textDisabled }}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            <span
              className="text-[11px]"
              style={{ color: T.textDisabled }}
            >
              Your session stays on this device until you sign out.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Icon Components ─────────────────────────────────────────────── */
function EyeIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
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
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
      />
    </svg>
  );
}
