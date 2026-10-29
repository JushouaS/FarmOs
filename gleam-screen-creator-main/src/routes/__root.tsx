import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  Navigate,
  useLocation,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider, useAuth } from "../lib/auth-context";
import { LanguageProvider, tr } from "@/lib/i18n";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl font-bold text-foreground">404</h1>
        <h2 className="font-display mt-4 text-xl font-semibold text-foreground">{tr("Page not found")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr("The page you're looking for doesn't exist or has been moved.")}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {tr("Go home")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: any; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {tr("This page didn't load")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr("Something went wrong on our end. You can try refreshing or head back home.")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {tr("Try again")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {tr("Go home")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Cerebroil | Flock Monitor" },
      {
        name: "description",
        content:
          "Cerebroil — Poultry flock monitoring system with real-time detection, weight estimation, and house telemetry.",
      },
      { name: "author", content: "CereBroiler" },
      { property: "og:title", content: "Cerebroil | Flock Monitor" },
      {
        property: "og:description",
        content:
          "Cerebroil — Poultry flock monitoring system with real-time detection, weight estimation, and house telemetry.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap",
      },
      { rel: "icon", href: "/favicon.png?v=2", type: "image/png", sizes: "32x32" },
      { rel: "shortcut icon", href: "/favicon.png?v=2", type: "image/png" },
      { rel: "apple-touch-icon", href: "/favicon.png?v=2", sizes: "180x180" },
    ],
    scripts: [
      {
        // Dark mode is the default. Add .light class only when user has explicitly chosen light.
        children:
          '(function(){try{var t=localStorage.getItem("theme");if(t==="light"){document.documentElement.classList.add("light");}else if(!t){var prefersDark=window.matchMedia("(prefers-color-scheme: dark)").matches;if(!prefersDark){document.documentElement.classList.add("light");}}}catch(e){}})();',
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LanguageProvider>
          <AuthGuard>
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
          </AuthGuard>
        </LanguageProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

/* ── Auth guard: every page except /login requires a signed-in user ── */
function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (location.pathname.startsWith("/login")) return <>{children}</>;
  // Hold the splash during session hydration so a signed-in refresh
  // doesn't bounce to /login before /auth/me resolves.
  if (isLoading) return <AuthSplash />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/* Branded placeholder shown while the session is being restored. */
function AuthSplash() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-5"
      style={{ background: "var(--surface-page)" }}
    >
      <div className="flex items-center gap-3 animate-spring-in">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-xl elevation-1"
          style={{
            background:
              "linear-gradient(135deg, var(--sidebar-active-text), color-mix(in srgb, var(--sidebar-active-text) 75%, #059669))",
          }}
        >
          <svg
            className="h-6 w-6"
            style={{ color: "#020617" }}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="4" />
            <path strokeLinecap="round" d="M3 9l2-3h14l2 3M3 9v9a2 2 0 002 2h14a2 2 0 002-2V9" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div>
          <div className="font-display text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            {tr("Cerebroil")}
          </div>
          <div className="text-[11px] tracking-wide" style={{ color: "var(--text-tertiary)" }}>
            {tr("Flock Monitor")}
          </div>
        </div>
      </div>
      <span
        className="h-5 w-5 animate-spin rounded-full border-2 border-solid"
        style={{
          borderColor: "var(--border-default)",
          borderTopColor: "var(--brand)",
        }}
        role="status"
        aria-label={tr("Restoring session")}
      />
    </div>
  );
}
