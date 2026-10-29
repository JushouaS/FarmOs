import { useState, useEffect, createContext, useContext, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { SideNav } from "./SideNav";
import { AccountMenu } from "./AccountMenu";
import { unacknowledgedAlerts } from "@/lib/farm/dataset";
import {
  Menu,
  Sun,
  Moon,
  Bell,
  LayoutDashboard,
  Video,
  Bird,
  LineChart,
} from "lucide-react";

const COLLAPSE_KEY = "cb-sidenav-collapsed";
let collapsedCache: boolean | null = null;

/* ── AppShell Context ─────────────────────────────────────── */
interface AppShellContextValue {
  collapsed: boolean;
  toggleCollapsed: () => void;
  openMobileMenu: () => void;
  closeMobileMenu: () => void;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

export function useAppShell() {
  return useContext(AppShellContext);
}

/* One style for every square icon control in the top bar (menu, sidebar
 * toggle, theme, alerts) so the left and right clusters read as one set. */
const TOP_BAR_ICON_BUTTON =
  "tap relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-all";

/* ── Theme toggle ─────────────────────────────────────────── */
function ThemeToggle() {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));
  }, []);

  const toggle = () => {
    const root = document.documentElement;
    const goLight = !root.classList.contains("light");
    root.classList.toggle("light", goLight);
    setIsLight(goLight);
    try { localStorage.setItem("theme", goLight ? "light" : "dark"); } catch {}
  };

  return (
    <button
      onClick={toggle}
      className={TOP_BAR_ICON_BUTTON}
      aria-label="Toggle theme"
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
    >
      {isLight ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}

/* ── Top bar ──────────────────────────────────────────────── */
function TopBar({ onMenuOpen }: { onMenuOpen: () => void }) {
  const alertCount = unacknowledgedAlerts();

  return (
    <div
      className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 sm:px-5 lg:px-6"
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {/* Mobile hamburger menu button */}
        <button
          onClick={onMenuOpen}
          className={`${TOP_BAR_ICON_BUTTON} lg:hidden`}
          aria-label="Open navigation menu"
          aria-controls="app-sidenav"
          title="Open menu"
        >
          <Menu className="h-4.5 w-4.5" />
        </button>
        {/* Desktop has no button here: the sidebar's own header collapses it,
            and its logo expands it again. */}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ThemeToggle />

        {/* Alert bell with badge */}
        <Link
          to="/alerts"
          className={TOP_BAR_ICON_BUTTON}
          aria-label="View alerts"
          title="View alerts"
        >
          <Bell className="h-4 w-4" />
          {alertCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white shadow-xs"
              style={{ background: "var(--status-red)" }}
            >
              {alertCount}
            </span>
          )}
        </Link>

        {/* Account menu (opens from the avatar) */}
        <AccountMenu />
      </div>
    </div>
  );
}

/* ── Bottom navigation for mobile ────────────────────────── */
const BOTTOM_ROUTES = [
  { to: "/",                 label: "Dash",    icon: LayoutDashboard },
  { to: "/visuals",          label: "Camera",  icon: Video },
  { to: "/flock-monitoring", label: "Flock",   icon: Bird },
  { to: "/telemetry",        label: "Data",    icon: LineChart },
  { to: "/alerts",           label: "Alerts",  icon: Bell },
] as const;

function BottomNav() {
  const alertCount = unacknowledgedAlerts();
  return (
    <nav
      aria-label="Primary"
      className="pb-safe fixed bottom-0 inset-x-0 z-20 flex lg:hidden"
      style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}
    >
      {BOTTOM_ROUTES.map((r) => (
        <Link
          key={r.to}
          to={r.to}
          activeOptions={{ exact: r.to === "/" }}
          className="relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors"
          style={{ color: "var(--text-tertiary)" }}
          activeProps={{ style: { color: "var(--brand)" } }}
        >
          <span className="relative flex items-center justify-center">
            <r.icon className="h-4.5 w-4.5 stroke-[1.8px]" />
            {r.label === "Alerts" && alertCount > 0 && (
              <span
                className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[8px] font-bold text-white"
                style={{ background: "var(--status-red)" }}
              >
                {alertCount}
              </span>
            )}
          </span>
          {r.label}
        </Link>
      ))}
    </nav>
  );
}

/* ── Shell ────────────────────────────────────────────────── */
export function AppShell({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const [collapsed, setCollapsed] = useState(() => {
    if (collapsedCache !== null) return collapsedCache;
    if (typeof window !== "undefined") {
      collapsedCache = localStorage.getItem(COLLAPSE_KEY) === "1";
      return collapsedCache;
    }
    return false;
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  // While the drawer is open: Escape closes it (R-32) and the page behind
  // it stops scrolling, so a swipe on the drawer doesn't move the page.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    // The drawer is lg:hidden, so a resize past the breakpoint must release it.
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onDesktop = () => desktop.matches && setMobileOpen(false);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onDesktop);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onDesktop);
    };
  }, [mobileOpen]);

  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev;
      collapsedCache = next;
      if (typeof window !== "undefined") localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });

  const sidebarW  = collapsed ? "lg:w-16" : "lg:w-60";
  const mainShift = collapsed ? "lg:pl-16" : "lg:pl-60";

  const contextValue: AppShellContextValue = {
    collapsed,
    toggleCollapsed,
    openMobileMenu: () => setMobileOpen(true),
    closeMobileMenu: () => setMobileOpen(false),
  };

  return (
    <AppShellContext.Provider value={contextValue}>
      <div className="flex min-h-dvh" style={{ background: "var(--surface-page)" }}>
        {/* Mobile/tablet backdrop overlay */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-xs transition-opacity lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar — hidden on mobile by default, slide-in on mobileOpen */}
        <div
          id="app-sidenav"
          className={`
            fixed left-0 top-0 z-40 h-full transition-[width,transform] duration-200
            ${sidebarW}
            ${mobileOpen ? "translate-x-0 w-[min(18rem,85vw)] shadow-2xl" : "-translate-x-full lg:translate-x-0"}
          `}
        >
          {/* The drawer always opens expanded: the desktop collapse preference
              would otherwise leave phones with an icon-only menu. */}
          <SideNav
            collapsed={collapsed && !mobileOpen}
            onToggle={toggleCollapsed}
            onMobileClose={() => setMobileOpen(false)}
          />
        </div>

        {/* Main layout container */}
        <div className={`flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ${mainShift}`}>
          {bare ? (
            <main className="flex flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:overflow-hidden lg:pb-0">
              {children}
            </main>
          ) : (
            <>
              <TopBar onMenuOpen={() => setMobileOpen(true)} />
              <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:p-5 sm:pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:p-6 lg:pb-6">
                {children}
              </main>
            </>
          )}
        </div>

        {/* Bottom nav — below lg, on every page including the bare camera view */}
        <BottomNav />
      </div>
    </AppShellContext.Provider>
  );
}
