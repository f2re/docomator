import { createHash } from "node:crypto";

import { SqliteStore } from "./database.js";
import type { JsonValue } from "./json.js";
import {
  KnowledgeNotFoundError,
  KnowledgeRegistry,
  type AppendPropertyValueInput,
  type CreatePropertyDefinitionInput,
  type MutationContext,
  type PropertyDefinitionRecord,
  type PropertyValueRecord
} from "./knowledge.js";
import {
  PUBLICATION_DERIVED_PROPERTY_KEYS,
  PublicationConflictError,
  PublicationRegistry,
  type PublicationAuthorRecord,
  type PublicationClassificationRecord,
  type PublicationRegistryConfiguration,
  type PublicationRegistryConfigurationInput,
  type ReplacePublicationAuthorInput,
  type SetPublicationClassificationInput
} from "./publications.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import { SpaceRegistry } from "./spaces.js";

interface PublicationPropertySpecification {
  key: string;
  label: string;
  valueType: CreatePropertyDefinitionInput["valueType"];
  description: string;
  appliesTo: string;
  validation: { [key: string]: JsonValue };
  sensitivity?: CreatePropertyDefinitionInput["sensitivity"];
}

const DERIVED_PROPERTY_SPECS: readonly Omit<
  PublicationPropertySpecification,
  "appliesTo"
>[] = [
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.authors,
    label: "Авторы публикации",
    valueType: "string",
    description: "Сформированный список всех авторов публикации.",
    validation: { uiGroup: "unassigned", systemManaged: true }
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.internalAuthors,
    label: "Авторы-преподаватели",
    valueType: "string",
    description: "Сформированный список связанных преподавателей.",
    validation: { uiGroup: "unassigned", systemManaged: true }
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.departments,
    label: "Кафедры авторов",
    valueType: "string",
    description: "Сформированный список кафедр внутренних авторов.",
    validation: { uiGroup: "unassigned", systemManaged: true }
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.classifications,
    label: "Классификации публикации",
    valueType: "string",
    description: "Сформированный список подтверждённых и проверяемых классификаций.",
    validation: { uiGroup: "unassigned", systemManaged: true }
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.vak,
    label: "Входит в ВАК",
    valueType: "boolean",
    description: "Подтверждённая принадлежность публикации к ВАК.",
    validation: { uiGroup: "unassigned", systemManaged: true }
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.rinc,
    label: "Входит в РИНЦ",
    valueType: "boolean",
    description: "Подтверждённая принадлежность публикации к РИНЦ.",
    validation: { uiGroup: "unassigned", systemManaged: true }
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.mbd,
    label: "Входит в МБД",
    valueType: "boolean",
    description: "Подтверждённая принадлежность публикации к международной базе данных.",
    validation: { uiGroup: "unassigned", systemManaged: true }
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.scopus,
    label: "Входит в Scopus",
    valueType: "boolean",
    description: "Подтверждённая принадлежность публикации к Scopus.",
    validation: { uiGroup: "unassigned", systemManaged: true }
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.webOfScience,
    label: "Входит в Web of Science",
    valueType: "boolean",
    description: "Подтверждённая принадлежность публикации к Web of Science.",
    validation: { uiGroup: "unassigned", systemManaged: true }
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.rincCore,
    label: "Входит в ядро РИНЦ",
    valueType: "boolean",
    description: "Подтверждённая принадлежность публикации к ядру РИНЦ.",
    validation: { uiGroup: "unassigned", systemManaged: true }
  }
];

const DERIVED_BASE_KEYS = new Set<string>(
  Object.values(PUBLICATION_DERIVED_PROPERTY_KEYS)
);

function deterministicScopedKey(baseKey: string, spaceId: string): string {
  const suffix = createHash("sha256")
    .update(spaceId, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `${baseKey}.s${suffix}`;
}

function jsonObject(value: JsonValue | undefined): { [key: string]: JsonValue } {
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== "object") {
    return {};
  }
  return value;
}

function resolveScopedPropertyKey(
  store: SqliteStore,
  spaceId: string,
  baseKey: string
): string {
  const legacyOwned = store.execute(
    (connection) =>
      connection
        .prepare(`
          SELECT 1 AS found
          FROM property_definitions property_definition
          JOIN space_property_definitions scoped
            ON scoped.property_definition_id = property_definition.id
          WHERE property_definition.key = ? AND scoped.space_id = ?
        `)
        .get(baseKey, spaceId) !== undefined
  );
  return legacyOwned ? baseKey : deterministicScopedKey(baseKey, spaceId);
}

