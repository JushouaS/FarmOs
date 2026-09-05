import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/farm/AppShell";
import { Icon } from "@/components/farm/Icon";
import {
  type ApiNotification,
  fetchNotifications,
  markNotificationRead,
} from "@/lib/api-client";
import { STATUS_TONE, formatDateTimeUtc, formatTime } from "@/lib/farm/format";
import type { StatusLevel } from "@/lib/farm/types";

const TITLE = "Notifications | CereBroiler";
const DESC = "User notification center — delivery channels and read status.";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
    ],
  }),
  component: NotificationsPage,
});

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const CHANNEL_ICONS: Record<string, string> = {
  in_app: "notifications",
  email: "mail",
  push: "smartphone",
  sms: "sms",
};

const CHANNEL_LABELS: Record<string, string> = {
  in_app: "In-app",
  email: "Email",
  push: "Push",
  sms: "SMS",
};

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
] as const;

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

function NotificationsPage() {
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingRead, setMarkingRead] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchNotifications();
      setNotifications(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notifications");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredNotifications = useMemo(() => {
    if (filter === "unread") return notifications.filter((n) => !n.readAt);
    if (filter === "read") return notifications.filter((n) => n.readAt);
    return notifications;
  }, [notifications, filter]);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  const handleMarkRead = async (id: string) => {
    setMarkingRead((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await markNotificationRead(id);
      if (result.updated) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
        );
      }
    } catch {
      /* keep unread */
    } finally {
      setMarkingRead((prev) => ({ ...prev, [id]: false }));
    }
  };

  return (
    <AppShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 lg:p-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Icon name="notifications" size={22} className="text-primary" />
            </div>
            <div>
              <h1 className="font-headline-md text-headline-md font-bold text-on-surface">
                Notification Center
              </h1>
              <p className="font-body-md text-body-md text-on-surface-variant">
                {isLoading
                  ? "Loading..."
                  : `${notifications.length} total · ${unreadCount} unread`}
              </p>
            </div>
          </div>
          <button
            onClick={load}
            disabled={isLoading}
            className="flex items-center gap-2 self-start rounded-lg border border-outline-variant px-4 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
          >
            <Icon name="refresh" size={16} />
            Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 border-b border-outline-variant pb-1">
          {FILTER_OPTIONS.map((f) => {
            const active = filter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`relative px-3 pb-2 text-sm font-medium transition-colors ${
                  active ? "text-primary" : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {f.label}
                {f.value === "unread" && unreadCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-error px-1.5 py-0.5 text-[10px] text-white">
                    {unreadCount}
                  </span>
                )}
                {active && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 rounded-lg border border-error/30 bg-error/5 p-4">
            <Icon name="error" size={20} className="text-error" />
            <span className="font-body-md text-body-md text-error">{error}</span>
          </div>
        )}

        {/* Feed */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <NotificationFeed
            notifications={filteredNotifications}
            markingRead={markingRead}
            onMarkRead={handleMarkRead}
          />
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Notification feed                                                         */
/* -------------------------------------------------------------------------- */

function NotificationFeed({
  notifications,
  markingRead,
  onMarkRead,
}: {
  notifications: ApiNotification[];
  markingRead: Record<string, boolean>;
  onMarkRead: (id: string) => void;
}) {
  if (notifications.length === 0) {
    return (
      <div className="clinical-card flex flex-col items-center justify-center py-16">
        <Icon name="notifications_none" size={40} className="text-on-surface-variant/40" />
        <p className="mt-4 font-body-md text-body-md text-on-surface">No notifications</p>
        <p className="mt-1 text-sm text-on-surface-variant">
          Your inbox is empty for this filter.
        </p>
      </div>
    );
  }

  return (
    <div className="clinical-card divide-y divide-outline-variant/30 overflow-hidden">
      {notifications.map((notif) => {
        const sev = notif.severity as StatusLevel;
        const tone = STATUS_TONE[sev] ?? STATUS_TONE.nominal;
        const isUnread = !notif.readAt;
        const isMarking = markingRead[notif.id] ?? false;
        const channelIcon = CHANNEL_ICONS[notif.channel] ?? "notifications";
        const channelLabel = CHANNEL_LABELS[notif.channel] ?? notif.channel;

        return (
          <div
            key={notif.id}
            className={`group flex items-start gap-4 p-4 transition-colors hover:bg-surface-container/50 ${
              isUnread ? "bg-surface-container-low/40" : ""
            }`}
          >
            {/* Unread dot */}
            <div className="flex h-2 w-2 shrink-0 pt-2">
              {isUnread ? (
                <span className={`h-2 w-2 rounded-full ${tone.dot ?? "bg-primary"}`} />
              ) : (
                <span className="h-2 w-2 rounded-full bg-outline-variant/50" />
              )}
            </div>

            {/* Channel icon */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
              <Icon name={channelIcon} size={18} />
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className={`text-sm ${isUnread ? "font-semibold text-on-surface" : "text-on-surface-variant"}`}>
                  {notif.title}
                </h3>
                <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] text-on-surface-variant">
                  {channelLabel}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone.chip}`}>
                  {sev}
                </span>
              </div>
              <p className="mt-0.5 text-sm leading-relaxed text-on-surface-variant">
                {notif.body}
              </p>
              <span className="mt-1.5 block text-[11px] text-on-surface-variant/70">
                {formatDateTimeUtc(notif.createdAt)}
              </span>
            </div>

            {/* Action */}
            <div className="shrink-0 pt-0.5">
              {isUnread ? (
                <button
                  onClick={() => onMarkRead(notif.id)}
                  disabled={isMarking}
                  className="rounded-md p-2 text-on-surface-variant opacity-0 transition-all hover:bg-primary/10 hover:text-primary group-hover:opacity-100 disabled:opacity-50"
                  title="Mark as read"
                >
                  <Icon name="done" size={18} />
                </button>
              ) : (
                <span className="flex items-center gap-1 text-[11px] text-on-surface-variant/60">
                  <Icon name="done_all" size={14} />
                  {notif.readAt ? formatTime(notif.readAt) : ""}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
