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
 * Falls back to `http://localhost:4000` which matches the default
 * `packages/api` configuration.
 *
 * Authentication is carried in httpOnly, Secure, SameSite=Strict cookies
 * issued by the API. The frontend never stores tokens in localStorage.
 * Exception: the local admin account (below) persists its demo session
 * profile (not a token) so a page refresh keeps the user signed in while
 * no backend is running.
 */
const API_BASE =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_API_URL) ||
  "http://localhost:4000";

const fetchOpts: RequestInit = { credentials: "include" };

/* ── Local admin account ────────────────────────────────────────
 * Checked before the API so the dashboard is reachable even when
 * no backend is running. Username "admin", password "admin". */
const LOCAL_USERNAME = "admin";
const LOCAL_PASSWORD = "admin";
const SESSION_KEY = "cb-auth-session";

function readLocalSession(): AuthUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (parsed && typeof parsed.id === "string" && typeof parsed.email === "string") {
      return parsed;
    }
  } catch {
    /* corrupt or unavailable storage — treat as no session */
  }
  return null;
}

function writeLocalSession(user: AuthUser | null) {
  try {
    if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable — session just won't survive a refresh */
  }
}

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string | null;
  roles: string[];
  permissions: string[];
}

export class MfaRequiredError extends Error {
  constructor() {
    super("mfa_required");
    this.name = "MfaRequiredError";
  }
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

  // Hydrate from the session cookie on first mount, falling back to the
  // persisted local admin session when the API is unreachable.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, fetchOpts);
        if (res.ok) {
          const data = await res.json();
          setUser({
            id: data.user.id,
            email: data.user.email,
            fullName: data.user.full_name ?? data.user.fullName ?? null,
            roles: data.roles,
            permissions: data.permissions,
          });
          setIsLoading(false);
          return;
        }
      } catch {
        // Network down — fall through to the local session.
      }
      const local = readLocalSession();
      if (local) setUser(local);
      setIsLoading(false);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    // Local admin account: works with or without a running backend.
    const username = email.trim().toLowerCase();
    if (username === LOCAL_USERNAME) {
      if (password !== LOCAL_PASSWORD) {
        const err: LoginError = new Error("invalid_credentials");
        throw err;
      }
      const adminUser: AuthUser = {
        id: "admin",
        email: "admin",
        fullName: "Farm Administrator",
        roles: ["ADMIN"],
        permissions: [],
      };
      writeLocalSession(adminUser);
      setUser(adminUser);
      return;
    }

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
      const err: LoginError = new Error(
        (body as Record<string, string>).error ?? "login_failed",
      );
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
    });
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
      throw new Error((body as Record<string, string>).error ?? "mfa_failed");
    }
    const data = await res.json();
    setUser({
      id: data.user.id,
      email: data.user.email,
      roles: data.user.roles,
      permissions: data.user.permissions,
    });
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
    });
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
    writeLocalSession(null);
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
    }),
    [user, isLoading, login, verifyMfa, verifyMfaBackupCode, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
