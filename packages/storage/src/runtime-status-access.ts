import { SqliteStore } from "./database.js";
import type { DocumentGenerationRegistry } from "./document-generation.js";
import { RuntimeStatusRegistry } from "./runtime-status.js";

export function runtimeStatusRegistryFromGenerationRegistry(
  registry: DocumentGenerationRegistry
): RuntimeStatusRegistry {
  const store = Reflect.get(registry as object, "store");
  if (!(store instanceof SqliteStore)) {
    throw new TypeError(
      "Document generation registry does not expose its backing SQLite store"
    );
  }
  return new RuntimeStatusRegistry(store);
}

export function sqliteStoreFromGenerationRegistry(
  registry: DocumentGenerationRegistry
): SqliteStore {
  const store = Reflect.get(registry as object, "store");
  if (!(store instanceof SqliteStore)) {
    throw new TypeError(
      "Document generation registry does not expose its backing SQLite store"
    );
  }
  return store;
}
