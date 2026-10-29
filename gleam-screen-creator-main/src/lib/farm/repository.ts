import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { formatMeasurement } from "./format";
import {
  activeIncident,
  farm,
  houseLabel,
  liveCamera,
  readingByCode,
} from "./dataset";
import type { ReportFinding } from "./types";

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
 * `getOperationsOverview`, `getGrowthAnalytics` and `getAlerts` below now call
 * the live packages/api REST API (same pattern `acknowledgeAlertFn` already
 * used for mutations) instead of the in-memory `farm` dataset. The others
 * (`getMonitoringReport`, `getVisualTelemetry`) are not converted yet — see
 * the project's phase2-remediation-log for what's still pending.
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
    weight: overview.weight,
    feed: overview.feed,
    flockStandardDeviationG: overview.flockStandardDeviationG,
    cohorts: growth.cohorts,
    volumetric: growth.volumetric,
    mortality: growth.mortality,
  };
});

/** Visual telemetry — live feed overlays, behaviour metrics, anomaly timeline. */
export const getVisualTelemetry = createServerFn({ method: "GET" }).handler(async () => {
  const camera = liveCamera();
  const cycleTotalDays = Math.round(
    (new Date(farm.cycle.projectedYieldDate).getTime() -
      new Date(farm.cycle.startDate).getTime()) /
      86_400_000,
  );

  return {
    camera: { ...camera, houseLabel: houseLabel(camera.houseId) },
    /** HUD readings for the house on camera. */
    hud: {
      temperature: readingByCode(`TEMP_${camera.houseId}`),
      humidity: readingByCode(`HUMID_${camera.houseId}`),
    },
    detections: farm.detections,
    clusterWarning: farm.clusterWarning,
    behavior: farm.behavior,
    weight: {
      actualAvgG: farm.weight.actualAvgG,
      standardG: farm.weight.standardG,
      variancePercent: farm.weight.variancePercent,
      estimationConfidencePercent: farm.weight.estimationConfidencePercent,
      sampleSize: farm.weight.sampleSize,
      status: farm.weight.status,
    },
    cycleDay: farm.cycle.day,
    /** Grow-out length used to show how far the cycle has progressed. */
    cycleTotalDays,
    timeline: farm.timeline,
  };
});

/** Intelligence — the auto-generated monitoring report and its evidence. */
export const getMonitoringReport = createServerFn({ method: "GET" }).handler(async () => {
  const incident = activeIncident();
  const nh3Current = readingByCode("NH3_H01");
  const temperature = readingByCode("TEMP_H01");
  const humidity = readingByCode("HUMID_H01");

  const findings: ReportFinding[] = [
    {
      id: "nh3-peak",
      parameter: "Ammonia NH3 (incident peak)",
      source: `${incident.peak.sensorId} / ${houseLabel(incident.houseId)}`,
      value: incident.peak.value,
      unit: incident.peak.unit,
      boundsLabel: `<= ${incident.peak.threshold} ${incident.peak.unit.toLowerCase()}`,
      status: "critical",
    },
    {
      id: "nh3-current",
      parameter: "Ammonia NH3 (current)",
      source: `${nh3Current.sensorId} / ${houseLabel(nh3Current.houseId)}`,
      value: nh3Current.value,
      unit: nh3Current.unit,
      boundsLabel: nh3Current.bounds.label,
      status: nh3Current.status,
    },
    {
      id: "temperature",
      parameter: "Temperature",
      source: `${temperature.sensorId} / ${houseLabel(temperature.houseId)}`,
      value: temperature.value,
      unit: temperature.unit,
      boundsLabel: temperature.bounds.label,
      status: temperature.status,
    },
    {
      id: "humidity",
      parameter: "Relative humidity",
      source: `${humidity.sensorId} / ${houseLabel(humidity.houseId)}`,
      value: humidity.value,
      unit: humidity.unit,
      boundsLabel: humidity.bounds.label,
      status: humidity.status,
    },
    {
      id: "weight",
      parameter: "Average bird weight",
      source: `SCALE / ${farm.facility.houseRange}`,
      value: farm.weight.actualAvgG,
      unit: "g",
      boundsLabel: `STD ${formatMeasurement(farm.weight.standardG, "g")}`,
      status: farm.weight.status,
    },
  ];

  return {
    report: farm.report,
    platform: farm.platform,
    facility: {
      name: farm.facility.name,
      houseRange: farm.facility.houseRange,
    },
    cycle: farm.cycle,
    incident: {
      ...incident,
      houseLabel: houseLabel(incident.houseId),
    },
    findings,
    references: farm.references,
    archive: farm.archive,
  };
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
