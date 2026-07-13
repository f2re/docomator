import { type SqliteExecutor, SqliteStore } from "./database.js";
import type {
  DocumentGenerationField,
  DocumentGenerationFormat,
  DocumentGenerationMember,
  DocumentGenerationMode,
  DocumentGenerationValueType
} from "./document-generation.js";
import { resolveDocumentMemberValues } from "./document-values.js";
import { parseJson, type JsonValue } from "./json.js";

export interface DocumentPreflightMissingField {
  key: string;
  label: string;
}

export interface DocumentPreflightMember {
  entityId: string;
  position: number;
  displayName: string;
  availableCount: number;
  fieldCount: number;
  missingRequired: DocumentPreflightMissingField[];
  ready: boolean;
}

export interface DocumentGenerationPreflight {
  spaceId: string;
  activeReleaseId: string;
  snapshotId: string;
  targetMode: DocumentGenerationMode;
  format: DocumentGenerationFormat;
  templateTitle: string;
  fieldCount: number;
  memberCount: number;
  expectedCount: number;
  readyMemberCount: number;
  missingMemberCount: number;
  missingValueCount: number;
  canStart: boolean;
  startWouldBePartial: boolean;
  members: DocumentPreflightMember[];
}

interface SourceRow {
  space_id: string;
  space_key: string;
  space_name: string;
  release_id: string;
  candidate_id: string;
  title: string;
  format: string;
  field_count: number;
  snapshot_id: string;
  target_mode: string;
  member_count: number;
}

interface FieldRow {
  field_id: string;
  ordinal: number;
  field_key: string;
  field_label: string;
  value_type: string;
  required: number;
  binding_json: string;
  technical_binding_json: string;
}

interface MemberRow {
  entity_id: string;
  position: number;
  display_name_snapshot: string;
  entity_type_key_snapshot: string;
}

