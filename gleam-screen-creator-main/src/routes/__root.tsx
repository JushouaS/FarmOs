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
import { AppSkeleton } from "@/components/farm/AppSkeleton";
import { PrivacyGate } from "@/components/farm/PrivacyGate";
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
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (location.pathname.startsWith("/login")) return <>{children}</>;
  // The Privacy Policy is for anyone to read, signed in or not.
  if (location.pathname.startsWith("/privacy")) return <>{children}</>;
  // Hold the page outline during session hydration so a signed-in refresh
  // doesn't bounce to /login before /auth/me resolves.
  if (isLoading) return <AppSkeleton />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // Until the person has agreed to the current Privacy Policy, nothing else opens (the Contact page stays reachable from it).
  if (user?.privacyAccepted === false && !location.pathname.startsWith("/contact")) return <PrivacyGate />;
  return <>{children}</>;
}
