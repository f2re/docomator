import { SqliteStore } from "./database.js";
import {
  resolveDocumentMemberValues,
  type DocumentMemberValueSource,
  type DocumentValueIssue
} from "./document-values.js";
import { parseJson, type JsonValue } from "./json.js";
import type {
  ActiveTemplateReleaseRecord,
  TemplateReleaseRegistry
} from "./template-releases.js";
import { TemplatePreviewActivationRegistry } from "./template-preview-activation.js";
import { TemplateDraftRegistry } from "./template-drafts.js";
import { MultiFieldTestVersionRegistry } from "./multi-field-test-versions.js";
import { TemplateTestVersionRegistry } from "./template-test-versions.js";
import { AudienceGroupNotFoundError } from "./spaces.js";
import { WorkspaceNotFoundError } from "./object-reconciliation.js";

export type DocumentPreflightTargetMode = "personal" | "aggregate";

export interface DocumentPreflightInput {
  targetMode: DocumentPreflightTargetMode;
  entityId?: string;
  audienceSnapshotId?: string;
}

export interface DocumentPreflightMember {
  entityId: string;
  displayName: string;
  values: Record<string, JsonValue | null>;
  issues: DocumentValueIssue[];
}

export interface DocumentPreflightResult {
  template: {
    releaseId: string;
    draftId: string;
    title: string;
    format: "docx" | "xlsx";
    versionNumber: number;
  };
  targetMode: DocumentPreflightTargetMode;
  audience: {
    snapshotId: string | null;
    snapshotName: string | null;
    memberCount: number;
  };
  members: DocumentPreflightMember[];
  missingRequiredCount: number;
  invalidValueCount: number;
  ready: boolean;
}

interface TemplateSourceRow {
  id: string;
  space_id: string;
  title: string;
  format: string;
}

interface AudienceMemberRow {
  entity_id: string;
  display_name: string;
}

interface PropertyValueRow {
  entity_id: string;
  property_key: string;
  alias_key: string | null;
  value_json: string;
}

export class DocumentPreflightValidationError extends Error {
  override readonly name = "DocumentPreflightValidationError";
}

export class DocumentPreflightNotFoundError extends Error {
  override readonly name = "DocumentPreflightNotFoundError";
}

export class DocumentPreflightConflictError extends Error {
  override readonly name = "DocumentPreflightConflictError";
}

function requiredText(value: string, name: string, maximum = 160): string {
  if (typeof value !== "string") {
    throw new DocumentPreflightValidationError(`${name} must be a string`);
  }
  const normalized = value.normalize("NFKC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new DocumentPreflightValidationError(`${name} is invalid`);
  }
  return normalized;
}

function targetMode(value: string): DocumentPreflightTargetMode {
  if (value === "personal" || value === "aggregate") return value;
  throw new DocumentPreflightValidationError(
    "targetMode must be personal or aggregate"
  );
}

function templateSource(
  store: SqliteStore,
  release: ActiveTemplateReleaseRecord
): TemplateSourceRow {
  const source = store.execute((connection) =>
    connection
      .prepare(`
        SELECT id, space_id, title, format
        FROM template_drafts
        WHERE id = ?
      `)
      .get(release.draftId) as TemplateSourceRow | undefined
  );
  if (source === undefined) {
    throw new DocumentPreflightNotFoundError(
      `Template draft was not found for active release: ${release.draftId}`
    );
  }
  return source;
}

function templateDefinitions(
  store: SqliteStore,
  release: ActiveTemplateReleaseRecord
) {
  if (release.versionKind === "multi") {
    return new MultiFieldTestVersionRegistry(store).get(release.versionId).fields.map(
      (field) => ({
        key: field.fieldKey,
        label: field.fieldLabel,
        valueType: field.valueType,
        required: field.required,
        binding: field.binding,
        formatter: field.formatter
      })
    );
  }
  return [
    (() => {
      const version = new TemplateTestVersionRegistry(store).get(release.versionId);
      return {
        key: version.fieldKey,
        label: version.fieldLabel,
        valueType: version.valueType,
        required: version.required,
        binding: version.binding,
        formatter: version.formatter
      };
    })()
  ];
}

function loadMembers(
  store: SqliteStore,
  spaceId: string,
  snapshotId: string
): DocumentMemberValueSource[] {
  return store.execute((connection) => {
    const members = connection
      .prepare(`
        SELECT asm.entity_id, e.display_name
        FROM audience_snapshot_members asm
        JOIN entities e ON e.id = asm.entity_id
        WHERE asm.snapshot_id = ?
        ORDER BY asm.ordinal ASC, asm.entity_id ASC
      `)
      .all(snapshotId) as unknown as AudienceMemberRow[];
    if (members.length === 0) return [];
    const memberIds = members.map((member) => member.entity_id);
    const placeholders = memberIds.map(() => "?").join(", ");
    const properties = connection
      .prepare(`
        SELECT
          v.entity_id,
          p.key AS property_key,
          alias.alias_key AS alias_key,
          v.value_json
        FROM entity_property_values v
        JOIN property_definitions p ON p.id = v.property_definition_id
        JOIN (
          SELECT entity_id, property_definition_id, MAX(version) AS max_version
          FROM entity_property_values
          WHERE entity_id IN (${placeholders})
          GROUP BY entity_id, property_definition_id
        ) latest
          ON latest.entity_id = v.entity_id
         AND latest.property_definition_id = v.property_definition_id
         AND latest.max_version = v.version
        LEFT JOIN space_property_definition_aliases alias
          ON alias.space_id = ?
         AND alias.property_definition_id = v.property_definition_id
        WHERE v.entity_id IN (${placeholders})
        ORDER BY v.entity_id ASC, p.key ASC, alias.alias_key ASC
      `)
      .all(...memberIds, spaceId, ...memberIds) as unknown as PropertyValueRow[];
    const propertiesByEntity = new Map<string, Record<string, JsonValue | null>>();
    for (const property of properties) {
      const values = propertiesByEntity.get(property.entity_id) ?? {};
      const value = parseJson(property.value_json);
      values[property.property_key] = value;
      if (property.alias_key !== null) values[property.alias_key] = value;
      propertiesByEntity.set(property.entity_id, values);
    }
    return members.map((member) => ({
      entityId: member.entity_id,
      displayName: member.display_name,
      properties: propertiesByEntity.get(member.entity_id) ?? {}
    }));
  });
}

