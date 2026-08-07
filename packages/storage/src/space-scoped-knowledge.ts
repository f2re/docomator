import { SqliteStore } from "./database.js";
import {
  KnowledgeNotFoundError,
  KnowledgeRegistry,
  KnowledgeValidationError,
  type AppendPropertyValueInput,
  type CreatePropertyDefinitionInput,
  type ListPropertyValueHistoryOptions,
  type MutationContext,
  type PropertyDefinitionRecord,
  type PropertyValueRecord
} from "./knowledge.js";
import { SpaceRegistry } from "./spaces.js";

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new KnowledgeValidationError("limit must be an integer in range 1..500");
  }
  return limit;
}

export class SpaceScopedKnowledgeRegistry extends KnowledgeRegistry {
  readonly spaceId: string;

  constructor(
    private readonly scopedStore: SqliteStore,
    spaceIdentity: string,
    options: { spaces?: SpaceRegistry } = {}
  ) {
    super(scopedStore);
    const spaces = options.spaces ?? new SpaceRegistry(scopedStore);
    this.spaceId = spaces.getSpace(spaceIdentity).id;
  }

  static fromRegistry(
    registry: KnowledgeRegistry,
    spaceIdentity: string
  ): SpaceScopedKnowledgeRegistry {
    const store = Reflect.get(registry as object, "store");
    if (!(store instanceof SqliteStore)) {
      throw new TypeError(
        "Knowledge registry does not expose its backing SQLite store"
      );
    }
    return new SpaceScopedKnowledgeRegistry(store, spaceIdentity);
  }

  override listPropertyDefinitions(limitValue?: number): PropertyDefinitionRecord[] {
    const limit = normalizeLimit(limitValue);
    const keys = this.scopedStore.execute((connection) =>
      connection
        .prepare(`
          SELECT property_definition.key
          FROM space_property_definitions scoped
          JOIN property_definitions property_definition
            ON property_definition.id = scoped.property_definition_id
          WHERE scoped.space_id = ?
          ORDER BY property_definition.key ASC
          LIMIT ?
        `)
        .all(this.spaceId, limit) as unknown as Array<{ key: string }>
    );
    return keys.map((row) => super.getPropertyDefinition(row.key));
  }

  override getPropertyDefinition(keyValue: string): PropertyDefinitionRecord {
    const definition = super.getPropertyDefinition(keyValue);
    this.assertDefinitionOwned(definition.id);
    return definition;
  }

  override createPropertyDefinition(
    input: CreatePropertyDefinitionInput,
    contextInput: MutationContext
  ): PropertyDefinitionRecord {
    const created = super.createPropertyDefinition(input, contextInput);
    this.scopedStore.execute((connection) => {
      connection
        .prepare(`
          INSERT INTO space_property_definitions(
            space_id,
            property_definition_id,
            created_at
          ) VALUES (?, ?, ?)
        `)
        .run(this.spaceId, created.id, created.createdAt);
    });
    return created;
  }

  override updatePropertyDefinitionUiGroup(
    keyValue: string,
    uiGroupValue: string,
    contextInput: MutationContext
  ): PropertyDefinitionRecord {
    this.getPropertyDefinition(keyValue);
    return super.updatePropertyDefinitionUiGroup(
      keyValue,
      uiGroupValue,
      contextInput
    );
  }

  override appendPropertyValue(
    input: AppendPropertyValueInput,
    contextInput: MutationContext
  ): PropertyValueRecord {
    this.assertEntityOwned(input.entityId);
    this.getPropertyDefinition(input.propertyKey);
    return super.appendPropertyValue(input, contextInput);
  }

  override listPropertyValueHistory(
    entityIdValue: string,
    options: ListPropertyValueHistoryOptions = {}
  ): PropertyValueRecord[] {
    this.assertEntityOwned(entityIdValue);
    if (options.propertyKey !== undefined) {
      this.getPropertyDefinition(options.propertyKey);
    }
    return super.listPropertyValueHistory(entityIdValue, options);
  }

  private assertDefinitionOwned(propertyDefinitionId: string): void {
    const owned = this.scopedStore.execute(
      (connection) =>
        connection
          .prepare(`
            SELECT 1 AS found
            FROM space_property_definitions
            WHERE space_id = ? AND property_definition_id = ?
          `)
          .get(this.spaceId, propertyDefinitionId) !== undefined
    );
    if (!owned) {
      throw new KnowledgeNotFoundError(
        "Поле не найдено в выбранном пространстве."
      );
    }
  }

  private assertEntityOwned(entityId: string): void {
    const owned = this.scopedStore.execute(
      (connection) =>
        connection
          .prepare(`
            SELECT 1 AS found
            FROM space_entity_ownership
            WHERE space_id = ? AND entity_id = ?
          `)
          .get(this.spaceId, entityId) !== undefined
    );
    if (!owned) {
      throw new KnowledgeNotFoundError(
        "Объект не найден в выбранном пространстве."
      );
    }
  }
}
