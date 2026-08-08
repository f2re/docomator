import type { DataImportRegistry } from "./data-import.js";
import { SqliteStore } from "./database.js";
import { SpaceCompatibleDataImportRegistry } from "./space-compatible-data-import.js";
import type { SpaceRegistry } from "./spaces.js";

export function dataImportRegistryFromSpaceRegistry(
  registry: SpaceRegistry
): DataImportRegistry {
  const store = Reflect.get(registry as object, "store");
  if (!(store instanceof SqliteStore)) {
    throw new TypeError(
      "Space registry does not expose its backing SQLite store"
    );
  }
  return new SpaceCompatibleDataImportRegistry(store, { spaces: registry });
}
