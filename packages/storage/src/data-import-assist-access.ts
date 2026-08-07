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
    return this.registryFor(spaceIdentity).plan(spaceIdentity, input, context);
  }

  override execute(
    spaceIdentity: string,
    input: AssistedExecuteDataImportInput,
    context: MutationContext
  ): AssistedDataImportRunRecord {
    return this.registryFor(spaceIdentity).execute(spaceIdentity, input, context);
  }

  private registryFor(spaceIdentity: string): AssistedDataImportRegistry {
    const knowledge = new SpaceScopedKnowledgeRegistry(
      this.backingStore,
      spaceIdentity,
      { spaces: this.spaces }
    );
    return new AssistedDataImportRegistry(this.backingStore, {
      spaces: this.spaces,
      knowledge
    });
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