interface PropertyRow {
  entity_id: string;
  property_key: string;
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

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new DocumentPreflightValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DocumentPreflightValidationError(`${name} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new DocumentPreflightValidationError(
      `${name} must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function generationMode(value: string): DocumentGenerationMode {
  if (value === "one_per_member" || value === "aggregate") return value;
  throw new DocumentPreflightConflictError(
    `Stored document generation mode is invalid: ${value}`
  );
}

function formatValue(value: string): DocumentGenerationFormat {
  if (value === "docx" || value === "xlsx") return value;
  throw new DocumentPreflightConflictError(
    `Stored document generation format is invalid: ${value}`
  );
}

function valueType(value: string): DocumentGenerationValueType {
  if (
    value === "string" ||
    value === "text" ||
    value === "number" ||
    value === "integer" ||
    value === "boolean" ||
    value === "date" ||
    value === "date-time"
  ) {
    return value;
  }
  throw new DocumentPreflightConflictError(
    `Stored document field value type is invalid: ${value}`
  );
}

function loadFields(
  connection: SqliteExecutor,
  candidateId: string,
  expectedCount: number
): DocumentGenerationField[] {
  const rows = connection
    .prepare(`
      SELECT
        field_id, ordinal, field_key, field_label, value_type,
        required, binding_json, technical_binding_json
      FROM template_release_candidate_fields
      WHERE candidate_id = ?
      ORDER BY ordinal ASC, field_id ASC
    `)
    .all(candidateId) as unknown as FieldRow[];
  if (rows.length !== expectedCount) {
    throw new DocumentPreflightConflictError(
      "Active template field manifest is incomplete"
    );
  }
  return rows.map((field) => ({
    id: field.field_id,
    ordinal: Number(field.ordinal),
    key: field.field_key,
    label: field.field_label,
    valueType: valueType(field.value_type),
    required: field.required === 1,
    binding: parseJson(field.binding_json),
    technicalBinding: parseJson(field.technical_binding_json)
  }));
}

function loadMembers(
  connection: SqliteExecutor,
  snapshotId: string
): DocumentGenerationMember[] {
  const rows = connection
    .prepare(`
      SELECT entity_id, position, display_name_snapshot, entity_type_key_snapshot
      FROM audience_snapshot_members
      WHERE snapshot_id = ?
      ORDER BY position ASC
    `)
    .all(snapshotId) as unknown as MemberRow[];
  const propertiesByEntity = new Map<string, Record<string, JsonValue>>();
  const ids = rows.map((row) => row.entity_id);
  for (let offset = 0; offset < ids.length; offset += 200) {
    const chunk = ids.slice(offset, offset + 200);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(", ");
    const propertyRows = connection
      .prepare(`
        SELECT v.entity_id, p.key AS property_key, v.value_json
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
        ORDER BY v.entity_id, p.key
      `)
      .all(...chunk) as unknown as PropertyRow[];
    for (const property of propertyRows) {
      const values = propertiesByEntity.get(property.entity_id) ?? {};
      values[property.property_key] = parseJson(property.value_json);
      propertiesByEntity.set(property.entity_id, values);
    }
  }
  return rows.map((row) => ({
    entityId: row.entity_id,
    position: Number(row.position),
    displayName: row.display_name_snapshot,
    entityTypeKey: row.entity_type_key_snapshot,
    properties: propertiesByEntity.get(row.entity_id) ?? {}
  }));
}

export class DocumentPreflightRegistry {
  constructor(private readonly store: SqliteStore) {}

  inspect(
    spaceIdentityValue: string,
    activeReleaseIdValue: string,
    snapshotIdValue: string
  ): DocumentGenerationPreflight {
    const spaceIdentity = requiredText(spaceIdentityValue, "spaceId", 160);
    const activeReleaseId = requiredText(
      activeReleaseIdValue,
      "activeReleaseId",
      160
    );
    const snapshotId = requiredText(snapshotIdValue, "snapshotId", 160);

    return this.store.execute((connection) => {
      const source = connection
        .prepare(`
          SELECT
            sp.id AS space_id,
            sp.key AS space_key,
            sp.name AS space_name,
            r.id AS release_id,
            r.candidate_id,
            r.title,
            r.format,
            c.field_count,
            s.id AS snapshot_id,
            s.target_mode,
            s.member_count
          FROM spaces sp
          JOIN template_releases r ON r.id = ? AND r.space_id = sp.id
          JOIN template_release_candidates c ON c.id = r.candidate_id
          JOIN audience_snapshots s ON s.id = ? AND s.space_id = sp.id
          WHERE sp.id = ? OR sp.key = ?
        `)
        .get(
          activeReleaseId,
          snapshotId,
          spaceIdentity,
          spaceIdentity.toLowerCase()
        ) as SourceRow | undefined;
      if (source === undefined) {
        throw new DocumentPreflightNotFoundError(
          "Active template or audience snapshot was not found in this space"
        );
      }
      const targetMode = generationMode(source.target_mode);
      const format = formatValue(source.format);
      const fieldCount = Number(source.field_count);
      const memberCount = Number(source.member_count);
      if (memberCount < 1 || memberCount > 1_000) {
        throw new DocumentPreflightValidationError(
          "Audience snapshot must contain from 1 to 1000 members"
        );
      }
      const fields = loadFields(connection, source.candidate_id, fieldCount);
      const members = loadMembers(connection, source.snapshot_id);
      if (members.length !== memberCount) {
        throw new DocumentPreflightConflictError(
          "Audience snapshot member list is incomplete"
        );
      }
      const context = {
        spaceName: source.space_name,
        spaceKey: source.space_key,
        audienceCount: members.length
      };
      const memberResults: DocumentPreflightMember[] = members.map((member) => {
        const resolved = resolveDocumentMemberValues(fields, member, context);
        return {
          entityId: member.entityId,
          position: member.position,
          displayName: member.displayName,
          availableCount: resolved.availableCount,
          fieldCount: fields.length,
          missingRequired: resolved.missingRequired.map((field) => ({
            key: field.key,
            label: field.label
          })),
          ready: resolved.missingRequired.length === 0
        };
      });
      const readyMemberCount = memberResults.filter((member) => member.ready).length;
      const missingMemberCount = memberResults.length - readyMemberCount;
      const missingValueCount = memberResults.reduce(
        (total, member) => total + member.missingRequired.length,
        0
      );
      const expectedCount = targetMode === "aggregate" ? 1 : memberCount;
      const canStart =
        targetMode === "aggregate"
          ? missingMemberCount === 0
          : readyMemberCount > 0;
      return {
        spaceId: source.space_id,
        activeReleaseId: source.release_id,
        snapshotId: source.snapshot_id,
        targetMode,
        format,
        templateTitle: source.title,
        fieldCount,
        memberCount,
        expectedCount,
        readyMemberCount,
        missingMemberCount,
        missingValueCount,
        canStart,
        startWouldBePartial:
          targetMode === "one_per_member" && missingMemberCount > 0,
        members: memberResults
      };
    });
  }
}
