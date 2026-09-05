import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/farm/AppShell";
import { Icon } from "@/components/farm/Icon";
import { acknowledgeAlertFn, dismissAlertFn, getAlerts } from "@/lib/farm/repository";
import {
  STATUS_TONE,
  formatDateTimeUtc,
  formatTime,
} from "@/lib/farm/format";
import type { StatusLevel } from "@/lib/farm/types";

const TITLE = "System Alerts | CereBroiler";
const DESC = "Real-time alert stream with acknowledgement and dismissal controls.";

export const Route = createFileRoute("/alerts")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
    ],
  }),
  component: AlertsPage,
});

/* -------------------------------------------------------------------------- */
/*  Severity filter options                                                   */
/* -------------------------------------------------------------------------- */

const SEVERITIES = ["all", "critical", "warning", "optimal"] as const;
const ACK_FILTERS = [
  { value: "all", label: "ALL" },
  { value: "false", label: "PENDING" },
  { value: "true", label: "ACKNOWLEDGED" },
] as const;

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

/** Shape returned by the getAlerts server function. */
interface AlertRow {
  id: string;
  kind: string;
  severity: string;
  raisedAt: string;
  message: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  sourceIncidentId: string | null;
}

function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string>("all");
  const [ackFilter, setAckFilter] = useState<string>("all");
  const [mutating, setMutating] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const filters: { severity?: string; acknowledged?: boolean } = {};
      if (severity !== "all") filters.severity = severity;
      if (ackFilter !== "all") filters.acknowledged = ackFilter === "true";
      const data = await getAlerts({ data: filters } as never);
      setAlerts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alerts");
    } finally {
      setIsLoading(false);
    }
  }, [severity, ackFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAcknowledge = async (id: string) => {
    setMutating((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await acknowledgeAlertFn({ data: { id } } as never);
      if (result.updated) {
        setAlerts((prev) =>
          prev.map((a) =>
            a.id === id
              ? { ...a, acknowledged: true, acknowledgedAt: new Date().toISOString() }
              : a,
          ),
        );
      }
    } catch {
      /* keep the alert visible on failure */
    } finally {
      setMutating((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleDismiss = async (id: string) => {
    setMutating((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await dismissAlertFn({ data: { id } } as never);
      if (result.updated) {
        setAlerts((prev) => prev.filter((a) => a.id !== id));
      }
    } catch {
      /* keep visible */
    } finally {
      setMutating((prev) => ({ ...prev, [id]: false }));
    }
  };

  const pendingCount = alerts.filter((a) => !a.acknowledged).length;

  return (
    <AppShell>
      <div className="flex flex-col gap-6 p-6 lg:p-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Icon name="notification_important" size={28} className="text-primary" />
            <div>
              <h1 className="font-headline-md text-headline-md font-bold text-on-surface">
                SYSTEM_ALERTS
              </h1>
              <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
                {isLoading
                  ? "Loading..."
                  : `${alerts.length} alert${alerts.length !== 1 ? "s" : ""} · ${pendingCount} pending`}
              </p>
            </div>
          </div>
          <button
            onClick={load}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg border border-outline-variant px-4 py-2 font-label-caps text-label-caps text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
          >
            <Icon name="refresh" size={16} />
            REFRESH
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Severity chips */}
          <div className="flex items-center gap-2">
            <span className="font-label-caps text-[10px] tracking-[0.15em] text-outline">
              SEVERITY:
            </span>
            <div className="flex gap-1">
              {SEVERITIES.map((s) => {
                const isActive = severity === s;
                const tone = s !== "all" ? STATUS_TONE[s as StatusLevel] : null;
                return (
                  <button
                    key={s}
                    onClick={() => setSeverity(s)}
                    className={`rounded-md px-3 py-1 font-label-caps text-[10px] transition-all ${
                      isActive
                        ? tone
                          ? `${tone.chip} font-bold`
                          : "bg-primary/10 text-primary font-bold"
                        : "text-on-surface-variant hover:bg-surface-container-high"
                    }`}
                  >
                    {s.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Acknowledged filter */}
          <div className="flex items-center gap-2">
            <span className="font-label-caps text-[10px] tracking-[0.15em] text-outline">
              STATUS:
            </span>
            <div className="flex gap-1">
              {ACK_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setAckFilter(f.value)}
                  className={`rounded-md px-3 py-1 font-label-caps text-[10px] transition-all ${
                    ackFilter === f.value
                      ? "bg-surface-container-high text-on-surface font-bold"
                      : "text-on-surface-variant hover:bg-surface-container-high"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="error-container flex items-center gap-3 rounded-lg border border-error/30 bg-error/5 p-4">
            <Icon name="error" size={20} className="text-error" />
            <span className="font-body-md text-body-md text-error">{error}</span>
          </div>
        )}

        {/* Alert list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="clinical-card flex flex-col items-center justify-center py-20">
            <Icon name="check_circle" size={48} className="text-accent-teal" />
            <p className="mt-4 font-headline-sm text-headline-sm text-on-surface">
              NO_ALERTS
            </p>
            <p className="mt-2 font-body-md text-body-md text-on-surface-variant">
              All systems are operating within normal parameters.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {alerts.map((alert) => {
              const sev = alert.severity as StatusLevel;
              const tone = STATUS_TONE[sev] ?? STATUS_TONE.nominal;
              const isCritical = sev === "critical";
              const isMutating = mutating[alert.id] ?? false;

              return (
                <div
                  key={alert.id}
                  className={`clinical-card border-l-4 overflow-hidden ${tone.border} ${
                    isCritical ? "ring-1 ring-error/30" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-4 p-5">
                    {/* Left content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-label-caps text-[10px] font-bold ${tone.chip}`}
                        >
                          <Icon name={tone.icon} size={12} />
                          {alert.kind}
                        </span>
                        {alert.acknowledged && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent-teal/10 px-2 py-0.5 font-label-caps text-[9px] text-accent-teal">
                            <Icon name="done" size={10} />
                            ACK
                          </span>
                        )}
                      </div>

                      <p
                        className={`mt-3 font-body-md text-body-md ${
                          isCritical ? "font-semibold text-on-surface" : "text-on-surface"
                        }`}
                      >
                        {alert.message}
                      </p>

                      <div className="mt-3 flex items-center gap-4">
                        <span className="font-data-md text-[10px] text-on-surface-variant">
                          <Icon name="schedule" size={12} className="mr-1 align-middle" />
                          {formatDateTimeUtc(alert.raisedAt)}
                        </span>
                        <span className="font-data-md text-[10px] text-on-surface-variant">
                          ID: {alert.id}
                        </span>
                        {alert.sourceIncidentId && (
                          <span className="font-data-md text-[10px] text-on-surface-variant">
                            <Icon name="link" size={12} className="mr-1 align-middle" />
                            {alert.sourceIncidentId}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right actions */}
                    {!alert.acknowledged && (
                      <div className="flex shrink-0 flex-col gap-2">
                        <button
                          onClick={() => handleAcknowledge(alert.id)}
                          disabled={isMutating}
                          className="flex items-center gap-1.5 rounded-md border border-outline-variant bg-surface-container px-3 py-1.5 font-label-caps text-[10px] text-on-surface transition-colors hover:bg-accent-teal/10 hover:border-accent-teal/30 hover:text-accent-teal disabled:opacity-50"
                        >
                          <Icon name="check_circle" size={14} />
                          ACKNOWLEDGE
                        </button>
                        <button
                          onClick={() => handleDismiss(alert.id)}
                          disabled={isMutating}
                          className="flex items-center gap-1.5 rounded-md border border-outline-variant bg-surface-container px-3 py-1.5 font-label-caps text-[10px] text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-50"
                        >
                          <Icon name="close" size={14} />
                          DISMISS
                        </button>
                      </div>
                    )}
                    {alert.acknowledged && alert.acknowledgedAt && (
                      <div className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent-teal/5 px-3 py-2">
                        <Icon name="done_all" size={16} className="text-accent-teal" />
                        <span className="font-data-md text-[10px] text-accent-teal">
                          {formatTime(alert.acknowledgedAt)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
