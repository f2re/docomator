import { SqliteStore } from "./database.js";
import type { MutationContext } from "./knowledge.js";
import {
  PUBLICATION_DERIVED_PROPERTY_KEYS,
  type PublicationRegistryConfiguration,
  type PublicationRegistryConfigurationInput
} from "./publications.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import { SpaceScopedPublicationRegistry } from "./space-scoped-publications.js";

const STANDARD_PUBLICATION_BASE_KEYS = [
  "publication.year",
  "publication.date",
  "person.department",
  "publication.doi",
  "publication.edn",
  "publication.journal",
  "publication.issn",
  "publication.bibliography",
  "publication.status",
  ...Object.values(PUBLICATION_DERIVED_PROPERTY_KEYS)
] as const;

/** Resolve pre-0030 property keys only through the selected space. */
export class SpaceCompatiblePublicationRegistry extends SpaceScopedPublicationRegistry {
  constructor(private readonly compatibleStore: SqliteStore) {
    super(compatibleStore);
  }

  override configure(
    spaceIdentity: string,
    input: PublicationRegistryConfigurationInput,
    context: MutationContext
  ): PublicationRegistryConfiguration {
    const knowledge = new SpaceScopedKnowledgeRegistry(
      this.compatibleStore,
      spaceIdentity
    );
    const resolve = (key: string | null | undefined): string | null =>
      key === undefined || key === null
        ? null
        : knowledge.getPropertyDefinition(key).key;

    const configuration = super.configure(
      spaceIdentity,
      {
        publicationEntityTypeKey: input.publicationEntityTypeKey,
        teacherEntityTypeKey: input.teacherEntityTypeKey,
        publicationYearPropertyKey: resolve(input.publicationYearPropertyKey),
        publicationDatePropertyKey: resolve(input.publicationDatePropertyKey),
        teacherDepartmentPropertyKey: resolve(input.teacherDepartmentPropertyKey),
        doiPropertyKey: resolve(input.doiPropertyKey),
        journalPropertyKey: resolve(input.journalPropertyKey),
        bibliographyPropertyKey: resolve(input.bibliographyPropertyKey),
        statusPropertyKey: resolve(input.statusPropertyKey)
      },
      context
    );
    this.ensureStandardAliases(spaceIdentity, context.now);
    return configuration;
  }

  override ensureDefaultConfiguration(
    spaceIdentity: string,
    context: MutationContext
  ): PublicationRegistryConfiguration {
    const configuration = super.ensureDefaultConfiguration(spaceIdentity, context);
    this.ensureStandardAliases(spaceIdentity, context.now);
    return configuration;
  }

  private ensureStandardAliases(
    spaceIdentity: string,
    nowValue: Date | string | undefined
  ): void {
    const now =
      nowValue === undefined
        ? new Date().toISOString()
        : nowValue instanceof Date
          ? nowValue.toISOString()
          : new Date(nowValue).toISOString();
    const space = this.compatibleStore.execute((connection) =>
      connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(spaceIdentity, spaceIdentity.trim().toLowerCase()) as
        | { id: string }
        | undefined
    );
    if (space === undefined) return;

    this.compatibleStore.transaction((connection) => {
      const findTarget = connection.prepare(`
        SELECT definition.id, definition.key
        FROM space_property_definitions scoped
        JOIN property_definitions definition
          ON definition.id = scoped.property_definition_id
        WHERE scoped.space_id = ?
          AND (
            definition.key = ?
            OR definition.key LIKE ?
          )
        ORDER BY CASE WHEN definition.key = ? THEN 0 ELSE 1 END, definition.key
        LIMIT 1
      `);
      const insertAlias = connection.prepare(`
        INSERT OR IGNORE INTO space_property_definition_aliases(
          space_id, alias_key, property_definition_id, created_at
        ) VALUES (?, ?, ?, ?)
      `);

      for (const baseKey of STANDARD_PUBLICATION_BASE_KEYS) {
        const target = findTarget.get(
          space.id,
          baseKey,
          `${baseKey}.s%`,
          baseKey
        ) as { id: string; key: string } | undefined;
        if (target === undefined || target.key === baseKey) continue;
        insertAlias.run(space.id, baseKey, target.id, now);
      }
    });
  }
}
