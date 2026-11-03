import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { isNightCycle } from "./lighting";
import { NO_SPREAD, type WeightSpread } from "./weights";

/**
 * Data access layer — the seam a real database plugs into.
 *
 * Each function is a TanStack server function, so it already runs on the server
 * for both SSR and client navigation. Pages consume these through route loaders
 * and never import the dataset for their figures, so no UI code changes when
 * the source changes.
 *
 * Contract for every handler:
 * - returns JSON-serializable data only (numbers, strings, ISO timestamps);
 * - returns raw values, not formatted strings (formatting lives in `format.ts`);
 * - is read-only and safe to call during render.
 *
 * Every function below calls the live packages/api REST API. There is no sample dataset behind any of them.
 */

const API_BASE =
  (typeof process !== "undefined" && process.env?.VITE_API_URL) ||
  "http://localhost:4000";

/**
 * The session cookie lives in the *browser's* jar, but every function below
 * is a TanStack server function: it runs server-side even when the client
 * calls it, so `fetch(..., { credentials: "include" })` has no browser cookie
 * jar to draw from and silently sends an unauthenticated request. We have to
 * read the inbound request's own Cookie header and forward it by hand.
 */
function forwardedCookieHeader(): Record<string, string> {
  try {
    const cookie = getRequestHeader("cookie");
    return cookie ? { cookie } : {};
  } catch {
    // No active request context (e.g. called outside a server fn) — proceed
    // unauthenticated rather than crashing the caller.
    return {};
  }
}

interface RenewedSession {
  /** The request's Cookie header with the new tokens swapped in, for the retry. */
  cookieHeader: string;
  /** The API's Set-Cookie lines, to hand on to the browser. */
  setCookies: string[];
}

// The access token lasts 15 minutes; the refresh token, 30 days. A refresh
// token works once (the API rotates it), so two requests that both hit an
// expired token must share ONE renewal: a second renewal with the used token
// would fail and sign the person out. Results are kept for a few seconds so a
// request that arrives just after still gets the new tokens.
const renewals = new Map<string, Promise<RenewedSession | null>>();
const RENEWAL_KEEP_MS = 10_000;

