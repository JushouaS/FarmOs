import { useEffect, useState, type ReactNode } from "react";
import { SideNav } from "./SideNav";
import { StatusFooter } from "./StatusFooter";
import { TopNav } from "./TopNav";

const COLLAPSE_KEY = "farm-sidenav-collapsed";

// Cache across AppShell remounts (each route renders its own shell) so
// navigation doesn't flash the sidebar back to its default width.
let collapsedCache: boolean | null = null;

export function AppShell({
  children,
  bare = false,
}: {
  children: ReactNode;
  bare?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(() => collapsedCache ?? false);

  useEffect(() => {
    if (collapsedCache === null) {
      collapsedCache = localStorage.getItem(COLLAPSE_KEY) === "1";
      setCollapsed(collapsedCache);
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      collapsedCache = next;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const mainOffset = collapsed ? "md:ml-16" : "md:ml-64";

  return (
    <div className="min-h-screen bg-background text-on-surface">
      <TopNav />
      <SideNav collapsed={collapsed} onToggle={toggleCollapsed} />
      <main
        className={
          bare
            ? `relative flex h-[calc(100vh-64px)] flex-col overflow-hidden bg-background transition-[margin] duration-200 ${mainOffset}`
            : `px-gutter pb-4 pt-4 data-grid-bg transition-[margin] duration-200 ${mainOffset}`
        }
      >
        {children}
      </main>
      <StatusFooter collapsed={collapsed} />
    </div>
  );
}
