/**
 * Process bootstrap — builds the Fastify app, binds the socket, and wires
 * graceful shutdown on SIGTERM/SIGINT.
 */

import { buildApp } from "./app.js";
import { env } from "./config.js";

async function main() {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    const address = await app.listen({ host: env.API_HOST, port: env.API_PORT });
    app.log.info(`API listening at ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
