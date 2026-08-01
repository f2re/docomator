import { SqliteStore } from "./database.js";
import { ObjectCleanupRegistry } from "./object-cleanup.js";
import { ContentAddressedObjectStore } from "./object-store.js";
import { ObjectReconciliationRegistry } from "./object-reconciliation.js";

export function objectReconciliationRegistryFromCleanupRegistry(
  registry: ObjectCleanupRegistry
): ObjectReconciliationRegistry {
  const store = Reflect.get(registry as object, "store");
  const objectStore = Reflect.get(registry as object, "objectStore");
  if (!(store instanceof SqliteStore)) {
    throw new TypeError(
      "Object cleanup registry does not expose its backing SQLite store"
    );
  }
  if (!(objectStore instanceof ContentAddressedObjectStore)) {
    throw new TypeError(
      "Object cleanup registry does not expose its object store"
    );
  }
  return new ObjectReconciliationRegistry(store, objectStore);
}