export class DocumentPreflightRegistry {
  private readonly templates: TemplatePreviewActivationRegistry;
  private readonly drafts: TemplateDraftRegistry;

  constructor(private readonly store: SqliteStore) {
    this.templates = new TemplatePreviewActivationRegistry(store);
    this.drafts = new TemplateDraftRegistry(store);
  }

  check(
    templateIdentity: string,
    input: DocumentPreflightInput
  ): DocumentPreflightResult {
    const release = this.templates.getActiveRelease(templateIdentity);
    const source = templateSource(this.store, release);
    const mode = targetMode(input.targetMode);
    const fields = templateDefinitions(this.store, release);
    const draft = this.drafts.get(source.id);
    const repeatBinding = draft.repeatBinding;
    const snapshotId =
      input.audienceSnapshotId === undefined
        ? null
        : requiredText(input.audienceSnapshotId, "audienceSnapshotId");
    const entityId =
      input.entityId === undefined
        ? null
        : requiredText(input.entityId, "entityId");

    if (mode === "personal" && entityId === null) {
      throw new DocumentPreflightValidationError(
        "entityId is required for personal preflight"
      );
    }
    if (mode === "aggregate" && snapshotId === null) {
      throw new DocumentPreflightValidationError(
        "audienceSnapshotId is required for aggregate preflight"
      );
    }

    const audience = this.resolveAudience(source.space_id, mode, entityId, snapshotId);
    const members = loadMembers(this.store, source.space_id, audience.snapshotId);
    if (members.length === 0) {
      throw new DocumentPreflightConflictError(
        "Audience snapshot does not contain any members"
      );
    }

    const resolvedMembers = members.map((member) => {
      const resolved = resolveDocumentMemberValues(member, fields);
      return {
        entityId: member.entityId,
        displayName: member.displayName,
        values: resolved.values,
        issues: resolved.issues
      };
    });
    const issues = resolvedMembers.flatMap((member) => member.issues);
    const missingRequiredCount = issues.filter(
      (issue) => issue.code === "required_value_missing"
    ).length;
    const invalidValueCount = issues.filter(
      (issue) => issue.code !== "required_value_missing"
    ).length;

    return {
      template: {
        releaseId: release.id,
        draftId: release.draftId,
        title: release.title,
        format: release.format,
        versionNumber: release.versionNumber
      },
      targetMode: mode,
      audience: {
        snapshotId: audience.snapshotId,
        snapshotName: audience.snapshotName,
        memberCount: resolvedMembers.length
      },
      members: resolvedMembers,
      missingRequiredCount,
      invalidValueCount,
      ready:
        missingRequiredCount === 0 &&
        invalidValueCount === 0 &&
        (repeatBinding === null || mode === "aggregate")
    };
  }

  private resolveAudience(
    spaceId: string,
    mode: DocumentPreflightTargetMode,
    entityId: string | null,
    snapshotId: string | null
  ): { snapshotId: string; snapshotName: string | null } {
    if (mode === "aggregate") {
      try {
        const snapshot = this.store.execute((connection) =>
          connection
            .prepare(`
              SELECT id, name
              FROM audience_snapshots
              WHERE id = ? AND space_id = ?
            `)
            .get(snapshotId, spaceId) as
            | { id: string; name: string | null }
            | undefined
        );
        if (snapshot === undefined) {
          throw new AudienceGroupNotFoundError(
            `Audience snapshot was not found: ${snapshotId}`
          );
        }
        return { snapshotId: snapshot.id, snapshotName: snapshot.name };
      } catch (error) {
        if (error instanceof AudienceGroupNotFoundError) {
          throw new DocumentPreflightNotFoundError(error.message);
        }
        throw error;
      }
    }

    const result = this.store.execute((connection) => {
      const entity = connection
        .prepare(`
          SELECT e.id, e.display_name
          FROM space_entity_ownership seo
          JOIN entities e ON e.id = seo.entity_id
          WHERE seo.space_id = ? AND seo.entity_id = ?
        `)
        .get(spaceId, entityId) as
        | { id: string; display_name: string }
        | undefined;
      if (entity === undefined) {
        throw new WorkspaceNotFoundError(
          `Entity was not found in the template space: ${entityId}`
        );
      }
      const snapshot = connection
        .prepare(`
          SELECT id, name
          FROM audience_snapshots
          WHERE space_id = ?
            AND id IN (
              SELECT snapshot_id
              FROM audience_snapshot_members
              WHERE entity_id = ?
            )
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `)
        .get(spaceId, entityId) as
        | { id: string; name: string | null }
        | undefined;
      return { entity, snapshot };
    });
    if (result.snapshot !== undefined) {
      return {
        snapshotId: result.snapshot.id,
        snapshotName: result.snapshot.name
      };
    }
    throw new DocumentPreflightConflictError(
      "Personal preflight requires an audience snapshot that contains the selected entity"
    );
  }
}