function assertCompatibleDefinition(
  record: PropertyDefinitionRecord,
  specification: PublicationPropertySpecification
): void {
  if (record.valueType !== specification.valueType) {
    throw new PublicationConflictError(
      `Поле «${specification.label}» уже существует с другим типом данных.`
    );
  }
  if (
    record.appliesTo.length > 0 &&
    !record.appliesTo.includes(specification.appliesTo)
  ) {
    throw new PublicationConflictError(
      `Поле «${specification.label}» связано с другим типом объектов.`
    );
  }
  const storedValidation = jsonObject(record.validation);
  if (
    specification.validation.systemManaged === true &&
    storedValidation.systemManaged !== true
  ) {
    throw new PublicationConflictError(
      `Системное поле «${specification.label}» занято пользовательским определением.`
    );
  }
}

function ensureScopedProperty(
  store: SqliteStore,
  spaces: SpaceRegistry,
  spaceId: string,
  specification: PublicationPropertySpecification,
  context: MutationContext
): PropertyDefinitionRecord {
  const key = resolveScopedPropertyKey(store, spaceId, specification.key);
  const knowledge = new SpaceScopedKnowledgeRegistry(store, spaceId, { spaces });
  try {
    const existing = knowledge.getPropertyDefinition(key);
    assertCompatibleDefinition(existing, specification);
    return existing;
  } catch (error) {
    if (!(error instanceof KnowledgeNotFoundError)) throw error;
  }
  const created = knowledge.createPropertyDefinition(
    {
      key,
      label: specification.label,
      valueType: specification.valueType,
      description: specification.description,
      sensitivity: specification.sensitivity ?? "internal",
      appliesTo: [specification.appliesTo],
      validation: specification.validation
    },
    context
  );
  assertCompatibleDefinition(created, specification);
  return created;
}

class PublicationDerivedKnowledgeRegistry extends KnowledgeRegistry {
  private readonly scoped: SpaceScopedKnowledgeRegistry;
  private readonly spaceId: string;

  constructor(
    private readonly backingStore: SqliteStore,
    spaceIdentity: string,
    private readonly spaces: SpaceRegistry
  ) {
    super(backingStore);
    this.spaceId = spaces.getSpace(spaceIdentity).id;
    this.scoped = new SpaceScopedKnowledgeRegistry(
      backingStore,
      this.spaceId,
      { spaces }
    );
  }

  private translatedKey(key: string): string {
    return DERIVED_BASE_KEYS.has(key)
      ? resolveScopedPropertyKey(this.backingStore, this.spaceId, key)
      : key;
  }

  override getPropertyDefinition(keyValue: string): PropertyDefinitionRecord {
    return this.scoped.getPropertyDefinition(this.translatedKey(keyValue));
  }

  override createPropertyDefinition(
    input: CreatePropertyDefinitionInput,
    contextInput: MutationContext
  ): PropertyDefinitionRecord {
    if (input.key === undefined || !DERIVED_BASE_KEYS.has(input.key)) {
      return this.scoped.createPropertyDefinition(input, contextInput);
    }
    const appliesTo = input.appliesTo?.[0];
    if (appliesTo === undefined) {
      throw new PublicationConflictError(
        `Системное поле «${input.label}» не содержит тип объектов.`
      );
    }
    const specification: PublicationPropertySpecification = {
      key: input.key,
      label: input.label,
      valueType: input.valueType,
      description: input.description ?? "",
      appliesTo,
      validation: jsonObject(input.validation),
      ...(input.sensitivity === undefined
        ? {}
        : { sensitivity: input.sensitivity })
    };
    return ensureScopedProperty(
      this.backingStore,
      this.spaces,
      this.spaceId,
      specification,
      contextInput
    );
  }

  override appendPropertyValue(
    input: AppendPropertyValueInput,
    contextInput: MutationContext
  ): PropertyValueRecord {
    return this.scoped.appendPropertyValue(
      {
        ...input,
        propertyKey: this.translatedKey(input.propertyKey)
      },
      contextInput
    );
  }
}

