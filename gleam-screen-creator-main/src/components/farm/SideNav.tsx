import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { UserAvatar } from "./UserAvatar";
import { unacknowledgedAlerts } from "@/lib/farm/dataset";
import {
  LayoutDashboard,
  Video,
  Bird,
  LineChart,
  Bell,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";

/* ── Brand Logo ────────────────────────────────────────────── */
export function CerebroilLogo({ size = 34 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl transition-all duration-200"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)",
        boxShadow: "0 2px 8px rgba(16, 185, 129, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.3)",
        border: "1px solid rgba(52, 211, 153, 0.35)",
      }}
    >
      <svg
        width={Math.round(size * 0.58)}
        height={Math.round(size * 0.58)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M16 7h.01" />
        <path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20" />
        <path d="m20 7 2 .5-2 .5" />
        <path d="M10 18v3" />
        <path d="M14 17.75V21" />
        <path d="M7 18a6 6 0 0 0 3.84-10.61" />
      </svg>
    </div>
  );
}

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/visuals", icon: Video, label: "Live Camera" },
  { to: "/flock-monitoring", icon: Bird, label: "Flock Tracking" },
  { to: "/telemetry", icon: LineChart, label: "Analytics" },
  { to: "/alerts", icon: Bell, label: "Alerts", badge: true },
  { to: "/settings", icon: Settings, label: "Settings" },
] as const;

export function SideNav({
  collapsed,
  onToggle,
  onMobileClose,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onMobileClose: () => void;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const alertCount = unacknowledgedAlerts();

  const handleLogout = async () => {
    await logout();
    navigate({ to: "/login" });
  };

  // Modern inset rounded pill navigation items
  const base = [
    "flex items-center gap-3 py-2.5 pointer-coarse:py-3 text-sm font-medium transition-all duration-150 rounded-lg group",
    "text-[color:var(--sidebar-text)] hover:bg-[color:var(--sidebar-hover-bg)] hover:text-[color:var(--sidebar-hover-text)]",
    collapsed ? "mx-2 px-0 justify-center" : "mx-2.5 px-3",
  ].join(" ");

  const active = [
    "flex items-center gap-3 py-2.5 pointer-coarse:py-3 text-sm font-semibold rounded-lg",
    "text-[color:var(--sidebar-active-text)] bg-[color:var(--sidebar-active-bg)]",
    "border border-emerald-500/20 shadow-xs",
    collapsed ? "mx-2 px-0 justify-center" : "mx-2.5 px-3",
  ].join(" ");

  return (
    <aside
      className="flex h-full w-full flex-col select-none"
      style={{ background: "var(--sidebar-bg)", borderRight: "1px solid var(--sidebar-border)" }}
    >
      {/* Brand & Collapse Header — Unified into a single 56px bar */}
      <div
        className={`flex h-14 shrink-0 items-center ${collapsed ? "justify-center px-2" : "justify-between px-3.5"
          }`}
        style={{ borderBottom: "1px solid var(--sidebar-border)" }}
      >
        {collapsed ? (
          <button
            onClick={onToggle}
            className="flex items-center justify-center rounded-xl p-1 transition-transform hover:scale-105"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <CerebroilLogo size={34} />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-3 min-w-0">
              <CerebroilLogo size={34} />
              <div className="min-w-0">
                <div
                  className="font-display text-sm font-bold leading-none tracking-tight"
                  style={{ color: "var(--sidebar-heading)" }}
                >
                  Cerebroil
                </div>
                <div
                  className="text-[11px] font-medium leading-none mt-1"
                  style={{ color: "var(--sidebar-muted)" }}
                >
                  Flock Monitor
                </div>
              </div>
            </div>

            {/* Desktop collapse toggle & Mobile close drawer button */}
            <div className="flex items-center">
              <button
                onClick={onToggle}
                className="hidden lg:flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[color:var(--sidebar-hover-bg)] hover:text-[color:var(--sidebar-hover-text)]"
                style={{ color: "var(--sidebar-muted)" }}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>

              <button
                onClick={onMobileClose}
                className="tap flex lg:hidden h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[color:var(--sidebar-hover-bg)] hover:text-[color:var(--sidebar-hover-text)]"
                style={{ color: "var(--sidebar-muted)" }}
                title="Close navigation"
                aria-label="Close navigation"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Navigation list */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-1">
        {!collapsed && (
          <p
            className="px-4 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--sidebar-muted)" }}
          >
            Navigation
          </p>
        )}
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.to === "/" }}
            onClick={onMobileClose}
            className={base}
            activeProps={{ className: active }}
            title={collapsed ? item.label : undefined}
          >
            {/* Icon + small badge when collapsed */}
            <span className="relative flex shrink-0 items-center justify-center">
              <item.icon className="h-4.5 w-4.5 shrink-0 stroke-[1.8px] transition-transform duration-150 group-hover:scale-105" />
              {collapsed && "badge" in item && item.badge && alertCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white shadow-xs"
                  style={{ background: "var(--status-red)" }}
                >
                  {alertCount}
                </span>
              )}
            </span>

            {/* Label and right pill badge ONLY when expanded */}
            {!collapsed && (
              <span className="flex flex-1 items-center justify-between min-w-0">
                <span className="truncate">{item.label}</span>
                {"badge" in item && item.badge && alertCount > 0 && (
                  <span
                    className="ml-auto rounded-full px-2 py-0.5 font-mono text-[10px] font-bold shrink-0"
                    style={{
                      background: "rgba(239,68,68,0.18)",
                      color: "#fca5a5",
                      border: "1px solid rgba(239,68,68,0.3)",
                    }}
                  >
                    {alertCount}
                  </span>
                )}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* Footer: Status + User Profile */}
      <div
        className="shrink-0 p-3 space-y-2"
        style={{ borderTop: "1px solid var(--sidebar-border)" }}
      >
        {/* Status card */}
        {!collapsed ? (
          <div
            className="flex items-center gap-2.5 rounded-lg px-3 py-2"
            style={{
              background: "rgba(16,185,129,0.06)",
              border: "1px solid rgba(16,185,129,0.18)",
            }}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold leading-tight text-[var(--sidebar-heading)]">
                System Online
              </p>
              <p className="text-[10px] leading-tight text-[var(--sidebar-muted)]">
                Pen 1 Connected
              </p>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-1">
            <span
              className="relative flex h-2.5 w-2.5 cursor-pointer"
              title="System Online · Pen 1 Connected"
              onClick={onToggle}
            >
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
          </div>
        )}

        {/* User / sign out */}
        <div
          className={`flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-[color:var(--sidebar-hover-bg)] group ${collapsed ? "justify-center" : "justify-between"
            }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 shrink-0 shadow-xs">
              <UserAvatar user={user} />
            </div>
            {!collapsed && (
              <div className="min-w-0 text-left">
                <p className="text-xs font-semibold leading-tight truncate text-[var(--sidebar-heading)]">
                  {user?.fullName ?? user?.email ?? "Farm Manager"}
                </p>
                <p className="text-[10px] truncate text-[var(--sidebar-muted)]">
                  {user?.roles?.[0] ?? "Manager"}
                </p>
              </div>
            )}
          </div>
          {!collapsed ? (
            <button
              onClick={handleLogout}
              className="tap flex h-7 w-7 items-center justify-center rounded-md text-[var(--sidebar-muted)] hover:text-[var(--sidebar-hover-text)] hover:bg-[var(--surface-raised)] transition-colors shrink-0"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={handleLogout}
              className="sr-only"
              title="Sign out"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
