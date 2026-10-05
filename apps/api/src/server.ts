import path from "node:path";

import { loadApiConfig } from "@docomator/config";
import {
  ContentAddressedObjectStore,
  DataExtractionRegistry,
  DocumentQuarantineRegistry,
  SqliteStore
} from "@docomator/storage";

import {
  createSqliteAccessCodeCredentialStore,
  installAccessCodeGate,
  loadAccessCodeGateConfig
} from "./access-code-gate.js";
import { buildApp } from "./app.js";
import { installDataExtractionHttpErrorMapping } from "./data-extraction-http-errors.js";
import { registerDataExportRoutes } from "./data-export-routes.js";
import { registerDataExtractionRoutes } from "./data-extraction-routes.js";
import { registerProductRoutes } from "./product-routes.js";
import { registerSupplementalUiRoutes } from "./supplemental-ui-routes.js";

const config = loadApiConfig();
const store = new SqliteStore({ databasePath: path.join(config.dataDir, "docomator.db") });
const objectStore = new ContentAddressedObjectStore(path.join(config.dataDir, "objects"));
installDataExtractionHttpErrorMapping();
const app = buildApp(config, { store, objectStore });
installAccessCodeGate(
  app,
  loadAccessCodeGateConfig(),
  createSqliteAccessCodeCredentialStore(store)
);
registerDataExportRoutes(app, store);
registerSupplementalUiRoutes(app);
registerProductRoutes(app, store, objectStore);
registerDataExtractionRoutes(
  app,
  new DocumentQuarantineRegistry(store, objectStore),
  objectStore,
  new DataExtractionRegistry(store)
);

let closing = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "shutdown requested");
  const timer = setTimeout(() => {
    app.log.error("graceful shutdown timed out");
    process.exit(1);
  }, 10_000);
  timer.unref();
  try {
    await app.close();
    store.close();
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
  const address = app.server.address();
  if (
    typeof process.send === "function" &&
    process.connected &&
    address !== null &&
    typeof address === "object"
  ) {
    process.send({ type: "listening", host: config.host, port: address.port });
  }
} catch (error) {
  app.log.fatal({ error }, "api failed to start");
  store.close();
  process.exit(1);
}