export class SpaceScopedPublicationRegistry extends PublicationRegistry {
  private readonly spaces: SpaceRegistry;
  private readonly globalKnowledge: KnowledgeRegistry;

  constructor(private readonly backingStore: SqliteStore) {
    super(backingStore);
    this.spaces = new SpaceRegistry(backingStore);
    this.globalKnowledge = new KnowledgeRegistry(backingStore);
  }

  private resolvedSpaceId(spaceIdentity: string): string {
    return this.spaces.getSpace(spaceIdentity).id;
  }

  private delegate(spaceIdentity: string): PublicationRegistry {
    return new PublicationRegistry(this.backingStore, {
      spaces: this.spaces,
      knowledge: new PublicationDerivedKnowledgeRegistry(
        this.backingStore,
        spaceIdentity,
        this.spaces
      )
    });
  }

  private ensureGlobalEntityType(
    key: string,
    label: string,
    description: string,
    context: MutationContext
  ): void {
    try {
      this.globalKnowledge.getEntityType(key);
      return;
    } catch (error) {
      if (!(error instanceof KnowledgeNotFoundError)) throw error;
    }
    this.globalKnowledge.createEntityType(
      { key, label, description },
      context
    );
  }

  private ensureDerivedProperties(
    spaceIdentity: string,
    publicationEntityTypeKey: string,
    context: MutationContext
  ): void {
    const spaceId = this.resolvedSpaceId(spaceIdentity);
    for (const specification of DERIVED_PROPERTY_SPECS) {
      ensureScopedProperty(
        this.backingStore,
        this.spaces,
        spaceId,
        {
          ...specification,
          appliesTo: publicationEntityTypeKey
        },
        context
      );
    }
  }

  private assertConfiguredPropertiesBelongToSpace(
    spaceIdentity: string,
    input: PublicationRegistryConfigurationInput
  ): void {
    const knowledge = new SpaceScopedKnowledgeRegistry(
      this.backingStore,
      spaceIdentity,
      { spaces: this.spaces }
    );
    for (const key of [
      input.publicationYearPropertyKey,
      input.publicationDatePropertyKey,
      input.teacherDepartmentPropertyKey,
      input.doiPropertyKey,
      input.journalPropertyKey,
      input.bibliographyPropertyKey,
      input.statusPropertyKey
    ]) {
      if (key !== undefined && key !== null) {
        knowledge.getPropertyDefinition(key);
      }
    }
  }

  private ensureDerivedForConfiguredSpace(
    spaceIdentity: string,
    context: MutationContext
  ): void {
    const configuration = super.getConfiguration(spaceIdentity);
    if (configuration === null) return;
    this.ensureDerivedProperties(
      spaceIdentity,
      configuration.publicationEntityTypeKey,
      context
    );
  }

  override configure(
    spaceIdentity: string,
    input: PublicationRegistryConfigurationInput,
    contextInput: MutationContext
  ): PublicationRegistryConfiguration {
    this.assertConfiguredPropertiesBelongToSpace(spaceIdentity, input);
    this.ensureDerivedProperties(
      spaceIdentity,
      input.publicationEntityTypeKey,
      contextInput
    );
    return this.delegate(spaceIdentity).configure(
      spaceIdentity,
      input,
      contextInput
    );
  }

