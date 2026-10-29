import { useSyncExternalStore } from "react";
import type { ApiAlert } from "@/lib/api-client";

/**
 * The unacknowledged alerts, as the API last reported them, shared by every
 * part of the shell: the corner pop-ups fill it, and the alert badges (top bar,
 * sidebar, bottom nav) read their count from it. One source, so the badge and
 * the pop-ups can never disagree with each other or with the database.
 */

interface AlertState {
  alerts: ApiAlert[];
  /** False until the first answer from the API: no badge is shown before that. */
  loaded: boolean;
}

const EMPTY: AlertState = { alerts: [], loaded: false };
let state: AlertState = EMPTY;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Replace the list with a fresh answer from the API. */
export function setUnacknowledgedAlerts(alerts: ApiAlert[]) {
  state = { alerts, loaded: true };
  emit();
}

/** An alert was acknowledged: drop it at once, without waiting for the next poll. */
export function removeUnacknowledgedAlert(id: string) {
  state = { ...state, alerts: state.alerts.filter((a) => a.id !== id) };
  emit();
}

/** Forget everything (signed out). */
export function clearUnacknowledgedAlerts() {
  state = EMPTY;
  emit();
}

export function useUnacknowledgedAlerts(): AlertState {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

/** How many alerts still need attention; 0 until the API has answered. */
export function useUnacknowledgedAlertCount(): number {
  return useUnacknowledgedAlerts().alerts.length;
}
