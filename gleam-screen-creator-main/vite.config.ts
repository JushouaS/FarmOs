// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { isRunnableDevEnvironment } from "vite";
import { NodeRequest, sendNodeResponse } from "srvx/node";
import type { Plugin } from "vite";

// Forces the ssr environment to use moduleRunnerTransform during config phase
// so it becomes a RunnableDevEnvironment, then installs the SSR middleware.
const ssrDevMiddlewarePlugin: Plugin = {
  name: "local:ssr-dev-middleware",
  enforce: "pre",
  config() {
    return {
      environments: {
        ssr: {
          dev: {
            createEnvironment: async (name, config) => {
              // Force moduleRunnerTransform in the resolved config
              if (config.environments?.ssr?.dev) {
                (config.environments.ssr.dev as { moduleRunnerTransform?: boolean }).moduleRunnerTransform = true;
              }
              // Use Vite's default which creates RunnableDevEnvironment
              const { createRunnableDevEnvironment } = await import("vite");
              return createRunnableDevEnvironment(name, config);
            },
          },
        },
      },
    };
  },
  configureServer(server) {
    return () => {
      server.middlewares.use(async (req, res) => {
        if (req.originalUrl) req.url = req.originalUrl;

        const ssrEnv = server.environments?.ssr;
        if (!ssrEnv || !isRunnableDevEnvironment(ssrEnv)) {
          res.statusCode = 500;
          res.end("SSR environment is not a RunnableDevEnvironment");
          return;
        }

        const env = ssrEnv as unknown as { runner: { import: (id: string) => Promise<unknown> } };
        const webReq = new NodeRequest({ req, res });
        try {
          const mod = (await env.runner.import("virtual:tanstack-start-server-entry")) as {
            default: { fetch: (req: Request) => Promise<Response> };
          };
          const response = await mod.default.fetch(webReq as unknown as Request);
          return sendNodeResponse(res, response);
        } catch (e) {
          console.error("[local:ssr-dev-middleware] SSR error:", e);
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/html");
          res.end("<pre>SSR Error: " + String(e) + "</pre>");
        }
      });
    };
  },
};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    server: {
      host: true, // expose to all network interfaces (0.0.0.0)
    },
    plugins: [ssrDevMiddlewarePlugin],
  },
});
