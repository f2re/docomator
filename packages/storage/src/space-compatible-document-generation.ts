import { SqliteStore } from "./database.js";
import {
  DocumentGenerationRegistry,
  type DocumentGenerationWork
} from "./document-generation.js";
import { loadDocumentMemberProperties } from "./document-member-properties.js";
import { ContentAddressedObjectStore } from "./object-store.js";

/**
 * Runtime generation registry with compatibility for immutable template fields
 * that still contain a pre-0030 property key. The alias is resolved only in the
 * job's own space; the canonical stored value remains attached to the physical
 * per-space property definition.
 */
export class SpaceCompatibleDocumentGenerationRegistry extends DocumentGenerationRegistry {
  constructor(
    private readonly compatibleStore: SqliteStore,
    objectStore: ContentAddressedObjectStore
  ) {
    super(compatibleStore, objectStore);
  }

  override getWorkForWorker(jobId: string): DocumentGenerationWork {
    const work = super.getWorkForWorker(jobId);
    const propertiesByEntity = this.compatibleStore.execute((connection) =>
      loadDocumentMemberProperties(
        connection,
        work.job.spaceId,
        work.members.map((member) => member.entityId)
      )
    );
    return {
      ...work,
      members: work.members.map((member) => ({
        ...member,
        properties: propertiesByEntity.get(member.entityId) ?? {}
      }))
    };
  }
}
