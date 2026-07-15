import { DataImportRegistry } from "./data-import.js";
import { SqliteStore } from "./database.js";
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
  return new DataImportRegistry(store, { spaces: registry });
}
