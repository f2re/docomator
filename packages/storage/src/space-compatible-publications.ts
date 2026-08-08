import { SqliteStore } from "./database.js";
import type { MutationContext } from "./knowledge.js";
import type {
  PublicationRegistryConfiguration,
  PublicationRegistryConfigurationInput
} from "./publications.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import { SpaceScopedPublicationRegistry } from "./space-scoped-publications.js";

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

    return super.configure(
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
  }
}
