import {
  EmployeeRegistry,
  type CreateEmployeeInput,
  type CreateEmployeeResult,
  type UpdateEmployeeInput,
  type EmployeeProfileRecord
} from "./employees.js";
import { SqliteStore } from "./database.js";
import {
  KnowledgeConflictError,
  KnowledgeValidationError,
  normalizePropertyUiGroup,
  propertyUiGroupFromValidation,
  type MutationContext,
  type PropertyDefinitionRecord
} from "./knowledge.js";
import { PROPERTY_VALUE_TYPES, type PropertyValueType } from "./property-codec.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";

const PERSON_TYPE_KEY = "person";

function normalizedLabel(value: string): string {
  return String(value)
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("ru-RU");
}

function propertyValueType(value: string): PropertyValueType {
  if (!PROPERTY_VALUE_TYPES.includes(value as PropertyValueType)) {
    throw new KnowledgeValidationError(`Unsupported property value type: ${value}`);
  }
  return value as PropertyValueType;
}

export class SpaceIsolatedEmployeeRegistry extends EmployeeRegistry {
  constructor(private readonly scopedStore: SqliteStore) {
    super(scopedStore);
  }

  static fromRegistry(registry: EmployeeRegistry): SpaceIsolatedEmployeeRegistry {
    const store = Reflect.get(registry as object, "store");
    if (!(store instanceof SqliteStore)) {
      throw new TypeError(
        "Employee registry does not expose its backing SQLite store"
      );
    }
    return new SpaceIsolatedEmployeeRegistry(store);
  }

  override create(
    spaceIdentity: string,
    input: CreateEmployeeInput,
    context: MutationContext
  ): CreateEmployeeResult {
    return this.scopedStore.transaction(() =>
      super.create(
        spaceIdentity,
        {
          ...input,
          fields: this.prepareFields(spaceIdentity, input.fields, context)
        },
        context
      )
    );
  }

  override update(
    spaceIdentity: string,
    employeeId: string,
    input: UpdateEmployeeInput,
    context: MutationContext
  ): EmployeeProfileRecord {
    return this.scopedStore.transaction(() =>
      super.update(
        spaceIdentity,
        employeeId,
        {
          ...input,
          fields: this.prepareFields(spaceIdentity, input.fields, context)
        },
        context
      )
    );
  }

  private prepareFields(
    spaceIdentity: string,
    fields: CreateEmployeeInput["fields"] | UpdateEmployeeInput["fields"],
    context: MutationContext
  ) {
    if (fields === undefined) return undefined;
    const knowledge = new SpaceScopedKnowledgeRegistry(
      this.scopedStore,
      spaceIdentity
    );
    return fields.map((field) => {
      if (field.propertyKey !== undefined) {
        knowledge.getPropertyDefinition(field.propertyKey);
        return field;
      }
      if (field.definition === undefined) return field;
      const definition = this.resolveDefinition(
        knowledge,
        field.definition,
        context
      );
      return {
        propertyKey: definition.key,
        value: field.value
      };
    });
  }

  private resolveDefinition(
    knowledge: SpaceScopedKnowledgeRegistry,
    input: {
      label: string;
      valueType: string;
      unit?: string | null;
      uiGroup?: string;
    },
    context: MutationContext
  ): PropertyDefinitionRecord {
    const label = String(input.label || "").trim();
    if (!label) {
      throw new KnowledgeValidationError("Название поля не должно быть пустым.");
    }
    const valueType = propertyValueType(input.valueType);
    const uiGroup = normalizePropertyUiGroup(input.uiGroup ?? "unassigned");
    const matches = knowledge.listPropertyDefinitions(500).filter((definition) =>
      (definition.appliesTo.length === 0 || definition.appliesTo.includes(PERSON_TYPE_KEY)) &&
      normalizedLabel(definition.label) === normalizedLabel(label) &&
      propertyUiGroupFromValidation(definition.validation) === uiGroup
    );
    if (matches.length > 1) {
      throw new KnowledgeConflictError(
        `В текущем пространстве найдено несколько полей с названием «${label}». Выберите конкретное поле.`
      );
    }
    const existing = matches[0];
    if (existing !== undefined) {
      if (existing.valueType !== valueType) {
        throw new KnowledgeConflictError(
          `Поле «${label}» в текущем пространстве уже имеет другой тип данных.`
        );
      }
      return existing;
    }
    return knowledge.createPropertyDefinition(
      {
        label,
        valueType,
        unit: input.unit ?? undefined,
        cardinality: "single",
        sensitivity: "personal",
        appliesTo: [PERSON_TYPE_KEY],
        validation: { uiGroup }
      },
      context
    );
  }
}