  override ensureDefaultConfiguration(
    spaceIdentity: string,
    contextInput: MutationContext
  ): PublicationRegistryConfiguration {
    const existing = super.getConfiguration(spaceIdentity);
    if (existing !== null) return existing;

    this.ensureGlobalEntityType(
      "scientific-publication",
      "Научная статья",
      "Публикация с авторами, изданием, идентификаторами и классификациями.",
      contextInput
    );
    this.ensureGlobalEntityType(
      "person",
      "Человек",
      "Сотрудник, преподаватель или другой человек.",
      contextInput
    );

    const spaceId = this.resolvedSpaceId(spaceIdentity);
    const publicationProperties: readonly PublicationPropertySpecification[] = [
      {
        key: "publication.year",
        label: "Год публикации",
        valueType: "integer",
        description: "Календарный год публикации.",
        appliesTo: "scientific-publication",
        validation: { uiGroup: "unassigned" }
      },
      {
        key: "publication.date",
        label: "Дата публикации",
        valueType: "date",
        description: "Дата выхода публикации.",
        appliesTo: "scientific-publication",
        validation: { uiGroup: "unassigned" }
      },
      {
        key: "publication.doi",
        label: "DOI",
        valueType: "string",
        description: "Цифровой идентификатор публикации.",
        appliesTo: "scientific-publication",
        validation: { uiGroup: "unassigned" }
      },
      {
        key: "publication.edn",
        label: "EDN",
        valueType: "string",
        description: "Идентификатор публикации в eLIBRARY.",
        appliesTo: "scientific-publication",
        validation: { uiGroup: "unassigned" }
      },
      {
        key: "publication.journal",
        label: "Журнал или сборник",
        valueType: "string",
        description: "Наименование издания.",
        appliesTo: "scientific-publication",
        validation: { uiGroup: "unassigned" }
      },
      {
        key: "publication.issn",
        label: "ISSN или ISBN",
        valueType: "string",
        description: "Идентификатор издания.",
        appliesTo: "scientific-publication",
        validation: { uiGroup: "unassigned" }
      },
      {
        key: "publication.bibliography",
        label: "Библиографическое описание",
        valueType: "text",
        description: "Полное библиографическое описание публикации.",
        appliesTo: "scientific-publication",
        validation: { uiGroup: "unassigned" }
      },
      {
        key: "publication.status",
        label: "Статус публикации",
        valueType: "enum",
        description: "Состояние подготовки и выхода.",
        appliesTo: "scientific-publication",
        validation: {
          enum: ["Подготовка", "Принята", "Опубликована"],
          allowCustom: true,
          uiGroup: "unassigned"
        }
      }
    ];
    const resolved = new Map<string, string>();
    for (const specification of publicationProperties) {
      const field = ensureScopedProperty(
        this.backingStore,
        this.spaces,
        spaceId,
        specification,
        contextInput
      );
      resolved.set(specification.key, field.key);
    }
    const department = ensureScopedProperty(
      this.backingStore,
      this.spaces,
      spaceId,
      {
        key: "person.department",
        label: "Кафедра",
        valueType: "string",
        description: "Кафедра или подразделение преподавателя.",
        appliesTo: "person",
        validation: { uiGroup: "teacher" }
      },
      contextInput
    );
    this.ensureDerivedProperties(
      spaceIdentity,
      "scientific-publication",
      contextInput
    );

    return this.delegate(spaceIdentity).configure(
      spaceIdentity,
      {
        publicationEntityTypeKey: "scientific-publication",
        teacherEntityTypeKey: "person",
        publicationYearPropertyKey: resolved.get("publication.year") ?? null,
        publicationDatePropertyKey: resolved.get("publication.date") ?? null,
        teacherDepartmentPropertyKey: department.key,
        doiPropertyKey: resolved.get("publication.doi") ?? null,
        journalPropertyKey: resolved.get("publication.journal") ?? null,
        bibliographyPropertyKey:
          resolved.get("publication.bibliography") ?? null,
        statusPropertyKey: resolved.get("publication.status") ?? null
      },
      contextInput
    );
  }

  override replaceAuthors(
    spaceIdentity: string,
    publicationEntityIdValue: string,
    values: readonly ReplacePublicationAuthorInput[],
    contextInput: MutationContext
  ): PublicationAuthorRecord[] {
    this.ensureDerivedForConfiguredSpace(spaceIdentity, contextInput);
    return this.delegate(spaceIdentity).replaceAuthors(
      spaceIdentity,
      publicationEntityIdValue,
      values,
      contextInput
    );
  }

  override setClassification(
    spaceIdentity: string,
    publicationEntityIdValue: string,
    codeValue: string,
    input: SetPublicationClassificationInput,
    contextInput: MutationContext
  ): PublicationClassificationRecord {
    this.ensureDerivedForConfiguredSpace(spaceIdentity, contextInput);
    return this.delegate(spaceIdentity).setClassification(
      spaceIdentity,
      publicationEntityIdValue,
      codeValue,
      input,
      contextInput
    );
  }

  override removeClassification(
    spaceIdentity: string,
    publicationEntityIdValue: string,
    codeValue: string,
    contextInput: MutationContext
  ): void {
    this.ensureDerivedForConfiguredSpace(spaceIdentity, contextInput);
    this.delegate(spaceIdentity).removeClassification(
      spaceIdentity,
      publicationEntityIdValue,
      codeValue,
      contextInput
    );
  }
}
