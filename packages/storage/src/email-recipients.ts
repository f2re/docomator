import { randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import {
  normalizeEmailAddress,
  normalizeEmailDisplayName
} from "./email-address.js";
import { generateOpaqueStableKey, type MutationContext } from "./knowledge.js";
import { DomainEventOutbox } from "./outbox.js";

export type EmailRecipientStatus = "active" | "inactive";

export interface CreateEmailRecipientInput {
  id?: string;
  key?: string;
  name: string;
  email: string;
  description?: string | null;
}

export interface UpdateEmailRecipientInput {
  name?: string;
  email?: string;
  description?: string | null;
  status?: EmailRecipientStatus;
}

export interface EmailRecipientRecord {
  id: string;
  spaceId: string;
  key: string;
  name: string;
  email: string;
  description: string | null;
  status: EmailRecipientStatus;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
}

interface RecipientRow {
  id: string;
  space_id: string;
  key: string;
  name: string;
  email: string;
  description: string | null;
  status: string;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  correlation_id: string;
  created_at: string;
  updated_at: string;
}

export class EmailRecipientValidationError extends Error {
  override readonly name = "EmailRecipientValidationError";
}

export class EmailRecipientNotFoundError extends Error {
  override readonly name = "EmailRecipientNotFoundError";
}

export class EmailRecipientConflictError extends Error {
  override readonly name = "EmailRecipientConflictError";
}

function requiredText(value: string, name: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new EmailRecipientValidationError(`${name} must be a string`);
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) {
    throw new EmailRecipientValidationError(`${name} must not be empty`);
  }
  if (
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new EmailRecipientValidationError(`${name} is invalid`);
  }
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  name: string,
  maximum: number
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximum || /\u0000/u.test(normalized)) {
    throw new EmailRecipientValidationError(`${name} is invalid`);
  }
  return normalized;
}

function stableKey(value: string): string {
  const normalized = requiredText(value, "key", 160).toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(normalized)) {
    throw new EmailRecipientValidationError(
      "key must start with a letter and contain letters, digits, dots, dashes or underscores"
    );
  }
  return normalized;
}

function statusValue(value: string): EmailRecipientStatus {
  if (value === "active" || value === "inactive") return value;
  throw new EmailRecipientValidationError("status must be active or inactive");
}

function timestamp(value: Date | string | undefined): string {
  const date =
    value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new EmailRecipientValidationError("Invalid mutation timestamp");
  }
  return date.toISOString();
}

function contextValue(context: MutationContext): {
  correlationId: string;
  actorType: string;
  actorId: string | null;
  now: string;
} {
  return {
    correlationId: requiredText(context.correlationId, "correlationId", 160),
    actorType: requiredText(context.actorType, "actorType", 80),
    actorId:
      context.actorId === undefined || context.actorId === null
        ? null
        : requiredText(context.actorId, "actorId", 160),
    now: timestamp(context.now)
  };
}

function mapRecipient(row: RecipientRow): EmailRecipientRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    key: row.key,
    name: row.name,
    email: row.email,
    description: row.description,
    status: statusValue(row.status),
    version: Number(row.version),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function requireSpace(
  connection: SqliteExecutor,
  identity: string
): { id: string } {
  const row = connection
    .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
    .get(identity, identity.toLowerCase()) as { id: string } | undefined;
  if (row === undefined) {
    throw new EmailRecipientNotFoundError(`Space was not found: ${identity}`);
  }
  return row;
}

function recipientRow(
  connection: SqliteExecutor,
  spaceId: string,
  recipientId: string
): RecipientRow | undefined {
  return connection
    .prepare(
      "SELECT * FROM space_email_recipients WHERE id = ? AND space_id = ?"
    )
    .get(recipientId, spaceId) as RecipientRow | undefined;
}

function isSqliteUniqueError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: space_email_recipients/u.test(error.message)
  );
}

export class EmailRecipientRegistry {
  private readonly outbox: DomainEventOutbox;
  private readonly audit: AuditRepository;
  private readonly keyFactory: () => string;

  constructor(
    private readonly store: SqliteStore,
    options: {
      outbox?: DomainEventOutbox;
      audit?: AuditRepository;
      keyFactory?: () => string;
    } = {}
  ) {
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
    this.audit = options.audit ?? new AuditRepository(store);
    this.keyFactory =
      options.keyFactory ?? (() => generateOpaqueStableKey("email_recipient"));
  }

