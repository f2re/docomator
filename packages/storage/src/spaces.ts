import { randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import { stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import {
  generateOpaqueStableKey,
  type MutationContext
} from "./knowledge.js";
import { DomainEventOutbox } from "./outbox.js";

export const DEFAULT_SPACE_ID = "00000000-0000-4000-8000-000000000001";

export type SpaceStatus = "active" | "archived";
export type AudienceSourceKind = "all_space" | "group" | "selected";
export type DocumentTargetMode = "one_per_member" | "aggregate";

export interface SpaceRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: SpaceStatus;
  version: number;
  entityCount: number;
  groupCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSpaceInput {
  id?: string;
  key?: string;
  name: string;
  description?: string | null;
}

export interface ListSpacesOptions {
  status?: SpaceStatus;
  limit?: number;
}

export interface SpaceEntityRecord {
  spaceId: string;
  entityId: string;
  entityTypeKey: string;
  entityTypeLabel: string;
  displayName: string;
  status: "active" | "inactive" | "archived";
  entityVersion: number;
  ownershipVersion: number;
  assignedAt: string;
  assignedBy: string | null;
}

export interface CreateSpaceEntityInput {
  id?: string;
  entityTypeKey: string;
  displayName: string;
  status?: "active" | "inactive" | "archived";
}

export interface ListSpaceEntitiesOptions {
  entityTypeKey?: string;
  status?: "active" | "inactive" | "archived";
  limit?: number;
}

export interface AudienceGroupRecord {
  id: string;
  spaceId: string;
  key: string;
  name: string;
  description: string | null;
  status: SpaceStatus;
  version: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAudienceGroupInput {
  id?: string;
  key?: string;
  name: string;
  description?: string | null;
}

export interface AudienceMemberRecord {
  entityId: string;
  position: number;
  displayName: string;
  entityTypeKey: string;
  entityTypeLabel: string;
  status: "active" | "inactive" | "archived";
}

export type AudienceSelectionSource =
  | {
      kind: "all_space";
      entityTypeKey?: string;
    }
  | {
      kind: "group";
      groupId: string;
    }
  | {
      kind: "selected";
      entityIds: readonly string[];
    };

export interface CreateAudienceSnapshotInput {
  id?: string;
  source: AudienceSelectionSource;
  targetMode: DocumentTargetMode;
  includeInactive?: boolean;
}

export interface AudienceSnapshotSummary {
  id: string;
  spaceId: string;
  sourceKind: AudienceSourceKind;
  sourceId: string | null;
  targetMode: DocumentTargetMode;
  entityTypeKey: string | null;
  memberCount: number;
  criteria: JsonValue;
  createdBy: string | null;
  correlationId: string;
  createdAt: string;
}

export interface AudienceSnapshotRecord extends AudienceSnapshotSummary {
  members: AudienceMemberRecord[];
}

export interface DocumentTargetMember {
  entityId: string;
  displayName: string;
  entityTypeKey: string;
  position: number;
}

export interface DocumentTargetUnit {
  key: string;
  primaryEntityId: string | null;
  memberIds: string[];
  context: JsonValue;
}

export interface DocumentTargetPlan {
  snapshotId: string;
  spaceId: string;
  targetMode: DocumentTargetMode;
  documentCount: number;
  collectionPath: "audience.members";
  units: DocumentTargetUnit[];
}

export interface AudienceSnapshotResult {
  snapshot: AudienceSnapshotRecord;
  plan: DocumentTargetPlan;
}

interface SpaceRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  entity_count: number;
  group_count: number;
  created_at: string;
  updated_at: string;
}

interface SpaceEntityRow {
  space_id: string;
  entity_id: string;
  entity_type_key: string;
  entity_type_label: string;
  display_name: string;
  status: string;
  entity_version: number;
  ownership_version: number;
  assigned_at: string;
  assigned_by: string | null;
}

interface AudienceGroupRow {
  id: string;
  space_id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  member_count: number;
  created_at: string;
  updated_at: string;
}

interface AudienceMemberRow {
  entity_id: string;
  position: number;
  display_name: string;
  entity_type_key: string;
  entity_type_label: string;
  status: string;
}

interface AudienceSnapshotRow {
  id: string;
  space_id: string;
  source_kind: string;
  source_id: string | null;
  target_mode: string;
  entity_type_key: string | null;
  member_count: number;
  criteria_json: string;
  created_by: string | null;
  correlation_id: string;
  created_at: string;
}

export class SpaceValidationError extends Error {
  override name = "SpaceValidationError";
}

export class SpaceConflictError extends Error {
  override name = "SpaceConflictError";
}

export class SpaceNotFoundError extends Error {
  override name = "SpaceNotFoundError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new SpaceValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new SpaceValidationError(`${name} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new SpaceValidationError(`${name} must not exceed ${maximum} characters`);
  }
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  name: string,
  maximum = 2_000
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.length > maximum) {
    throw new SpaceValidationError(`${name} must not exceed ${maximum} characters`);
  }
  return normalized;
}

