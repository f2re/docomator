import { SqliteStore } from "./database.js";
import {
  DataImportValidationError,
  type DataImportPropertyMapping
} from "./data-import.js";
import { KnowledgeNotFoundError, KnowledgeRegistry } from "./knowledge.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import type { SpaceRegistry } from "./spaces.js";
import { dataImportOperationIssue } from "./data-import-errors.js";

export function validateExistingImportIdentityProperty(input: {
  spaces: SpaceRegistry;
  spaceIdentity: string;
  entityTypeKey: string;
  identityPropertyKey: string;
  mappings: readonly DataImportPropertyMapping[];
}): void {
  const store = Reflect.get(input.spaces as object, "store");
  if (!(store instanceof SqliteStore)) {
    throw new TypeError("Space registry does not expose its backing SQLite store");
  }
  const globalKnowledge = new KnowledgeRegistry(store);
  const knowledge = new SpaceScopedKnowledgeRegistry(
    store,
    input.spaceIdentity,
    { spaces: input.spaces }
  );
  const entityType = globalKnowledge.getEntityType(input.entityTypeKey);
  try {
    const property = knowledge.getPropertyDefinition(input.identityPropertyKey);
    if (property.valueType !== "string") {
      const message = "Существующее свойство устойчивого ключа должно иметь тип «Короткая строка».";
      const mapping = input.mappings.find((candidate) => candidate.propertyKey === input.identityPropertyKey);
      throw new DataImportValidationError(
        message,
        dataImportOperationIssue({
          code: "mapping_type_mismatch",
          scope: "mapping",
          blockingEffect: "mapping",
          message,
          suggestedAction: "Выберите текстовое поле для устойчивого ключа либо создайте новое текстовое поле.",
          ...(mapping?.column === undefined ? {} : { column: mapping.column }),
          propertyKey: input.identityPropertyKey
        })
      );
    }
    if (
      property.appliesTo.length > 0 &&
      !property.appliesTo.includes(entityType.key)
    ) {
      const message = `Свойство устойчивого ключа не применяется к типу «${entityType.label}».`;
      const mapping = input.mappings.find((candidate) => candidate.propertyKey === input.identityPropertyKey);
      throw new DataImportValidationError(
        message,
        dataImportOperationIssue({
          code: "mapping_target_missing",
          scope: "mapping",
          blockingEffect: "mapping",
          message,
          suggestedAction: "Выберите поле, доступное для текущего типа объектов.",
          ...(mapping?.column === undefined ? {} : { column: mapping.column }),
          propertyKey: input.identityPropertyKey
        })
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
      const message = "Свойство устойчивого ключа не существует в выбранном пространстве и его создание не разрешено.";
      throw new DataImportValidationError(
        message,
        dataImportOperationIssue({
          code: "mapping_target_missing",
          scope: "mapping",
          blockingEffect: "mapping",
          message,
          suggestedAction: "Выберите существующее поле текущего пространства либо разрешите создание нового поля.",
          ...(mapping?.column === undefined ? {} : { column: mapping.column }),
          propertyKey: input.identityPropertyKey
        })
      );
    }
  }
}