  create(
    spaceIdentityValue: string,
    input: CreateEmailRecipientInput,
    contextInput: MutationContext
  ): EmailRecipientRecord {
    const identity = requiredText(spaceIdentityValue, "spaceId", 160);
    const id = input.id ?? randomUUID();
    const explicitKey = input.key === undefined ? null : stableKey(input.key);
    const name = normalizeEmailDisplayName(input.name);
    if (name === null) {
      throw new EmailRecipientValidationError("name must not be empty");
    }
    const email = normalizeEmailAddress(input.email).address;
    const description = optionalText(input.description, "description", 2_000);
    const context = contextValue(contextInput);

    return this.store.transaction((connection) => {
      const space = requireSpace(connection, identity);
      const key = explicitKey ?? this.allocateKey(connection, space.id);
      try {
        connection
          .prepare(`
            INSERT INTO space_email_recipients(
              id, space_id, key, name, email, description, status,
              version, created_by, updated_by, correlation_id,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?)
          `)
          .run(
            id,
            space.id,
            key,
            name,
            email,
            description,
            context.actorId,
            context.actorId,
            context.correlationId,
            context.now,
            context.now
          );
      } catch (error) {
        if (isSqliteUniqueError(error)) {
          throw new EmailRecipientConflictError(
            "Получатель с таким ключом или адресом уже существует в пространстве."
          );
        }
        throw error;
      }
      this.outbox.append(
        {
          eventType: "space.email-recipient.created",
          schemaVersion: 1,
          source: "email-recipient-registry",
          occurredAt: context.now,
          payload: { id, spaceId: space.id, key, name, email, version: 1 },
          dedupeKey: `space.email-recipient.created:${id}:v1`,
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
          objectType: "email_recipient",
          objectId: id,
          correlationId: context.correlationId,
          details: { spaceId: space.id, key, name, email, version: 1 }
        },
        connection
      );
      const row = recipientRow(connection, space.id, id);
      if (row === undefined) {
        throw new Error(`Created email recipient was not found: ${id}`);
      }
      return mapRecipient(row);
    });
  }

  private allocateKey(connection: SqliteExecutor, spaceId: string): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const key = stableKey(this.keyFactory());
      const existing = connection
        .prepare(
          "SELECT 1 FROM space_email_recipients WHERE space_id = ? AND key = ?"
        )
        .get(spaceId, key);
      if (existing === undefined) {
        return key;
      }
    }
    throw new EmailRecipientConflictError(
      "Не удалось создать внутренний ключ получателя. Повторите действие."
    );
  }

  list(
    spaceIdentityValue: string,
    includeInactive = false
  ): EmailRecipientRecord[] {
    const identity = requiredText(spaceIdentityValue, "spaceId", 160);
    return this.store.execute((connection) => {
      const space = requireSpace(connection, identity);
      const rows = connection
        .prepare(`
          SELECT *
          FROM space_email_recipients
          WHERE space_id = ? AND (? = 1 OR status = 'active')
          ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
                   name COLLATE NOCASE, email COLLATE NOCASE, id
          LIMIT 1000
        `)
        .all(space.id, includeInactive ? 1 : 0) as unknown as RecipientRow[];
      return rows.map(mapRecipient);
    });
  }

  get(
    spaceIdentityValue: string,
    recipientIdValue: string
  ): EmailRecipientRecord {
    const identity = requiredText(spaceIdentityValue, "spaceId", 160);
    const recipientId = requiredText(recipientIdValue, "recipientId", 160);
    return this.store.execute((connection) => {
      const space = requireSpace(connection, identity);
      const row = recipientRow(connection, space.id, recipientId);
      if (row === undefined) {
        throw new EmailRecipientNotFoundError(
          `Email recipient was not found in this space: ${recipientId}`
        );
      }
      return mapRecipient(row);
    });
  }

  update(
    spaceIdentityValue: string,
    recipientIdValue: string,
    input: UpdateEmailRecipientInput,
    contextInput: MutationContext
  ): EmailRecipientRecord {
    const identity = requiredText(spaceIdentityValue, "spaceId", 160);
    const recipientId = requiredText(recipientIdValue, "recipientId", 160);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const space = requireSpace(connection, identity);
      const current = recipientRow(connection, space.id, recipientId);
      if (current === undefined) {
        throw new EmailRecipientNotFoundError(
          `Email recipient was not found in this space: ${recipientId}`
        );
      }
      const name =
        input.name === undefined
          ? current.name
          : normalizeEmailDisplayName(input.name);
      if (name === null) {
        throw new EmailRecipientValidationError("name must not be empty");
      }
      const email =
        input.email === undefined
          ? current.email
          : normalizeEmailAddress(input.email).address;
      const description =
        input.description === undefined
          ? current.description
          : optionalText(input.description, "description", 2_000);
      const status =
        input.status === undefined ? statusValue(current.status) : statusValue(input.status);
      const version = Number(current.version) + 1;
      try {
        connection
          .prepare(`
            UPDATE space_email_recipients
            SET name = ?, email = ?, description = ?, status = ?,
                version = ?, updated_by = ?, correlation_id = ?, updated_at = ?
            WHERE id = ? AND space_id = ?
          `)
          .run(
            name,
            email,
            description,
            status,
            version,
            context.actorId,
            context.correlationId,
            context.now,
            recipientId,
            space.id
          );
      } catch (error) {
        if (isSqliteUniqueError(error)) {
          throw new EmailRecipientConflictError(
            "Получатель с таким адресом уже существует в пространстве."
          );
        }
        throw error;
      }
      this.outbox.append(
        {
          eventType: "space.email-recipient.updated",
          schemaVersion: 1,
          source: "email-recipient-registry",
          occurredAt: context.now,
          payload: {
            id: recipientId,
            spaceId: space.id,
            name,
            email,
            status,
            version
          },
          dedupeKey: `space.email-recipient.updated:${recipientId}:v${version}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "update",
          objectType: "email_recipient",
          objectId: recipientId,
          correlationId: context.correlationId,
          details: { spaceId: space.id, name, email, status, version }
        },
        connection
      );
      const row = recipientRow(connection, space.id, recipientId);
      if (row === undefined) {
        throw new Error(`Updated email recipient was not found: ${recipientId}`);
      }
      return mapRecipient(row);
    });
  }
}
