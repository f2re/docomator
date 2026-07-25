import { SqliteStore } from "./database.js";
import type { DocumentScheduleRegistry } from "./document-schedules.js";

export function sqliteStoreFromDocumentScheduleRegistry(
  registry: DocumentScheduleRegistry
): SqliteStore {
  const store = Reflect.get(registry as object, "store");
  if (!(store instanceof SqliteStore)) {
    throw new TypeError(
      "Document schedule registry does not expose its backing SQLite store"
    );
  }
  return store;
}