function stableKey(value: string, name: string): string {
  const normalized = requiredText(value, name, 160).toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(normalized)) {
    throw new SpaceValidationError(
      `${name} must start with a letter and contain lowercase letters, digits, dots, underscores or hyphens`
    );
  }
  return normalized;
}

function timestamp(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SpaceValidationError("Invalid mutation timestamp");
  }
  return date.toISOString();
}

function normalizeLimit(value: number | undefined, fallback = 100): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new SpaceValidationError("limit must be an integer in range 1..1000");
  }
  return limit;
}

function normalizeContext(context: MutationContext): {
  correlationId: string;
  actorType: string;
  actorId: string | null;
  now: string;
} {
  return {
    correlationId: requiredText(context.correlationId, "correlationId", 160),
    actorType: requiredText(context.actorType, "actorType", 80),
    actorId: optionalText(context.actorId, "actorId", 160),
    now: timestamp(context.now)
  };
}

function spaceStatus(value: string): SpaceStatus {
  if (value === "active" || value === "archived") {
    return value;
  }
  throw new SpaceValidationError(`Unsupported space status: ${value}`);
}

function entityStatus(value: string): "active" | "inactive" | "archived" {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }
  throw new SpaceValidationError(`Unsupported entity status: ${value}`);
}

function targetMode(value: string): DocumentTargetMode {
  if (value === "one_per_member" || value === "aggregate") {
    return value;
  }
  throw new SpaceValidationError(`Unsupported document target mode: ${value}`);
}

function sourceKind(value: string): AudienceSourceKind {
  if (value === "all_space" || value === "group" || value === "selected") {
    return value;
  }
  throw new Error(`Stored audience source kind is invalid: ${value}`);
}

