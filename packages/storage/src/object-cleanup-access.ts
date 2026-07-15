import { SqliteStore } from "./database.js";
import type { DocumentGenerationRegistry } from "./document-generation.js";
import { ContentAddressedObjectStore } from "./object-store.js";
import { ObjectCleanupRegistry } from "./object-cleanup.js";

export function objectCleanupRegistryFromGenerationRegistry(
  registry: DocumentGenerationRegistry,
  objectStore: ContentAddressedObjectStore
): ObjectCleanupRegistry {
  const store = Reflect.get(registry as object, "store");
  if (!(store instanceof SqliteStore)) {
    throw new TypeError(
      "Document generation registry does not expose its backing SQLite store"
    );
  }
  return new ObjectCleanupRegistry(store, objectStore);
}
