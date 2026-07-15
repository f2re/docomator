import { SqliteStore } from "./database.js";
import type { DocumentGenerationRegistry } from "./document-generation.js";
import { DocumentResultRegistry } from "./document-results.js";

export function documentResultRegistryFromGenerationRegistry(
  registry: DocumentGenerationRegistry
): DocumentResultRegistry {
  const store = Reflect.get(registry as object, "store");
  if (!(store instanceof SqliteStore)) {
    throw new TypeError(
      "Document generation registry does not expose its backing SQLite store"
    );
  }
  return new DocumentResultRegistry(store);
}
