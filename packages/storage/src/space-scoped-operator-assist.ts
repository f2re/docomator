import {
  OperatorAssistRegistry,
  type PropertySuggestionRecord,
  type UpdatePropertyDefinitionInput
} from "./operator-assist.js";
import { SqliteStore } from "./database.js";
import type {
  MutationContext,
  PropertyDefinitionRecord
} from "./knowledge.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";

/**
 * Организационный контур для пользовательских свойств.
 *
 * OperatorAssistRegistry исторически работает с общей схемой свойств. Этот
 * адаптер оставляет его эксплуатационную логику неизменной, но не позволяет
 * экрану текущего пространства получать или менять пользовательское поле,
 * принадлежащее другому пространству. Исторический key после миграции 0030
 * разрешается только в независимое определение текущего пространства.
 */
export class SpaceScopedOperatorAssistRegistry extends OperatorAssistRegistry {
  constructor(private readonly scopedStore: SqliteStore) {
    super(scopedStore);
  }

  override listPropertySuggestions(
    spaceIdentity: string,
    limitPerPropertyValue = 20
  ): PropertySuggestionRecord[] {
    const knowledge = new SpaceScopedKnowledgeRegistry(
      this.scopedStore,
      spaceIdentity
    );
    const allowedKeys = new Set(
      knowledge.listPropertyDefinitions(500).map((definition) => definition.key)
    );
    return super
      .listPropertySuggestions(spaceIdentity, limitPerPropertyValue)
      .filter((suggestion) => allowedKeys.has(suggestion.propertyKey));
  }

  updatePropertyDefinitionInSpace(
    spaceIdentity: string,
    key: string,
    input: UpdatePropertyDefinitionInput,
    context: MutationContext
  ): PropertyDefinitionRecord {
    const knowledge = new SpaceScopedKnowledgeRegistry(
      this.scopedStore,
      spaceIdentity
    );
    const current = knowledge.assertPropertyDefinitionMutable(key);
    const updated = super.updatePropertyDefinition(current.key, input, context);
    return knowledge.getPropertyDefinition(updated.key);
  }

  extendEnumOptionsInSpace(
    spaceIdentity: string,
    key: string,
    values: readonly string[],
    context: MutationContext
  ): PropertyDefinitionRecord {
    const knowledge = new SpaceScopedKnowledgeRegistry(
      this.scopedStore,
      spaceIdentity
    );
    const current = knowledge.assertPropertyDefinitionMutable(key);
    const updated = super.extendEnumOptions(current.key, values, context);
    return knowledge.getPropertyDefinition(updated.key);
  }
}
