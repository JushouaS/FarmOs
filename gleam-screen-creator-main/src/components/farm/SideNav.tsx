import { Link } from "@tanstack/react-router";
import { unacknowledgedAlerts } from "@/lib/farm/dataset";
import { Icon } from "./Icon";

const groups = [
  {
    label: "MAIN",
    items: [
      { to: "/", icon: "dashboard", label: "Dashboard" },
      { to: "/telemetry", icon: "analytics", label: "Analytics" },
      { to: "/visuals", icon: "videocam", label: "Cameras" },
      { to: "/intelligence", icon: "psychology", label: "Insights" },
    ],
  },
] as const;

export function SideNav({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const itemClass = `mx-2 flex items-center gap-3 rounded-lg px-3 py-2 transition-all ${
    collapsed ? "justify-center" : ""
  }`;

  return (
    <aside
      className={`fixed left-0 top-0 z-40 hidden h-full flex-col border-r border-outline-variant bg-surface-container-lowest pt-16 transition-[width] duration-200 md:flex ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      <div className="flex items-center justify-end border-b border-outline-variant py-3 px-4">
        <button
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          <Icon name={collapsed ? "menu" : "chevron_left"} size={20} />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {groups.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <div className="mb-2 px-6 font-label-caps text-[10px] tracking-[0.2em] text-outline">
                {group.label}
              </div>
            )}
            {group.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                title={collapsed ? item.label : undefined}
                className={`${itemClass} text-on-surface-variant hover:bg-surface-container-high`}
                activeProps={{
                  className: `${itemClass} nav-active`,
                }}
              >
                <Icon name={item.icon} size={20} />
                {!collapsed && (
                  <span className="font-label-caps text-label-caps">{item.label}</span>
                )}
              </Link>
            ))}
          </div>
        ))}
        {collapsed && <div className="mx-4 mt-6 mb-2 h-px bg-outline-variant" />}
        <Link
          to="/alerts"
          title={collapsed ? "Alerts" : undefined}
          className={`${itemClass} text-on-surface-variant hover:bg-surface-container-high`}
          activeProps={{
            className: `${itemClass} nav-active`,
          }}
        >
          <Icon name="notification_important" size={20} />
          {!collapsed && (
            <span className="flex flex-1 items-center justify-between font-label-caps text-label-caps">
              Alerts
              <span className="font-data-md text-[10px] text-on-surface-variant">
                {unacknowledgedAlerts()}
              </span>
            </span>
          )}
        </Link>
        <Link
          to="/settings"
          title={collapsed ? "Settings" : undefined}
          className={`${itemClass} text-on-surface-variant hover:bg-surface-container-high`}
          activeProps={{
            className: `${itemClass} nav-active`,
          }}
        >
          <Icon name="settings" size={20} />
          {!collapsed && <span className="font-label-caps text-label-caps">Settings</span>}
        </Link>
      </nav>
    </aside>
  );
}
