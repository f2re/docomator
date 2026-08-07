import {
  AssistedDataImportRegistry,
  type AssistedDataImportPlanRecord,
  type AssistedDataImportRunRecord,
  type AssistedExecuteDataImportInput
} from "./data-import-assist.js";
import { SqliteStore } from "./database.js";
import type { MutationContext } from "./knowledge.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import type { SpaceRegistry } from "./spaces.js";

class SpaceIsolatedAssistedDataImportRegistry extends AssistedDataImportRegistry {
  constructor(
    private readonly backingStore: SqliteStore,
    private readonly spaces: SpaceRegistry
  ) {
    super(backingStore, { spaces });
  }

  override plan(
    spaceIdentity: string,
    input: AssistedExecuteDataImportInput,
    context: MutationContext
  ): AssistedDataImportPlanRecord {
    return this.registryFor(spaceIdentity, input).plan(spaceIdentity, input, context);
  }

  override execute(
    spaceIdentity: string,
    input: AssistedExecuteDataImportInput,
    context: MutationContext
  ): AssistedDataImportRunRecord {
    return this.registryFor(spaceIdentity, input).execute(spaceIdentity, input, context);
  }

  private registryFor(
    spaceIdentity: string,
    input: AssistedExecuteDataImportInput
  ): AssistedDataImportRegistry {
    const knowledge = new SpaceScopedKnowledgeRegistry(
      this.backingStore,
      spaceIdentity,
      { spaces: this.spaces }
    );
    this.adoptExplicitLegacyProperties(knowledge, input);
    return new AssistedDataImportRegistry(this.backingStore, {
      spaces: this.spaces,
      knowledge
    });
  }

  private adoptExplicitLegacyProperties(
    knowledge: SpaceScopedKnowledgeRegistry,
    input: AssistedExecuteDataImportInput
  ): void {
    const keys = new Set<string>();
    if (typeof input.identityPropertyKey === "string") {
      keys.add(input.identityPropertyKey);
    }
    for (const mapping of input.mappings) {
      if (typeof mapping.propertyKey === "string") {
        keys.add(mapping.propertyKey);
      }
    }
    for (const key of keys) {
      try {
        knowledge.getPropertyDefinition(key);
        continue;
      } catch {
        // Compatibility adoption is explicit here. Normal scoped reads remain
        // side-effect free and never acquire an unowned definition.
      }
      const adopted = knowledge.adoptUnownedPropertyDefinition(key);
      if (adopted !== null) continue;
      const mapping = input.mappings.find(
        (candidate) => candidate.propertyKey === key
      );
      if (mapping?.createIfMissing === true) continue;
      // Re-run the normal lookup to produce the standard not-found error.
      knowledge.getPropertyDefinition(key);
    }
  }
}

export function assistedDataImportRegistryFromSpaceRegistry(
  registry: SpaceRegistry
): AssistedDataImportRegistry {
  const store = Reflect.get(registry as object, "store");
  if (!(store instanceof SqliteStore)) {
    throw new TypeError(
      "Space registry does not expose its backing SQLite store"
    );
  }
  return new SpaceIsolatedAssistedDataImportRegistry(store, registry);
}
