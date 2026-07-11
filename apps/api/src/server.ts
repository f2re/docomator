import { loadApiConfig } from "@docomator/config";

import { buildApp } from "./app.js";

const config = loadApiConfig();
const app = buildApp(config);

let closing = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) {
    return;
  }
  closing = true;
  app.log.info({ signal }, "shutdown requested");

  const timer = setTimeout(() => {
    app.log.error("graceful shutdown timed out");
    process.exit(1);
  }, 10_000);
  timer.unref();

  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ error }, "graceful shutdown failed");
    process.exit(1);
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ error }, "api failed to start");
  process.exit(1);
}
