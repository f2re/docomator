import { SqliteStore } from "./database.js";
import {
  KnowledgeConflictError,
  KnowledgeNotFoundError,
  KnowledgeRegistry,
  KnowledgeValidationError,
  type AppendPropertyValueInput,
  type CreateEntityInput,
  type CreatePropertyDefinitionInput,
  type EntityRecord,
  type ListEntitiesOptions,
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

  override createEntity(
    input: CreateEntityInput,
    contextInput: MutationContext
  ): EntityRecord {
    const spaces = new SpaceRegistry(this.scopedStore);
    const created = spaces.createEntity(this.spaceId, input, contextInput);
    return super.getEntity(created.entityId);
  }

  override listEntities(options: ListEntitiesOptions = {}): EntityRecord[] {
    const limit = normalizeLimit(options.limit);
    const spaces = new SpaceRegistry(this.scopedStore);
    return spaces
      .listEntities(this.spaceId, { ...options, limit })
      .map((entity) => super.getEntity(entity.entityId));
  }

  override getEntity(idValue: string): EntityRecord {
    this.assertEntityOwned(idValue);
    return super.getEntity(idValue);
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
    let direct: PropertyDefinitionRecord | null = null;
    try {
      direct = super.getPropertyDefinition(keyValue);
    } catch (error) {
      if (!(error instanceof KnowledgeNotFoundError)) throw error;
    }
    if (direct !== null && this.definitionOwned(direct.id)) return direct;

    const aliased = this.aliasDefinition(keyValue);
    if (aliased !== null) return aliased;

    throw new KnowledgeNotFoundError(
      "Поле не найдено в выбранном пространстве."
    );
  }

  override createPropertyDefinition(
    input: CreatePropertyDefinitionInput,
    contextInput: MutationContext
  ): PropertyDefinitionRecord {
    return this.scopedStore.transaction((connection) => {
      const created = super.createPropertyDefinition(input, contextInput);
      connection
        .prepare(`
          INSERT INTO space_property_definitions(
            space_id,
            property_definition_id,
            created_at
          ) VALUES (?, ?, ?)
        `)
        .run(this.spaceId, created.id, created.createdAt);
      return created;
    });
  }

  /**
   * Explicit compatibility operation for a legacy definition that was created
   * before field ownership existed. Normal reads never adopt definitions.
   * Definitions normalized by migration 0030 resolve to their independent
   * per-space clone and the historical shared record can never be re-adopted.
   */
  adoptUnownedPropertyDefinition(
    keyValue: string
  ): PropertyDefinitionRecord | null {
    let definition: PropertyDefinitionRecord;
    try {
      definition = super.getPropertyDefinition(keyValue);
    } catch (error) {
      if (error instanceof KnowledgeNotFoundError) return null;
      throw error;
    }

    const aliased = this.aliasDefinition(definition.key);
    if (aliased !== null) return aliased;

    const hasNormalizedAliases = this.scopedStore.execute(
      (connection) =>
        connection
          .prepare(`
            SELECT 1 AS found
            FROM space_property_definition_aliases
            WHERE alias_key = ?
            LIMIT 1
          `)
          .get(definition.key) !== undefined
    );
    if (hasNormalizedAliases) {
      throw new KnowledgeNotFoundError(
        "Поле не найдено в выбранном пространстве."
      );
    }

    const state = this.scopedStore.transaction((connection) => {
      const scopes = connection
        .prepare(`
          SELECT space_id
          FROM space_property_definitions
          WHERE property_definition_id = ?
          ORDER BY space_id ASC
        `)
        .all(definition.id) as unknown as Array<{ space_id: string }>;
      if (scopes.some((scope) => scope.space_id === this.spaceId)) {
        return "owned" as const;
      }
      if (scopes.length === 0) {
        connection
          .prepare(`
            INSERT INTO space_property_definitions(
              space_id,
              property_definition_id,
              created_at
            ) VALUES (?, ?, ?)
          `)
          .run(this.spaceId, definition.id, definition.createdAt);
        return "adopted" as const;
      }
      return "foreign" as const;
    });
    if (state === "foreign") {
      throw new KnowledgeNotFoundError(
        "Поле не найдено в выбранном пространстве."
      );
    }
    return definition;
  }

  assertPropertyDefinitionMutable(keyValue: string): PropertyDefinitionRecord {
    const definition = this.getPropertyDefinition(keyValue);
    const scopes = this.scopedStore.execute((connection) =>
      connection
        .prepare(`
          SELECT space_id
          FROM space_property_definitions
          WHERE property_definition_id = ?
          ORDER BY space_id ASC
        `)
        .all(definition.id) as unknown as Array<{ space_id: string }>
    );
    if (scopes.length !== 1 || scopes[0]?.space_id !== this.spaceId) {
      throw new KnowledgeConflictError(
        "Поле не имеет единственного владельца пространства и защищено от изменения. Выполните контролируемую нормализацию данных."
      );
    }
    return definition;
  }

  override updatePropertyDefinitionUiGroup(
    keyValue: string,
    uiGroupValue: string,
    contextInput: MutationContext
  ): PropertyDefinitionRecord {
    const definition = this.assertPropertyDefinitionMutable(keyValue);
    return super.updatePropertyDefinitionUiGroup(
      definition.key,
      uiGroupValue,
      contextInput
    );
  }

  override appendPropertyValue(
    input: AppendPropertyValueInput,
    contextInput: MutationContext
  ): PropertyValueRecord {
    this.assertEntityOwned(input.entityId);
    const definition = this.getPropertyDefinition(input.propertyKey);
    return super.appendPropertyValue(
      { ...input, propertyKey: definition.key },
      contextInput
    );
  }

  override listPropertyValueHistory(
    entityIdValue: string,
    options: ListPropertyValueHistoryOptions = {}
  ): PropertyValueRecord[] {
    this.assertEntityOwned(entityIdValue);
    if (options.propertyKey === undefined) {
      return super.listPropertyValueHistory(entityIdValue, options);
    }
    const definition = this.getPropertyDefinition(options.propertyKey);
    return super.listPropertyValueHistory(entityIdValue, {
      ...options,
      propertyKey: definition.key
    });
  }

  private definitionOwned(propertyDefinitionId: string): boolean {
    return this.scopedStore.execute(
      (connection) =>
        connection
          .prepare(`
            SELECT 1 AS found
            FROM space_property_definitions
            WHERE space_id = ? AND property_definition_id = ?
          `)
          .get(this.spaceId, propertyDefinitionId) !== undefined
    );
  }

  private aliasDefinition(aliasKey: string): PropertyDefinitionRecord | null {
    const row = this.scopedStore.execute((connection) =>
      connection
        .prepare(`
          SELECT definition.key
          FROM space_property_definition_aliases alias
          JOIN property_definitions definition
            ON definition.id = alias.property_definition_id
          WHERE alias.space_id = ? AND alias.alias_key = ?
        `)
        .get(this.spaceId, aliasKey) as { key: string } | undefined
    );
    if (row === undefined) return null;
    const definition = super.getPropertyDefinition(row.key);
    if (!this.definitionOwned(definition.id)) {
      throw new KnowledgeConflictError(
        "Псевдоним поля повреждён и не указывает на определение текущего пространства."
      );
    }
    return definition;
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