function normalizeEntityIds(values: readonly string[]): string[] {
  if (!Array.isArray(values)) {
    throw new SpaceValidationError("entityIds must be an array");
  }
  if (values.length > 1_000) {
    throw new SpaceValidationError("entityIds must not contain more than 1000 items");
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = requiredText(value, "entityId", 160);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

function mapSpace(row: SpaceRow): SpaceRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: spaceStatus(row.status),
    version: row.version,
    entityCount: Number(row.entity_count),
    groupCount: Number(row.group_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSpaceEntity(row: SpaceEntityRow): SpaceEntityRecord {
  return {
    spaceId: row.space_id,
    entityId: row.entity_id,
    entityTypeKey: row.entity_type_key,
    entityTypeLabel: row.entity_type_label,
    displayName: row.display_name,
    status: entityStatus(row.status),
    entityVersion: row.entity_version,
    ownershipVersion: row.ownership_version,
    assignedAt: row.assigned_at,
    assignedBy: row.assigned_by
  };
}

function mapGroup(row: AudienceGroupRow): AudienceGroupRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: spaceStatus(row.status),
    version: row.version,
    memberCount: Number(row.member_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMember(row: AudienceMemberRow): AudienceMemberRecord {
  return {
    entityId: row.entity_id,
    position: row.position,
    displayName: row.display_name,
    entityTypeKey: row.entity_type_key,
    entityTypeLabel: row.entity_type_label,
    status: entityStatus(row.status)
  };
}

function mapSnapshotSummary(row: AudienceSnapshotRow): AudienceSnapshotSummary {
  return {
    id: row.id,
    spaceId: row.space_id,
    sourceKind: sourceKind(row.source_kind),
    sourceId: row.source_id,
    targetMode: targetMode(row.target_mode),
    entityTypeKey: row.entity_type_key,
    memberCount: Number(row.member_count),
    criteria: JSON.parse(row.criteria_json) as JsonValue,
    createdBy: row.created_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at
  };
}

function spaceRowByIdentity(
  connection: SqliteExecutor,
  identityValue: string
): SpaceRow | undefined {
  const identity = requiredText(identityValue, "spaceId", 160);
  return connection
    .prepare(`
      SELECT s.*,
             (SELECT COUNT(*) FROM space_entity_ownership seo WHERE seo.space_id = s.id) AS entity_count,
             (SELECT COUNT(*) FROM audience_groups g WHERE g.space_id = s.id AND g.status = 'active') AS group_count
      FROM spaces s
      WHERE s.id = ? OR s.key = ?
    `)
    .get(identity, identity.toLowerCase()) as SpaceRow | undefined;
}

function requireSpace(connection: SqliteExecutor, identity: string): SpaceRow {
  const row = spaceRowByIdentity(connection, identity);
  if (row === undefined) {
    throw new SpaceNotFoundError(`Space was not found: ${identity}`);
  }
  return row;
}

function groupRowById(connection: SqliteExecutor, id: string): AudienceGroupRow | undefined {
  return connection
    .prepare(`
      SELECT g.*,
             (SELECT COUNT(*) FROM audience_group_members gm WHERE gm.group_id = g.id) AS member_count
      FROM audience_groups g
      WHERE g.id = ?
    `)
    .get(id) as AudienceGroupRow | undefined;
}

function requireGroup(
  connection: SqliteExecutor,
  spaceId: string,
  groupIdValue: string
): AudienceGroupRow {
  const groupId = requiredText(groupIdValue, "groupId", 160);
  const row = groupRowById(connection, groupId);
  if (row === undefined || row.space_id !== spaceId) {
    throw new SpaceNotFoundError(`Audience group was not found in this space: ${groupId}`);
  }
  return row;
}

function spaceEntityRowById(
  connection: SqliteExecutor,
  entityIdValue: string
): SpaceEntityRow | undefined {
  const entityId = requiredText(entityIdValue, "entityId", 160);
  return connection
    .prepare(`
      SELECT seo.space_id,
             e.id AS entity_id,
             et.key AS entity_type_key,
             et.label AS entity_type_label,
             e.display_name,
             e.status,
             e.version AS entity_version,
             seo.version AS ownership_version,
             seo.assigned_at,
             seo.assigned_by
      FROM entities e
      JOIN entity_types et ON et.id = e.entity_type_id
      JOIN space_entity_ownership seo ON seo.entity_id = e.id
      WHERE e.id = ?
    `)
    .get(entityId) as SpaceEntityRow | undefined;
}

function requireEntityInSpace(
  connection: SqliteExecutor,
  spaceId: string,
  entityId: string
): SpaceEntityRow {
  const row = spaceEntityRowById(connection, entityId);
  if (row === undefined || row.space_id !== spaceId) {
    throw new SpaceNotFoundError(`Entity was not found in this space: ${entityId}`);
  }
  return row;
}

function snapshotRowById(
  connection: SqliteExecutor,
  spaceId: string,
  snapshotIdValue: string
): AudienceSnapshotRow | undefined {
  const snapshotId = requiredText(snapshotIdValue, "snapshotId", 160);
  return connection
    .prepare("SELECT * FROM audience_snapshots WHERE id = ? AND space_id = ?")
    .get(snapshotId, spaceId) as AudienceSnapshotRow | undefined;
}

function snapshotMembers(
  connection: SqliteExecutor,
  snapshotId: string
): AudienceMemberRecord[] {
  const rows = connection
    .prepare(`
      SELECT sm.entity_id,
             sm.position,
             sm.display_name_snapshot AS display_name,
             sm.entity_type_key_snapshot AS entity_type_key,
             sm.entity_type_key_snapshot AS entity_type_label,
             sm.entity_status_snapshot AS status
      FROM audience_snapshot_members sm
      WHERE sm.snapshot_id = ?
      ORDER BY sm.position ASC
    `)
    .all(snapshotId) as unknown as AudienceMemberRow[];
  return rows.map(mapMember);
}

function buildTargetPlan(
  snapshot: AudienceSnapshotRecord,
  space: SpaceRecord
): DocumentTargetPlan {
  const members: DocumentTargetMember[] = snapshot.members.map((member) => ({
    entityId: member.entityId,
    displayName: member.displayName,
    entityTypeKey: member.entityTypeKey,
    position: member.position
  }));
  const sharedAudience = {
    snapshotId: snapshot.id,
    count: members.length,
    members
  };

  const units: DocumentTargetUnit[] =
    snapshot.targetMode === "aggregate"
      ? [
          {
            key: `audience:${snapshot.id}:aggregate`,
            primaryEntityId: null,
            memberIds: members.map((member) => member.entityId),
            context: toJsonValue({
              space: { id: space.id, key: space.key, name: space.name },
              audience: sharedAudience
            })
          }
        ]
      : members.map((member) => ({
          key: `audience:${snapshot.id}:entity:${member.entityId}`,
          primaryEntityId: member.entityId,
          memberIds: [member.entityId],
          context: toJsonValue({
            space: { id: space.id, key: space.key, name: space.name },
            subject: member,
            audience: {
              snapshotId: snapshot.id,
              count: 1,
              members: [member]
            }
          })
        }));

  return {
    snapshotId: snapshot.id,
    spaceId: snapshot.spaceId,
    targetMode: snapshot.targetMode,
    documentCount: units.length,
    collectionPath: "audience.members",
    units
  };
}

export class SpaceRegistry {
  private readonly outbox: DomainEventOutbox;
  private readonly audit: AuditRepository;
  private readonly keyFactory: (prefix: string) => string;

  constructor(
    private readonly store: SqliteStore,
    options: {
      outbox?: DomainEventOutbox;
      audit?: AuditRepository;
      keyFactory?: (prefix: string) => string;
    } = {}
  ) {
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
    this.audit = options.audit ?? new AuditRepository(store);
    this.keyFactory = options.keyFactory ?? generateOpaqueStableKey;
  }

  createSpace(input: CreateSpaceInput, contextInput: MutationContext): SpaceRecord {
    const id = input.id ?? randomUUID();
    const explicitKey = input.key === undefined ? null : stableKey(input.key, "key");
    const name = requiredText(input.name, "name");
    const description = optionalText(input.description, "description");
    const context = normalizeContext(contextInput);

    return this.store.transaction((connection) => {
      const key =
        explicitKey ??
        this.allocateKey("space", (candidate) =>
          spaceRowByIdentity(connection, candidate) !== undefined
        );
      if (spaceRowByIdentity(connection, id) !== undefined || spaceRowByIdentity(connection, key) !== undefined) {
        throw new SpaceConflictError(`Space already exists: ${key}`);
      }
      connection
        .prepare(`
          INSERT INTO spaces(id, key, name, description, status, version, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'active', 1, ?, ?)
        `)
        .run(id, key, name, description, context.now, context.now);

      this.outbox.append(
        {
          eventType: "space.created",
          schemaVersion: 1,
          source: "space-registry",
          occurredAt: context.now,
          payload: { id, key, name, initiatedBy: context.actorId },
          dedupeKey: `space.created:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "create",
          objectType: "space",
          objectId: id,
          correlationId: context.correlationId,
          details: { key, version: 1 }
        },
        connection
      );

      const row = spaceRowByIdentity(connection, id);
      if (row === undefined) {
        throw new Error(`Created space was not found: ${id}`);
      }
      return mapSpace(row);
    });
  }

  listSpaces(options: ListSpacesOptions = {}): SpaceRecord[] {
    const status = options.status === undefined ? null : spaceStatus(options.status);
    const limit = normalizeLimit(options.limit);

    return this.store.execute((connection) => {
      const rows = connection
        .prepare(`
          SELECT s.*,
                 (SELECT COUNT(*) FROM space_entity_ownership seo WHERE seo.space_id = s.id) AS entity_count,
                 (SELECT COUNT(*) FROM audience_groups g WHERE g.space_id = s.id AND g.status = 'active') AS group_count
          FROM spaces s
          WHERE (? IS NULL OR s.status = ?)
          ORDER BY CASE WHEN s.id = ? THEN 0 ELSE 1 END, s.name ASC, s.id ASC
          LIMIT ?
        `)
        .all(status, status, DEFAULT_SPACE_ID, limit) as unknown as SpaceRow[];
      return rows.map(mapSpace);
    });
  }

  getSpace(identity: string): SpaceRecord {
    return this.store.execute((connection) => {
      const row = spaceRowByIdentity(connection, identity);
      if (row === undefined) {
        throw new SpaceNotFoundError(`Space was not found: ${identity}`);
      }
      return mapSpace(row);
    });
  }

  createEntity(
    spaceIdentity: string,
    input: CreateSpaceEntityInput,
    contextInput: MutationContext
  ): SpaceEntityRecord {
    const id = input.id ?? randomUUID();
    const entityTypeKey = stableKey(input.entityTypeKey, "entityTypeKey");
    const displayName = requiredText(input.displayName, "displayName");
    const status = entityStatus(input.status ?? "active");
    const context = normalizeContext(contextInput);

    return this.store.transaction((connection) => {
      const space = requireSpace(connection, spaceIdentity);
      const entityType = connection
        .prepare("SELECT id FROM entity_types WHERE key = ?")
        .get(entityTypeKey) as { id: string } | undefined;
      if (entityType === undefined) {
        throw new SpaceNotFoundError(`Entity type was not found: ${entityTypeKey}`);
      }
      if (connection.prepare("SELECT 1 FROM entities WHERE id = ?").get(id) !== undefined) {
        throw new SpaceConflictError(`Entity already exists: ${id}`);
      }

      connection
        .prepare(`
          INSERT INTO entities(
            id, entity_type_id, display_name, status, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?)
        `)
        .run(id, entityType.id, displayName, status, context.now, context.now);
      connection
        .prepare(`
          UPDATE space_entity_ownership
          SET space_id = ?, assigned_at = ?, assigned_by = ?, version = 1
          WHERE entity_id = ?
        `)
        .run(space.id, context.now, context.actorId, id);

      this.outbox.append(
        {
          eventType: "entity.created",
          schemaVersion: 1,
          source: "space-registry",
          occurredAt: context.now,
          entityId: id,
          payload: { id, spaceId: space.id, entityTypeKey, displayName, status, version: 1 },
          dedupeKey: `entity.created:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "create",
          objectType: "entity",
          objectId: id,
          correlationId: context.correlationId,
          details: { spaceId: space.id, entityTypeKey, version: 1 }
        },
        connection
      );

      const row = spaceEntityRowById(connection, id);
      if (row === undefined) {
        throw new Error(`Created space entity was not found: ${id}`);
      }
      return mapSpaceEntity(row);
    });
  }

  assignEntity(
    spaceIdentity: string,
    entityIdValue: string,
    contextInput: MutationContext
  ): SpaceEntityRecord {
    const entityId = requiredText(entityIdValue, "entityId", 160);
    const context = normalizeContext(contextInput);

    return this.store.transaction((connection) => {
      const space = requireSpace(connection, spaceIdentity);
      const entity = spaceEntityRowById(connection, entityId);
      if (entity === undefined) {
        throw new SpaceNotFoundError(`Entity was not found: ${entityId}`);
      }
      if (entity.space_id === space.id) {
        return mapSpaceEntity(entity);
      }
      const grouped = connection
        .prepare("SELECT 1 FROM audience_group_members WHERE entity_id = ? LIMIT 1")
        .get(entityId);
      if (grouped !== undefined) {
        throw new SpaceConflictError(
          "Remove the entity from its audience groups before moving it to another space"
        );
      }

      const nextVersion = entity.ownership_version + 1;
      connection
        .prepare(`
          UPDATE space_entity_ownership
          SET space_id = ?, assigned_at = ?, assigned_by = ?, version = ?
          WHERE entity_id = ?
        `)
        .run(space.id, context.now, context.actorId, nextVersion, entityId);

      this.outbox.append(
        {
          eventType: "space.entity.assigned",
          schemaVersion: 1,
          source: "space-registry",
          occurredAt: context.now,
          entityId,
          payload: {
            entityId,
            previousSpaceId: entity.space_id,
            spaceId: space.id,
            ownershipVersion: nextVersion
          },
          dedupeKey: `space.entity.assigned:${entityId}:v${nextVersion}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "assign_entity",
          objectType: "space",
          objectId: space.id,
          correlationId: context.correlationId,
          details: {
            entityId,
            previousSpaceId: entity.space_id,
            ownershipVersion: nextVersion
          }
        },
        connection
      );

      const row = spaceEntityRowById(connection, entityId);
      if (row === undefined) {
        throw new Error(`Assigned entity was not found: ${entityId}`);
      }
      return mapSpaceEntity(row);
    });
  }

  listEntities(
    spaceIdentity: string,
    options: ListSpaceEntitiesOptions = {}
  ): SpaceEntityRecord[] {
    const entityTypeKey =
      options.entityTypeKey === undefined
        ? null
        : stableKey(options.entityTypeKey, "entityTypeKey");
    const status = options.status === undefined ? null : entityStatus(options.status);
    const limit = normalizeLimit(options.limit, 500);

    return this.store.execute((connection) => {
      const space = requireSpace(connection, spaceIdentity);
      const rows = connection
        .prepare(`
          SELECT seo.space_id,
                 e.id AS entity_id,
                 et.key AS entity_type_key,
                 et.label AS entity_type_label,
                 e.display_name,
                 e.status,
                 e.version AS entity_version,
                 seo.version AS ownership_version,
                 seo.assigned_at,
                 seo.assigned_by
          FROM space_entity_ownership seo
          JOIN entities e ON e.id = seo.entity_id
          JOIN entity_types et ON et.id = e.entity_type_id
          WHERE seo.space_id = ?
            AND (? IS NULL OR et.key = ?)
            AND (? IS NULL OR e.status = ?)
          ORDER BY e.display_name ASC, e.id ASC
          LIMIT ?
        `)
        .all(space.id, entityTypeKey, entityTypeKey, status, status, limit) as unknown as SpaceEntityRow[];
      return rows.map(mapSpaceEntity);
    });
  }

  createGroup(
    spaceIdentity: string,
    input: CreateAudienceGroupInput,
    contextInput: MutationContext
  ): AudienceGroupRecord {
    const id = input.id ?? randomUUID();
    const explicitKey = input.key === undefined ? null : stableKey(input.key, "key");
    const name = requiredText(input.name, "name");
    const description = optionalText(input.description, "description");
    const context = normalizeContext(contextInput);

    return this.store.transaction((connection) => {
      const space = requireSpace(connection, spaceIdentity);
      const key =
        explicitKey ??
        this.allocateKey(
          "audience_group",
          (candidate) =>
            connection
              .prepare("SELECT 1 FROM audience_groups WHERE space_id = ? AND key = ?")
              .get(space.id, candidate) !== undefined
        );
      if (
        connection
          .prepare("SELECT 1 FROM audience_groups WHERE space_id = ? AND key = ?")
          .get(space.id, key) !== undefined
      ) {
        throw new SpaceConflictError(`Audience group already exists in this space: ${key}`);
      }
      connection
        .prepare(`
          INSERT INTO audience_groups(
            id, space_id, key, name, description, status, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)
        `)
        .run(id, space.id, key, name, description, context.now, context.now);

      this.outbox.append(
        {
          eventType: "audience_group.created",
          schemaVersion: 1,
          source: "space-registry",
          occurredAt: context.now,
          payload: { id, spaceId: space.id, key, name, version: 1 },
          dedupeKey: `audience_group.created:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "create",
          objectType: "audience_group",
          objectId: id,
          correlationId: context.correlationId,
          details: { spaceId: space.id, key, version: 1 }
        },
        connection
      );

      const row = groupRowById(connection, id);
      if (row === undefined) {
        throw new Error(`Created audience group was not found: ${id}`);
      }
      return mapGroup(row);
    });
  }

  listGroups(spaceIdentity: string, limitValue?: number): AudienceGroupRecord[] {
    const limit = normalizeLimit(limitValue, 200);
    return this.store.execute((connection) => {
      const space = requireSpace(connection, spaceIdentity);
      const rows = connection
        .prepare(`
          SELECT g.*,
                 (SELECT COUNT(*) FROM audience_group_members gm WHERE gm.group_id = g.id) AS member_count
          FROM audience_groups g
          WHERE g.space_id = ?
          ORDER BY CASE g.status WHEN 'active' THEN 0 ELSE 1 END, g.name ASC, g.id ASC
          LIMIT ?
        `)
        .all(space.id, limit) as unknown as AudienceGroupRow[];
      return rows.map(mapGroup);
    });
  }

  replaceGroupMembers(
    spaceIdentity: string,
    groupIdValue: string,
    entityIdsValue: readonly string[],
    contextInput: MutationContext
  ): AudienceMemberRecord[] {
    const entityIds = normalizeEntityIds(entityIdsValue);
    const context = normalizeContext(contextInput);

    return this.store.transaction((connection) => {
      const space = requireSpace(connection, spaceIdentity);
      const group = requireGroup(connection, space.id, groupIdValue);
      for (const entityId of entityIds) {
        requireEntityInSpace(connection, space.id, entityId);
      }

      connection.prepare("DELETE FROM audience_group_members WHERE group_id = ?").run(group.id);
      const insert = connection.prepare(`
        INSERT INTO audience_group_members(group_id, entity_id, position, added_at, added_by)
        VALUES (?, ?, ?, ?, ?)
      `);
      entityIds.forEach((entityId, position) => {
        insert.run(group.id, entityId, position, context.now, context.actorId);
      });
      const version = group.version + 1;
      connection
        .prepare("UPDATE audience_groups SET version = ?, updated_at = ? WHERE id = ?")
        .run(version, context.now, group.id);

      this.outbox.append(
        {
          eventType: "audience_group.members_replaced",
          schemaVersion: 1,
          source: "space-registry",
          occurredAt: context.now,
          payload: {
            groupId: group.id,
            spaceId: space.id,
            memberCount: entityIds.length,
            version
          },
          dedupeKey: `audience_group.members_replaced:${group.id}:v${version}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "replace_members",
          objectType: "audience_group",
          objectId: group.id,
          correlationId: context.correlationId,
          details: { spaceId: space.id, memberCount: entityIds.length, version }
        },
        connection
      );
      return this.listGroupMembersWithConnection(connection, space.id, group.id);
    });
  }

  listGroupMembers(
    spaceIdentity: string,
    groupIdValue: string
  ): AudienceMemberRecord[] {
    return this.store.execute((connection) => {
      const space = requireSpace(connection, spaceIdentity);
      const group = requireGroup(connection, space.id, groupIdValue);
      return this.listGroupMembersWithConnection(connection, space.id, group.id);
    });
  }

  createAudienceSnapshot(
    spaceIdentity: string,
    input: CreateAudienceSnapshotInput,
    contextInput: MutationContext
  ): AudienceSnapshotResult {
    const mode = targetMode(input.targetMode);
    const includeInactive = input.includeInactive ?? false;
    const context = normalizeContext(contextInput);
    const id = input.id ?? randomUUID();

    return this.store.transaction((connection) => {
      const spaceRow = requireSpace(connection, spaceIdentity);
      const space = mapSpace(spaceRow);
      let rows: AudienceMemberRow[];
      let sourceId: string | null = null;
      let entityTypeKey: string | null = null;

      if (input.source.kind === "all_space") {
        entityTypeKey =
          input.source.entityTypeKey === undefined
            ? null
            : stableKey(input.source.entityTypeKey, "entityTypeKey");
        rows = connection
          .prepare(`
            SELECT e.id AS entity_id,
                   ROW_NUMBER() OVER (ORDER BY e.display_name ASC, e.id ASC) - 1 AS position,
                   e.display_name,
                   et.key AS entity_type_key,
                   et.label AS entity_type_label,
                   e.status
            FROM space_entity_ownership seo
            JOIN entities e ON e.id = seo.entity_id
            JOIN entity_types et ON et.id = e.entity_type_id
            WHERE seo.space_id = ?
              AND (? IS NULL OR et.key = ?)
              AND (? = 1 OR e.status = 'active')
            ORDER BY e.display_name ASC, e.id ASC
            LIMIT 1000
          `)
          .all(
            space.id,
            entityTypeKey,
            entityTypeKey,
            includeInactive ? 1 : 0
          ) as unknown as AudienceMemberRow[];
      } else if (input.source.kind === "group") {
        const group = requireGroup(connection, space.id, input.source.groupId);
        sourceId = group.id;
        rows = connection
          .prepare(`
            SELECT e.id AS entity_id,
                   gm.position,
                   e.display_name,
                   et.key AS entity_type_key,
                   et.label AS entity_type_label,
                   e.status
            FROM audience_group_members gm
            JOIN entities e ON e.id = gm.entity_id
            JOIN entity_types et ON et.id = e.entity_type_id
            JOIN space_entity_ownership seo ON seo.entity_id = e.id
            WHERE gm.group_id = ?
              AND seo.space_id = ?
              AND (? = 1 OR e.status = 'active')
            ORDER BY gm.position ASC
          `)
          .all(group.id, space.id, includeInactive ? 1 : 0) as unknown as AudienceMemberRow[];
      } else {
        const entityIds = normalizeEntityIds(input.source.entityIds);
        rows = entityIds.map((entityId, position) => {
          const entity = requireEntityInSpace(connection, space.id, entityId);
          if (!includeInactive && entity.status !== "active") {
            throw new SpaceValidationError(
              `Entity is not active and includeInactive is false: ${entityId}`
            );
          }
          return {
            entity_id: entity.entity_id,
            position,
            display_name: entity.display_name,
            entity_type_key: entity.entity_type_key,
            entity_type_label: entity.entity_type_label,
            status: entity.status
          };
        });
      }

      if (rows.length === 0) {
        throw new SpaceValidationError(
          "Audience is empty. Select at least one active member before creating a snapshot."
        );
      }

      const criteria = toJsonValue({
        source: input.source,
        includeInactive
      });
      connection
        .prepare(`
          INSERT INTO audience_snapshots(
            id, space_id, source_kind, source_id, target_mode,
            entity_type_key, member_count, criteria_json,
            created_by, correlation_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          space.id,
          input.source.kind,
          sourceId,
          mode,
          entityTypeKey,
          rows.length,
          stringifyJson(criteria),
          context.actorId,
          context.correlationId,
          context.now
        );

      const insertMember = connection.prepare(`
        INSERT INTO audience_snapshot_members(
          snapshot_id, entity_id, position, display_name_snapshot,
          entity_type_key_snapshot, entity_status_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      rows.forEach((member, position) => {
        insertMember.run(
          id,
          member.entity_id,
          position,
          member.display_name,
          member.entity_type_key,
          member.status
        );
      });

      this.outbox.append(
        {
          eventType: "audience_snapshot.created",
          schemaVersion: 1,
          source: "space-registry",
          occurredAt: context.now,
          payload: {
            id,
            spaceId: space.id,
            sourceKind: input.source.kind,
            sourceId,
            targetMode: mode,
            memberCount: rows.length
          },
          dedupeKey: `audience_snapshot.created:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "create",
          objectType: "audience_snapshot",
          objectId: id,
          correlationId: context.correlationId,
          details: {
            spaceId: space.id,
            sourceKind: input.source.kind,
            targetMode: mode,
            memberCount: rows.length
          }
        },
        connection
      );

      const snapshotRow = snapshotRowById(connection, space.id, id);
      if (snapshotRow === undefined) {
        throw new Error(`Created audience snapshot was not found: ${id}`);
      }
      const snapshot: AudienceSnapshotRecord = {
        ...mapSnapshotSummary(snapshotRow),
        members: snapshotMembers(connection, id)
      };
      return { snapshot, plan: buildTargetPlan(snapshot, space) };
    });
  }

  getAudienceSnapshot(
    spaceIdentity: string,
    snapshotId: string
  ): AudienceSnapshotResult {
    return this.store.execute((connection) => {
      const spaceRow = requireSpace(connection, spaceIdentity);
      const row = snapshotRowById(connection, spaceRow.id, snapshotId);
      if (row === undefined) {
        throw new SpaceNotFoundError(`Audience snapshot was not found: ${snapshotId}`);
      }
      const snapshot: AudienceSnapshotRecord = {
        ...mapSnapshotSummary(row),
        members: snapshotMembers(connection, row.id)
      };
      return { snapshot, plan: buildTargetPlan(snapshot, mapSpace(spaceRow)) };
    });
  }

  listAudienceSnapshots(
    spaceIdentity: string,
    limitValue?: number
  ): AudienceSnapshotSummary[] {
    const limit = normalizeLimit(limitValue, 50);
    return this.store.execute((connection) => {
      const space = requireSpace(connection, spaceIdentity);
      const rows = connection
        .prepare(`
          SELECT *
          FROM audience_snapshots
          WHERE space_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `)
        .all(space.id, limit) as unknown as AudienceSnapshotRow[];
      return rows.map(mapSnapshotSummary);
    });
  }

  private allocateKey(prefix: string, exists: (candidate: string) => boolean): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = stableKey(this.keyFactory(prefix), "generatedKey");
      if (!exists(candidate)) {
        return candidate;
      }
    }
    throw new SpaceConflictError(`Could not allocate a unique ${prefix} key`);
  }

  private listGroupMembersWithConnection(
    connection: SqliteExecutor,
    spaceId: string,
    groupId: string
  ): AudienceMemberRecord[] {
    const rows = connection
      .prepare(`
        SELECT e.id AS entity_id,
               gm.position,
               e.display_name,
               et.key AS entity_type_key,
               et.label AS entity_type_label,
               e.status
        FROM audience_group_members gm
        JOIN entities e ON e.id = gm.entity_id
        JOIN entity_types et ON et.id = e.entity_type_id
        JOIN space_entity_ownership seo ON seo.entity_id = e.id
        WHERE gm.group_id = ? AND seo.space_id = ?
        ORDER BY gm.position ASC
      `)
      .all(groupId, spaceId) as unknown as AudienceMemberRow[];
    return rows.map(mapMember);
  }
}