async function requestRenewal(cookie: string): Promise<RenewedSession | null> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/refresh`, { method: "POST", headers: { cookie } });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const setCookies = res.headers.getSetCookie();
  const fresh = new Map<string, string>();
  for (const line of setCookies) {
    const pair = line.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) fresh.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
  const kept = cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const name = part.slice(0, part.indexOf("="));
      return fresh.has(name) ? `${name}=${fresh.get(name)}` : part;
    });
  for (const [name, value] of fresh) {
    if (!kept.some((part) => part.startsWith(`${name}=`))) kept.push(`${name}=${value}`);
  }
  return { cookieHeader: kept.join("; "), setCookies };
}

function renewSession(cookie: string): Promise<RenewedSession | null> {
  let renewal = renewals.get(cookie);
  if (!renewal) {
    renewal = requestRenewal(cookie);
    renewals.set(cookie, renewal);
    setTimeout(() => renewals.delete(cookie), RENEWAL_KEEP_MS).unref?.();
  }
  return renewal;
}

/**
 * Shared fetch helper: forwards the session cookie, throws on non-2xx.
 * An expired access token is renewed once from the refresh token (and the new
 * cookies are sent on to the browser) before giving up. A 401 that survives
 * that redirects to /login — otherwise a signed-out visitor hits the root
 * error boundary before the client-side auth guard ever gets to run.
 */
async function apiGet<T>(path: string): Promise<T> {
  const cookie = forwardedCookieHeader().cookie;
  let res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: forwardedCookieHeader(),
  });
  if (res.status === 401 && cookie) {
    const renewed = await renewSession(cookie);
    if (renewed) {
      try {
        setResponseHeader("set-cookie", renewed.setCookies);
      } catch {
        /* no response context: the retry below still works for this request */
      }
      res = await fetch(`${API_BASE}${path}`, { headers: { cookie: renewed.cookieHeader } });
    }
  }
  if (res.status === 401) {
    throw redirect({ to: "/login" });
  }
  if (!res.ok) {
    throw new Error(`API ${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Settings — the signed-in user's saved notification preferences (one row per channel). */
export const getNotificationPreferences = createServerFn({ method: "GET" }).handler(async () => {
  return apiGet<any[]>("/notifications/preferences");
});

/** Dashboard — executive summary, activity index, KPI cards, alerts, sensors. */
export const getOperationsOverview = createServerFn({ method: "GET" }).handler(async () => {
  return apiGet<any>("/operations/overview");
});

/**
 * Analytics — growth curve, cohort distribution, volumetric sample.
 *
 * Pulls weight/feed/flockStandardDeviationG from /operations/overview (the
 * richer, already-computed figures) and cohorts/volumetric from
 * /growth/analytics, rather than duplicating that SQL in two routes.
 */
export const getGrowthAnalytics = createServerFn({ method: "GET" }).handler(async () => {
  const [overview, growth] = await Promise.all([
    apiGet<any>("/operations/overview"),
    apiGet<any>("/growth/analytics"),
  ]);

  return {
    cycle: overview.cycle,
    facility: overview.facility,
    houses: overview.houses,
    cluster: overview.cluster,
    weight: overview.weight,
    cohorts: growth.cohorts,
    volumetric: growth.volumetric,
    mortality: growth.mortality,
  };
});

/**
 * What the AI briefing is written from: the overview, the weights typed in, and the live behavior monitor.
 * Each part that cannot be read comes back empty, and the snapshot says so, instead of failing the page.
 */
export const getLiveSnapshotInputs = createServerFn({ method: "GET" }).handler(async () => {
  const overview = await apiGet<any>("/operations/overview");
  const night = isNightCycle(new Date(), overview?.lighting) ? 1 : 0;
  const [spread, behavior] = await Promise.all([
    apiGet<WeightSpread>("/growth/weight-spread").catch(() => NO_SPREAD),
    apiGet<any>(`/visual/behavior?night=${night}`).catch(() => ({ running: false })),
  ]);
  return { overview, spread, behavior };
});

/** Alerts — list with optional severity / acknowledged filters. */
export const getAlerts = createServerFn({ method: "GET" })
  .handler(async ({ data }) => {
    const input = (data ?? {}) as { severity?: string; acknowledged?: boolean };
    const params = new URLSearchParams();
    if (input.severity) params.set("severity", input.severity);
    if (input.acknowledged !== undefined) params.set("acknowledged", String(input.acknowledged));
    const qs = params.toString();
    // /alerts already returns exactly this shape (id/kind/severity/raisedAt/
    // message/acknowledged/acknowledgedAt/sourceIncidentId) — no reshaping needed.
    return apiGet<any>(`/alerts${qs ? `?${qs}` : ""}`);
  });

/** Alerts — mark an alert as acknowledged via the REST API. */
export const acknowledgeAlertFn = createServerFn({ method: "POST" })
  .handler(async ({ data }) => {
    // M-2: mutations go through the real REST API, not the in-memory dataset.
    // The api-client handles credentials via the httpOnly cookie.
    const { id } = (data ?? {}) as { id: string };
    const API_BASE =
      (typeof process !== "undefined" && process.env?.VITE_API_URL) ||
      "http://localhost:4000";
    const res = await fetch(`${API_BASE}/alerts/${id}/acknowledge`, {
      method: "POST",
      credentials: "include",
      headers: forwardedCookieHeader(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { updated: false, reason: (body as any).error ?? "request_failed" };
    }
    return res.json() as Promise<{ updated: boolean; id?: string; reason?: string }>;
  });

/** Alerts — dismiss an alert via the REST API. */
export const dismissAlertFn = createServerFn({ method: "POST" })
  .handler(async ({ data }) => {
    // M-2: mutations go through the real REST API, not the in-memory dataset.
    const { id } = (data ?? {}) as { id: string };
    const API_BASE =
      (typeof process !== "undefined" && process.env?.VITE_API_URL) ||
      "http://localhost:4000";
    const res = await fetch(`${API_BASE}/alerts/${id}/dismiss`, {
      method: "POST",
      credentials: "include",
      headers: forwardedCookieHeader(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { updated: false, reason: (body as any).error ?? "request_failed" };
    }
    return res.json() as Promise<{ updated: boolean; id?: string; reason?: string }>;
  });
