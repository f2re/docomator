import {
  DataImportRegistry,
  type DataImportPropertyMapping,
  type DataImportRunRecord,
  type ExecuteDataImportInput
} from "./data-import.js";
import { SqliteStore } from "./database.js";
import {
  KnowledgeNotFoundError,
  type KnowledgeRegistry,
  type MutationContext
} from "./knowledge.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import { SpaceRegistry } from "./spaces.js";

/**
 * Compatibility adapter for import mappings saved before migration 0030.
 * Historical keys are resolved only through the alias table of the selected
 * space and are converted to the physical clone before the import runs.
 */
export class SpaceCompatibleDataImportRegistry extends DataImportRegistry {
  private readonly compatibleSpaces: SpaceRegistry;

  constructor(
    private readonly compatibleStore: SqliteStore,
    options: {
      spaces?: SpaceRegistry;
      knowledge?: KnowledgeRegistry;
    } = {}
  ) {
    const spaces = options.spaces ?? new SpaceRegistry(compatibleStore);
    super(compatibleStore, { ...options, spaces });
    this.compatibleSpaces = spaces;
  }

  override execute(
    spaceIdentity: string,
    input: ExecuteDataImportInput,
    context: MutationContext
  ): DataImportRunRecord {
    const knowledge = new SpaceScopedKnowledgeRegistry(
      this.compatibleStore,
      spaceIdentity,
      { spaces: this.compatibleSpaces }
    );
    const resolveExistingKey = (value: string): string => {
      try {
        return knowledge.getPropertyDefinition(value).key;
      } catch (error) {
        if (error instanceof KnowledgeNotFoundError) return value;
        throw error;
      }
    };
    const mapping = (source: DataImportPropertyMapping): DataImportPropertyMapping => {
      if (source.propertyKey === undefined) return source;
      return {
        ...source,
        propertyKey: resolveExistingKey(source.propertyKey)
      };
    };
    const { identityPropertyKey, mappings, ...rest } = input;
    const normalized: ExecuteDataImportInput = {
      ...rest,
      mappings: mappings.map(mapping),
      ...(identityPropertyKey === undefined
        ? {}
        : { identityPropertyKey: resolveExistingKey(identityPropertyKey) })
    };
    return super.execute(spaceIdentity, normalized, context);
  }
}
