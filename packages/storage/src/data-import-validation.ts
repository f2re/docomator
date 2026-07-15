import { SqliteStore } from "./database.js";
import {
  DataImportValidationError,
  type DataImportPropertyMapping
} from "./data-import.js";
import {
  KnowledgeNotFoundError,
  KnowledgeRegistry
} from "./knowledge.js";
import type { SpaceRegistry } from "./spaces.js";

export function validateExistingImportIdentityProperty(input: {
  spaces: SpaceRegistry;
  entityTypeKey: string;
  identityPropertyKey: string;
  mappings: readonly DataImportPropertyMapping[];
}): void {
  const store = Reflect.get(input.spaces as object, "store");
  if (!(store instanceof SqliteStore)) {
    throw new TypeError("Space registry does not expose its backing SQLite store");
  }
  const knowledge = new KnowledgeRegistry(store);
  const entityType = knowledge.getEntityType(input.entityTypeKey);
  try {
    const property = knowledge.getPropertyDefinition(input.identityPropertyKey);
    if (property.valueType !== "string") {
      throw new DataImportValidationError(
        "Существующее свойство устойчивого ключа должно иметь тип «Короткая строка»."
      );
    }
    if (
      property.appliesTo.length > 0 &&
      !property.appliesTo.includes(entityType.key)
    ) {
      throw new DataImportValidationError(
        `Свойство устойчивого ключа не применяется к типу «${entityType.label}».`
      );
    }
  } catch (error) {
    if (!(error instanceof KnowledgeNotFoundError)) throw error;
    const mapping = input.mappings.find(
      (candidate) =>
        candidate.propertyKey !== undefined &&
        candidate.propertyKey.trim().toLowerCase() ===
        input.identityPropertyKey.trim().toLowerCase()
    );
    if (!mapping?.createIfMissing) {
      throw new DataImportValidationError(
        "Свойство устойчивого ключа не существует и его создание не разрешено."
      );
    }
  }
}
