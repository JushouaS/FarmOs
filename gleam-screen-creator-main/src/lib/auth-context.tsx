import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * The API base URL is read from the Vite env variable `VITE_API_URL`.
 * Falls back to port 4000 on whatever host served the page, so opening the
 * app from another device on the network (http://<lan-ip>:8080) reaches
 * this machine's API rather than that device's own localhost.
 *
 * Authentication is carried in httpOnly, Secure, SameSite=Strict cookies
 * issued by the API. The frontend never stores tokens in localStorage.
 */
const API_BASE =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_API_URL) ||
  (typeof window !== "undefined"
    ? window.location.protocol === "https:"
      ? // A public https address (see scripts/public-gateway.mjs): the API is behind the same address, under /api.
        `${window.location.origin}/api`
      : `${window.location.protocol}//${window.location.hostname}:4000`
    : "http://localhost:4000");

const fetchOpts: RequestInit = { credentials: "include" };

/* An older version of this app could sign in an offline "admin" with no server behind it. Nothing accepts that any
 * more, so any session or agreement it left in this browser is removed. */
try {
  localStorage.removeItem("cb-auth-session");
  localStorage.removeItem("cb-privacy-accepted");
} catch {
  /* no storage here (server render, or blocked): nothing to remove */
}

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string | null;
  /** Whether this person has agreed to the current Privacy Policy. Unknown (undefined) until the server says. */
  privacyAccepted?: boolean;
  /** Signed in with a temporary password: the next thing they must do is choose their own. */
  mustChangePassword?: boolean;
  /** The language the Live Camera analysis shows in (Settings > Account). */
  analysisLanguage?: "en" | "tl" | "ceb";
  roles: string[];
  permissions: string[];
}

export class MfaRequiredError extends Error {
  constructor() {
    super("mfa_required");
    this.name = "MfaRequiredError";
  }
}

/**
 * The machine-readable code for a failed auth call. A 429 is the one case the
 * body can't be trusted for: Fastify writes its own payload for rate-limit
 * rejections and puts the status phrase in `error`, so trust the status first.
 */
function authErrorCode(res: Response, body: unknown, fallback: string): string {
  if (res.status === 429) return "rate_limit_exceeded";
  return (body as Record<string, string> | null)?.error ?? fallback;
}

