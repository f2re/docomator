import { AssistedDataImportRegistry } from "./data-import-assist.js";
import { SqliteStore } from "./database.js";
import type { SpaceRegistry } from "./spaces.js";

export function assistedDataImportRegistryFromSpaceRegistry(
  registry: SpaceRegistry
): AssistedDataImportRegistry {
  const store = Reflect.get(registry as object, "store");
  if (!(store instanceof SqliteStore)) {
    throw new TypeError(
      "Space registry does not expose its backing SQLite store"
    );
  }
  return new AssistedDataImportRegistry(store, { spaces: registry });
}
