import { SqliteStore } from "./database.js";
import { ObjectCleanupRegistry } from "./object-cleanup.js";
import { SpaceScopedPublicationRegistry } from "./space-scoped-publications.js";
import type { PublicationRegistry } from "./publications.js";

export function publicationRegistryFromObjectCleanupRegistry(
  registry: ObjectCleanupRegistry
): PublicationRegistry {
  const store = Reflect.get(registry as object, "store");
  if (!(store instanceof SqliteStore)) {
    throw new TypeError(
      "Object cleanup registry does not expose its backing SQLite store"
    );
  }
  return new SpaceScopedPublicationRegistry(store);
}