export interface LoginError extends Error {
  attemptsRemaining?: number;
  lockedUntil?: string;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  verifyMfa: (token: string) => Promise<void>;
  verifyMfaBackupCode: (code: string) => Promise<number>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  /** Record that the signed-in person agrees to the current Privacy Policy. */
  acceptPrivacy: () => Promise<void>;
  /** Change the signed-in person's name and/or analysis language. */
  updateProfile: (patch: { fullName?: string; analysisLanguage?: "en" | "tl" | "ceb" }) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // A sign-in response carries the roles but not the name or language, so ask for them.
  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, fetchOpts);
      if (!res.ok) return;
      const data = await res.json();
      setUser((prev) =>
        prev
          ? {
              ...prev,
              fullName: data.user.full_name ?? prev.fullName ?? null,
              analysisLanguage: data.user.analysis_language ?? prev.analysisLanguage,
              privacyAccepted: data.user.privacy_accepted ?? prev.privacyAccepted,
              mustChangePassword: data.user.must_change_password ?? prev.mustChangePassword,
            }
          : prev,
      );
    } catch {
      /* the name appears after the next page load */
    }
  }, []);

  // Hydrate from the session cookie on first mount, falling back to the
  // persisted local admin session when the API is unreachable.
  useEffect(() => {
    (async () => {
      try {
        let res = await fetch(`${API_BASE}/auth/me`, fetchOpts);
        if (res.status === 401) {
          // The 15 minute access token may have lapsed while the 30 day refresh
          // token is still good: renew it rather than sending the person to /login.
          const renewed = await fetch(`${API_BASE}/auth/refresh`, { method: "POST", credentials: "include" }).catch(() => null);
          if (renewed?.ok) res = await fetch(`${API_BASE}/auth/me`, fetchOpts);
        }
        if (res.ok) {
          const data = await res.json();
          setUser({
            id: data.user.id,
            email: data.user.email,
            fullName: data.user.full_name ?? data.user.fullName ?? null,
            analysisLanguage: data.user.analysis_language ?? undefined,
            privacyAccepted: data.user.privacy_accepted ?? undefined,
            mustChangePassword: data.user.must_change_password ?? undefined,
            roles: data.roles,
            permissions: data.permissions,
          });
          setIsLoading(false);
          return;
        }
        // API is up but has no session for us.
        setIsLoading(false);
        return;
      } catch {
        // The API cannot be reached: nobody is signed in.
      }
      setIsLoading(false);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new Error("login_failed");
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err: LoginError = new Error(authErrorCode(res, body, "login_failed"));
      err.attemptsRemaining = (body as any).attemptsRemaining;
      err.lockedUntil = (body as any).lockedUntil;
      throw err;
    }
    const data = await res.json();
    if (data.mfaRequired) {
      throw new MfaRequiredError();
    }
    setUser({
      id: data.user.id,
      email: data.user.email,
      roles: data.user.roles,
      permissions: data.user.permissions,
      mustChangePassword: Boolean(data.user.mustChangePassword),
    });
    void loadProfile();
  }, []);

  const verifyMfa = useCallback(async (token: string) => {
    const res = await fetch(`${API_BASE}/auth/mfa/login-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(authErrorCode(res, body, "mfa_failed"));
    }
    const data = await res.json();
    setUser({
      id: data.user.id,
      email: data.user.email,
      roles: data.user.roles,
      permissions: data.user.permissions,
      mustChangePassword: Boolean(data.user.mustChangePassword),
    });
    void loadProfile();
  }, []);

  const verifyMfaBackupCode = useCallback(async (code: string): Promise<number> => {
    const res = await fetch(`${API_BASE}/auth/mfa/backup-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as Record<string, string>).error ?? "invalid_backup_code");
    }
    const data = await res.json();
    setUser({
      id: data.user.id,
      email: data.user.email,
      roles: data.user.roles,
      permissions: data.user.permissions,
      mustChangePassword: Boolean(data.user.mustChangePassword),
    });
    void loadProfile();
    return data.backupCodesRemaining ?? 0;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      /* swallow — server cookie clearing is best-effort */
    }
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        setUser(null);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const acceptPrivacy = useCallback(async () => {
    const send = () => fetch(`${API_BASE}/auth/privacy`, { method: "POST", credentials: "include" });
    let res = await send();
    if (res.status === 401) {
      const renewed = await fetch(`${API_BASE}/auth/refresh`, { method: "POST", credentials: "include" }).catch(() => null);
      if (renewed?.ok) res = await send();
    }
    if (!res.ok) throw new Error("privacy_not_saved");
    setUser((prev) => (prev ? { ...prev, privacyAccepted: true } : prev));
  }, []);

  const updateProfile = useCallback(async (patch: { fullName?: string; analysisLanguage?: "en" | "tl" | "ceb" }) => {
    const send = () =>
      fetch(`${API_BASE}/auth/me`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    let res = await send();
    if (res.status === 401) {
      // The 15 minute access cookie may have lapsed; renew it once and retry.
      const renewed = await fetch(`${API_BASE}/auth/refresh`, { method: "POST", credentials: "include" }).catch(() => null);
      if (renewed?.ok) res = await send();
    }
    if (!res.ok) throw new Error("profile_not_saved");
    const data = await res.json();
    setUser((prev) =>
      prev
        ? {
            ...prev,
            fullName: data.user.full_name ?? prev.fullName ?? null,
            analysisLanguage: data.user.analysis_language ?? prev.analysisLanguage,
          }
        : prev,
    );
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      login,
      verifyMfa,
      verifyMfaBackupCode,
      logout,
      refresh,
      acceptPrivacy,
      updateProfile,
    }),
    [user, isLoading, login, verifyMfa, verifyMfaBackupCode, logout, refresh, acceptPrivacy, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
