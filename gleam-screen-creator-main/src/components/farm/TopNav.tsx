import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { farm, unacknowledgedAlerts } from "@/lib/farm/dataset";
import { useAuth } from "@/lib/auth-context";
import { Icon } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";
import {
  type ApiNotification,
  fetchNotifications,
  markNotificationRead,
} from "@/lib/api-client";
import { STATUS_TONE, formatTime } from "@/lib/farm/format";
import type { StatusLevel } from "@/lib/farm/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STATUS_LABELS: Record<string, string> = {
  nominal: "Normal",
  optimal: "Optimal",
  warning: "Warning",
  critical: "Critical",
  deviation: "Deviation",
};

const CHANNEL_ICONS: Record<string, string> = {
  in_app: "notifications",
  email: "mail",
  push: "smartphone",
  sms: "sms",
};

export function TopNav() {
  const pendingAlerts = unacknowledgedAlerts();
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchNotifications().then(setNotifications).catch(() => {
      /* ignore */
    });
  }, [open]);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  const handleMarkRead = async (id: string) => {
    try {
      const result = await markNotificationRead(id);
      if (result.updated) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
        );
      }
    } catch {
      /* ignore */
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate({ to: "/login" });
  };

  return (
    <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b border-outline-variant bg-background px-gutter">
      <div>
        <span className="font-headline-md text-headline-md font-bold tracking-tighter text-primary">
          {farm.facility.name}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="hidden font-label-caps text-[11px] font-medium text-primary md:inline">
          System Performance: {STATUS_LABELS[farm.platform.status] ?? farm.platform.status}
        </span>
        <div className="flex gap-2">
          <ThemeToggle />
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              <button className="relative rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface">
                <Icon name="notifications" />
                {unreadCount > 0 && (
                  <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 font-data-md text-[9px] leading-none text-on-error">
                    {unreadCount}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel className="font-normal">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="rounded-full bg-error px-2 py-0.5 text-[10px] text-white">
                      {unreadCount} unread
                    </span>
                  )}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-on-surface-variant">
                    <Icon name="notifications_none" size={32} />
                    <span className="mt-2 text-xs">No notifications</span>
                  </div>
                ) : (
                  notifications.map((notif) => {
                    const sev = notif.severity as StatusLevel;
                    const tone = STATUS_TONE[sev] ?? STATUS_TONE.nominal;
                    const isUnread = !notif.readAt;
                    const channelIcon = CHANNEL_ICONS[notif.channel] ?? "notifications";
                    return (
                      <div
                        key={notif.id}
                        className={`flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-surface-container ${
                          isUnread ? "bg-surface-container-low/50" : ""
                        }`}
                      >
                        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone.chip}`}>
                          <Icon name={channelIcon} size={14} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-xs ${isUnread ? "font-semibold text-on-surface" : "text-on-surface-variant"}`}>
                            {notif.title}
                          </p>
                          <p className="line-clamp-2 text-[11px] leading-snug text-on-surface-variant">
                            {notif.body}
                          </p>
                          <span className="text-[10px] text-on-surface-variant/70">
                            {formatTime(notif.createdAt)}
                          </span>
                        </div>
                        {isUnread && (
                          <button
                            onClick={() => handleMarkRead(notif.id)}
                            className="shrink-0 rounded p-1 text-on-surface-variant hover:bg-primary/10 hover:text-primary"
                            title="Mark as read"
                          >
                            <Icon name="done" size={16} />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface">
                  <Icon name="account_circle" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user?.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {user?.roles?.join(", ")}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <Icon name="logout" size={16} />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link
              to="/login"
              className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
            >
              <Icon name="account_circle" />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}