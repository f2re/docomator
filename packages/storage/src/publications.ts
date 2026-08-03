import { createHash, randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import {
  KnowledgeConflictError,
  KnowledgeNotFoundError,
  KnowledgeRegistry,
  KnowledgeValidationError,
  type MutationContext
} from "./knowledge.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import { DomainEventOutbox } from "./outbox.js";
import { SpaceRegistry, type AudienceSnapshotResult } from "./spaces.js";

export const PUBLICATION_CLASSIFICATION_CODES = [
  "vak",
  "rinc",
  "mbd",
  "scopus",
  "web_of_science",
  "rinc_core"
] as const;
export type PublicationClassificationCode =
  (typeof PUBLICATION_CLASSIFICATION_CODES)[number];

export const PUBLICATION_CLASSIFICATION_STATES = [
  "confirmed",
  "review",
  "excluded"
] as const;
export type PublicationClassificationState =
  (typeof PUBLICATION_CLASSIFICATION_STATES)[number];

export const PUBLICATION_AUTHOR_ROLES = [
  "author",
  "corresponding_author",
  "editor",
  "translator"
] as const;
export type PublicationAuthorRole = (typeof PUBLICATION_AUTHOR_ROLES)[number];

export const PUBLICATION_CLASSIFICATION_LABELS: Readonly<
  Record<PublicationClassificationCode, string>
> = Object.freeze({
  vak: "ВАК",
  rinc: "РИНЦ",
  mbd: "МБД",
  scopus: "Scopus",
  web_of_science: "Web of Science",
  rinc_core: "Ядро РИНЦ"
});

export const PUBLICATION_DERIVED_PROPERTY_KEYS = Object.freeze({
  authors: "publication.authors",
  internalAuthors: "publication.internal_authors",
  departments: "publication.departments",
  classifications: "publication.classifications",
  vak: "publication.vak",
  rinc: "publication.rinc",
  mbd: "publication.mbd",
  scopus: "publication.scopus",
  webOfScience: "publication.web_of_science",
  rincCore: "publication.rinc_core"
});

export interface PublicationRegistryConfigurationInput {
  publicationEntityTypeKey: string;
  teacherEntityTypeKey: string;
  publicationYearPropertyKey?: string | null;
  publicationDatePropertyKey?: string | null;
  teacherDepartmentPropertyKey?: string | null;
  doiPropertyKey?: string | null;
  journalPropertyKey?: string | null;
  bibliographyPropertyKey?: string | null;
  statusPropertyKey?: string | null;
}

export interface PublicationRegistryConfiguration
  extends Required<PublicationRegistryConfigurationInput> {
  spaceId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReplacePublicationAuthorInput {
  authorEntityId: string;
  role?: PublicationAuthorRole;
  position?: number;
}

export interface PublicationAuthorRecord {
  id: string;
  publicationEntityId: string;
  authorEntityId: string;
  displayName: string;
  entityTypeKey: string;
  role: PublicationAuthorRole;
  position: number;
  internal: boolean;
  department: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SetPublicationClassificationInput {
  state: PublicationClassificationState;
  source?: string | null;
  checkedAt?: string | null;
  note?: string | null;
}

export interface PublicationClassificationRecord {
  publicationEntityId: string;
  code: PublicationClassificationCode;
  label: string;
  state: PublicationClassificationState;
  source: string | null;
  checkedAt: string | null;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type PublicationClassificationMatch = "any" | "all";

export interface PublicationReportCriteriaInput {
  year?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  classifications?: readonly PublicationClassificationCode[];
  classificationMatch?: PublicationClassificationMatch;
  includeReview?: boolean;
  teacherEntityId?: string | null;
  department?: string | null;
  status?: string | null;
  includeInactive?: boolean;
  limit?: number;
}

export interface PublicationReportCriteria {
  year: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  classifications: PublicationClassificationCode[];
  classificationMatch: PublicationClassificationMatch;
  includeReview: boolean;
  teacherEntityId: string | null;
  department: string | null;
  status: string | null;
  includeInactive: boolean;
  limit: number;
}

export interface PublicationReportAuthor {
  entityId: string;
  displayName: string;
  role: PublicationAuthorRole;
  position: number;
  internal: boolean;
  department: string | null;
}

export interface PublicationReportClassification {
  code: PublicationClassificationCode;
  label: string;
  state: PublicationClassificationState;
  source: string | null;
  checkedAt: string | null;
  note: string | null;
}

export interface PublicationReportRow {
  publicationEntityId: string;
  title: string;
  entityStatus: string;
  year: number | null;
  publicationDate: string | null;
  doi: string | null;
  journal: string | null;
  bibliography: string | null;
  publicationStatus: string | null;
  authors: PublicationReportAuthor[];
  internalAuthors: PublicationReportAuthor[];
  departments: string[];
  classifications: PublicationReportClassification[];
  classificationCodes: PublicationClassificationCode[];
}

export interface PublicationReportTotals {
  matchedRowCount: number;
  returnedRowCount: number;
  uniquePublications: number;
  authorships: number;
  internalAuthorships: number;
  uniqueInternalAuthors: number;
  withoutDoi: number;
  withoutInternalAuthors: number;
  byClassification: Record<PublicationClassificationCode, number>;
  truncated: boolean;
}

export interface PublicationReport {
  spaceId: string;
  criteria: PublicationReportCriteria;
  generatedAt: string;
  rows: PublicationReportRow[];
  totals: PublicationReportTotals;
}

export interface PublicationReportSnapshotSummary {
  id: string;
  spaceId: string;
  criteria: PublicationReportCriteria;
  totals: PublicationReportTotals;
  rowCount: number;
  createdBy: string | null;
  correlationId: string;
  createdAt: string;
}

export interface PublicationReportSnapshot
  extends PublicationReportSnapshotSummary {
  rows: PublicationReportRow[];
}

export interface PublicationAudienceSnapshotResult {
  report: PublicationReport;
  audience: AudienceSnapshotResult;
}

interface ConfigurationRow {
  space_id: string;
  publication_entity_type_key: string;
  teacher_entity_type_key: string;
  publication_year_property_key: string | null;
  publication_date_property_key: string | null;
  teacher_department_property_key: string | null;
  doi_property_key: string | null;
  journal_property_key: string | null;
  bibliography_property_key: string | null;
  status_property_key: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface SpaceRow {
  id: string;
  key: string;
}

interface EntityRow {
  id: string;
  display_name: string;
  status: string;
  entity_type_key: string;
}

interface PropertyDefinitionRow {
  id: string;
  key: string;
  value_type: string;
  applies_to_json: string;
  validation_json: string;
  version?: number;
}

interface PropertyValueRow {
  entity_id: string;
  property_key: string;
  value_json: string;
}

interface AuthorRow {
  id: string;
  publication_entity_id: string;
  author_entity_id: string;
  display_name: string;
  entity_type_key: string;
  role: string;
  position: number;
  department_json: string | null;
  created_at: string;
  updated_at: string;
}

interface ClassificationRow {
  publication_entity_id: string;
  code: string;
  state: string;
  source: string | null;
  checked_at: string | null;
  note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface SnapshotRow {
  id: string;
  space_id: string;
  criteria_json: string;
  totals_json: string;
  row_count: number;
  created_by: string | null;
  correlation_id: string;
  created_at: string;
}

interface SnapshotValueRow {
  position: number;
  row_json: string;
}

export class PublicationValidationError extends KnowledgeValidationError {
  override name = "PublicationValidationError";
}

export class PublicationNotFoundError extends KnowledgeNotFoundError {
  override name = "PublicationNotFoundError";
}

export class PublicationConflictError extends KnowledgeConflictError {
  override name = "PublicationConflictError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new PublicationValidationError(`Поле «${name}» должно быть строкой.`);
  }
  const normalized = value.normalize("NFKC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new PublicationValidationError(`Поле «${name}» заполнено некорректно.`);
  }
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  name: string,
  maximum = 2_000
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new PublicationValidationError(`Поле «${name}» заполнено некорректно.`);
  }
  return normalized;
}

function stableKey(value: string, name: string): string {
  const normalized = requiredText(value, name, 160).toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(normalized)) {
    throw new PublicationValidationError(
      `Поле «${name}» должно быть стабильным техническим обозначением.`
    );
  }
  return normalized;
}

function optionalStableKey(
  value: string | null | undefined,
  name: string
): string | null {
  const normalized = optionalText(value, name, 160);
  return normalized === null ? null : stableKey(normalized, name);
}

function timestamp(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new PublicationValidationError("Время операции заполнено некорректно.");
  }
  return date.toISOString();
}

function normalizeDate(value: string | null | undefined, name: string): string | null {
  const normalized = optionalText(value, name, 64);
  if (normalized === null) return null;
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/u.test(normalized)
      ? `${normalized}T00:00:00.000Z`
      : normalized
  );
  if (Number.isNaN(date.getTime())) {
    throw new PublicationValidationError(`Поле «${name}» не является датой.`);
  }
  return /^\d{4}-\d{2}-\d{2}$/u.test(normalized)
    ? normalized
    : date.toISOString();
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
    actorId: optionalText(context.actorId, "actorId", 160),
    now: timestamp(context.now)
  };
}

function classificationCode(value: string): PublicationClassificationCode {
  if (PUBLICATION_CLASSIFICATION_CODES.includes(value as PublicationClassificationCode)) {
    return value as PublicationClassificationCode;
  }
  throw new PublicationValidationError(`Неизвестная классификация публикации: ${value}.`);
}

function classificationState(value: string): PublicationClassificationState {
  if (PUBLICATION_CLASSIFICATION_STATES.includes(value as PublicationClassificationState)) {
    return value as PublicationClassificationState;
  }
  throw new PublicationValidationError(`Неизвестное состояние классификации: ${value}.`);
}

function authorRole(value: string): PublicationAuthorRole {
  if (PUBLICATION_AUTHOR_ROLES.includes(value as PublicationAuthorRole)) {
    return value as PublicationAuthorRole;
  }
  throw new PublicationValidationError(`Неизвестная роль автора: ${value}.`);
}

function classificationMatch(value: string | undefined): PublicationClassificationMatch {
  if (value === undefined || value === "any") return "any";
  if (value === "all") return "all";
  throw new PublicationValidationError("Режим классификаций должен быть «любая» или «все». ");
}

function normalizeComparable(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .trim();
}

function jsonScalarText(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length === 0 ? null : normalized;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function jsonScalarDate(value: JsonValue | undefined): string | null {
  const text = jsonScalarText(value);
  if (text === null) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/u.test(text) ? `${text}T00:00:00.000Z` : text);
  return Number.isNaN(parsed.getTime()) ? null : text;
}

function jsonScalarYear(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string") {
    const match = /(?:^|\D)(19|20|21)\d{2}(?:\D|$)/u.exec(value);
    if (match !== null) {
      const year = Number(match[0].replace(/\D/gu, ""));
      if (Number.isInteger(year)) return year;
    }
  }
  return null;
}

function asJsonObject(value: unknown, name: string): Record<string, JsonValue> {
  const normalized = toJsonValue(value);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== "object") {
    throw new Error(`Stored ${name} is not a JSON object`);
  }
  return normalized;
}

function mapConfiguration(row: ConfigurationRow): PublicationRegistryConfiguration {
  return {
    spaceId: row.space_id,
    publicationEntityTypeKey: row.publication_entity_type_key,
    teacherEntityTypeKey: row.teacher_entity_type_key,
    publicationYearPropertyKey: row.publication_year_property_key,
    publicationDatePropertyKey: row.publication_date_property_key,
    teacherDepartmentPropertyKey: row.teacher_department_property_key,
    doiPropertyKey: row.doi_property_key,
    journalPropertyKey: row.journal_property_key,
    bibliographyPropertyKey: row.bibliography_property_key,
    statusPropertyKey: row.status_property_key,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapClassification(row: ClassificationRow): PublicationClassificationRecord {
  const code = classificationCode(row.code);
  return {
    publicationEntityId: row.publication_entity_id,
    code,
    label: PUBLICATION_CLASSIFICATION_LABELS[code],
    state: classificationState(row.state),
    source: row.source,
    checkedAt: row.checked_at,
    note: row.note,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeCriteria(input: PublicationReportCriteriaInput = {}): PublicationReportCriteria {
  const year = input.year ?? null;
  if (
    year !== null &&
    (!Number.isInteger(year) || year < 1900 || year > 3000)
  ) {
    throw new PublicationValidationError("Год отчёта должен быть целым числом от 1900 до 3000.");
  }
  const dateFrom = normalizeDate(input.dateFrom, "dateFrom");
  const dateTo = normalizeDate(input.dateTo, "dateTo");
  if (
    dateFrom !== null &&
    dateTo !== null &&
    new Date(dateFrom.length === 10 ? `${dateFrom}T00:00:00.000Z` : dateFrom).getTime() >
      new Date(dateTo.length === 10 ? `${dateTo}T23:59:59.999Z` : dateTo).getTime()
  ) {
    throw new PublicationValidationError("Начальная дата отчёта не может быть позже конечной.");
  }
  const classifications = [
    ...new Set((input.classifications ?? []).map((value) => classificationCode(value)))
  ].sort((left, right) => left.localeCompare(right));
  const limit = input.limit ?? 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new PublicationValidationError("Размер отчёта должен быть от 1 до 1000 строк.");
  }
  return {
    year,
    dateFrom,
    dateTo,
    classifications,
    classificationMatch: classificationMatch(input.classificationMatch),
    includeReview: input.includeReview ?? false,
    teacherEntityId: optionalText(input.teacherEntityId, "teacherEntityId", 160),
    department: optionalText(input.department, "department", 500),
    status: optionalText(input.status, "status", 500),
    includeInactive: input.includeInactive ?? false,
    limit
  };
}

function emptyClassificationTotals(): Record<PublicationClassificationCode, number> {
  return {
    vak: 0,
    rinc: 0,
    mbd: 0,
    scopus: 0,
    web_of_science: 0,
    rinc_core: 0
  };
}

function propertyValueMapKey(entityId: string, propertyKey: string): string {
  return `${entityId}\u0000${propertyKey}`;
}

const systemPropertySpecs = [
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.authors,
    label: "Авторы публикации",
    valueType: "string",
    description: "Сформированный список всех авторов публикации."
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.internalAuthors,
    label: "Авторы-преподаватели",
    valueType: "string",
    description: "Сформированный список связанных преподавателей."
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.departments,
    label: "Кафедры авторов",
    valueType: "string",
    description: "Сформированный список кафедр внутренних авторов."
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.classifications,
    label: "Классификации публикации",
    valueType: "string",
    description: "Сформированный список подтверждённых и проверяемых классификаций."
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.vak,
    label: "Входит в ВАК",
    valueType: "boolean",
    description: "Подтверждённая принадлежность публикации к ВАК."
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.rinc,
    label: "Входит в РИНЦ",
    valueType: "boolean",
    description: "Подтверждённая принадлежность публикации к РИНЦ."
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.mbd,
    label: "Входит в МБД",
    valueType: "boolean",
    description: "Подтверждённая принадлежность публикации к международной базе данных."
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.scopus,
    label: "Входит в Scopus",
    valueType: "boolean",
    description: "Подтверждённая принадлежность публикации к Scopus."
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.webOfScience,
    label: "Входит в Web of Science",
    valueType: "boolean",
    description: "Подтверждённая принадлежность публикации к Web of Science."
  },
  {
    key: PUBLICATION_DERIVED_PROPERTY_KEYS.rincCore,
    label: "Входит в ядро РИНЦ",
    valueType: "boolean",
    description: "Подтверждённая принадлежность публикации к ядру РИНЦ."
  }
] as const;

export class PublicationRegistry {
  private readonly knowledge: KnowledgeRegistry;
  private readonly spaces: SpaceRegistry;
  private readonly audit: AuditRepository;
  private readonly outbox: DomainEventOutbox;

  constructor(
    private readonly store: SqliteStore,
    options: {
      knowledge?: KnowledgeRegistry;
      spaces?: SpaceRegistry;
      audit?: AuditRepository;
      outbox?: DomainEventOutbox;
    } = {}
  ) {
    this.knowledge = options.knowledge ?? new KnowledgeRegistry(store);
    this.spaces = options.spaces ?? new SpaceRegistry(store);
    this.audit = options.audit ?? new AuditRepository(store);
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
  }

  schemaReady(): boolean {
    return this.store.execute((connection) => {
      const required = [
        "publication_registry_settings",
        "publication_authorships",
        "publication_classifications",
        "publication_report_snapshots",
        "publication_report_rows"
      ];
      const placeholders = required.map(() => "?").join(", ");
      const rows = connection
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name IN (${placeholders})
        `)
        .all(...required) as unknown as Array<{ name: string }>;
      return new Set(rows.map((row) => row.name)).size === required.length;
    });
  }

  getConfiguration(spaceIdentity: string): PublicationRegistryConfiguration | null {
    return this.store.execute((connection) => {
      const space = this.requireSpace(connection, spaceIdentity);
      const row = connection
        .prepare("SELECT * FROM publication_registry_settings WHERE space_id = ?")
        .get(space.id) as ConfigurationRow | undefined;
      return row === undefined ? null : mapConfiguration(row);
    });
  }

  configure(
    spaceIdentity: string,
    input: PublicationRegistryConfigurationInput,
    contextInput: MutationContext
  ): PublicationRegistryConfiguration {
    const context = contextValue(contextInput);
    const normalized = {
      publicationEntityTypeKey: stableKey(
        input.publicationEntityTypeKey,
        "publicationEntityTypeKey"
      ),
      teacherEntityTypeKey: stableKey(input.teacherEntityTypeKey, "teacherEntityTypeKey"),
      publicationYearPropertyKey: optionalStableKey(
        input.publicationYearPropertyKey,
        "publicationYearPropertyKey"
      ),
      publicationDatePropertyKey: optionalStableKey(
        input.publicationDatePropertyKey,
        "publicationDatePropertyKey"
      ),
      teacherDepartmentPropertyKey: optionalStableKey(
        input.teacherDepartmentPropertyKey,
        "teacherDepartmentPropertyKey"
      ),
      doiPropertyKey: optionalStableKey(input.doiPropertyKey, "doiPropertyKey"),
      journalPropertyKey: optionalStableKey(
        input.journalPropertyKey,
        "journalPropertyKey"
      ),
      bibliographyPropertyKey: optionalStableKey(
        input.bibliographyPropertyKey,
        "bibliographyPropertyKey"
      ),
      statusPropertyKey: optionalStableKey(input.statusPropertyKey, "statusPropertyKey")
    };
    if (normalized.publicationEntityTypeKey === normalized.teacherEntityTypeKey) {
      throw new PublicationValidationError(
        "Тип публикации и тип преподавателя должны быть разными."
      );
    }

    return this.store.transaction((connection) => {
      const space = this.requireSpace(connection, spaceIdentity);
      this.requireEntityType(connection, normalized.publicationEntityTypeKey);
      this.requireEntityType(connection, normalized.teacherEntityTypeKey);
      this.validateConfiguredProperties(connection, normalized);
      this.ensureSystemProperties(
        connection,
        normalized.publicationEntityTypeKey,
        contextInput
      );

      const current = connection
        .prepare("SELECT * FROM publication_registry_settings WHERE space_id = ?")
        .get(space.id) as ConfigurationRow | undefined;
      if (
        current !== undefined &&
        current.publication_entity_type_key !== normalized.publicationEntityTypeKey
      ) {
        const hasAuthorships = connection
          .prepare("SELECT 1 AS found FROM publication_authorships WHERE space_id = ? LIMIT 1")
          .get(space.id);
        const hasClassifications = connection
          .prepare("SELECT 1 AS found FROM publication_classifications WHERE space_id = ? LIMIT 1")
          .get(space.id);
        if (hasAuthorships !== undefined || hasClassifications !== undefined) {
          throw new PublicationConflictError(
            "Нельзя изменить тип публикаций, пока в пространстве существуют связи авторства или классификации."
          );
        }
      }
      if (current === undefined) {
        connection
          .prepare(`
            INSERT INTO publication_registry_settings(
              space_id, publication_entity_type_key, teacher_entity_type_key,
              publication_year_property_key, publication_date_property_key,
              teacher_department_property_key, doi_property_key,
              journal_property_key, bibliography_property_key, status_property_key,
              version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `)
          .run(
            space.id,
            normalized.publicationEntityTypeKey,
            normalized.teacherEntityTypeKey,
            normalized.publicationYearPropertyKey,
            normalized.publicationDatePropertyKey,
            normalized.teacherDepartmentPropertyKey,
            normalized.doiPropertyKey,
            normalized.journalPropertyKey,
            normalized.bibliographyPropertyKey,
            normalized.statusPropertyKey,
            context.now,
            context.now
          );
      } else {
        connection
          .prepare(`
            UPDATE publication_registry_settings
            SET publication_entity_type_key = ?, teacher_entity_type_key = ?,
                publication_year_property_key = ?, publication_date_property_key = ?,
                teacher_department_property_key = ?, doi_property_key = ?,
                journal_property_key = ?, bibliography_property_key = ?,
                status_property_key = ?, version = version + 1, updated_at = ?
            WHERE space_id = ?
          `)
          .run(
            normalized.publicationEntityTypeKey,
            normalized.teacherEntityTypeKey,
            normalized.publicationYearPropertyKey,
            normalized.publicationDatePropertyKey,
            normalized.teacherDepartmentPropertyKey,
            normalized.doiPropertyKey,
            normalized.journalPropertyKey,
            normalized.bibliographyPropertyKey,
            normalized.statusPropertyKey,
            context.now,
            space.id
          );
      }
      const updated = connection
        .prepare("SELECT * FROM publication_registry_settings WHERE space_id = ?")
        .get(space.id) as ConfigurationRow | undefined;
      if (updated === undefined) {
        throw new Error("Publication registry configuration was not persisted");
      }
      const record = mapConfiguration(updated);
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: current === undefined ? "configure" : "reconfigure",
          objectType: "publication_registry",
          objectId: space.id,
          correlationId: context.correlationId,
          details: {
            publicationEntityTypeKey: record.publicationEntityTypeKey,
            teacherEntityTypeKey: record.teacherEntityTypeKey,
            version: record.version
          }
        },
        connection
      );
      this.outbox.append(
        {
          eventType: "publication_registry.configured",
          schemaVersion: 1,
          source: "publication-registry",
          occurredAt: context.now,
          payload: {
            spaceId: space.id,
            publicationEntityTypeKey: record.publicationEntityTypeKey,
            teacherEntityTypeKey: record.teacherEntityTypeKey,
            version: record.version
          },
          dedupeKey: `publication_registry.configured:${space.id}:v${record.version}`,
          now: context.now
        },
        connection
      );
      return record;
    });
  }

  ensureDefaultConfiguration(
    spaceIdentity: string,
    contextInput: MutationContext
  ): PublicationRegistryConfiguration {
    const existing = this.getConfiguration(spaceIdentity);
    if (existing !== null) return existing;
    this.store.transaction((connection) => {
      this.requireSpace(connection, spaceIdentity);
      this.ensureEntityType(
        connection,
        "scientific-publication",
        "Научная статья",
        "Публикация с авторами, изданием, идентификаторами и классификациями.",
        contextInput
      );
      this.requireEntityType(connection, "person");
      const publicationProperties = [
        ["publication.year", "Год публикации", "integer", "Календарный год публикации."],
        ["publication.date", "Дата публикации", "date", "Дата выхода публикации."],
        ["publication.doi", "DOI", "string", "Цифровой идентификатор публикации."],
        ["publication.edn", "EDN", "string", "Идентификатор публикации в eLIBRARY."],
        ["publication.journal", "Журнал или сборник", "string", "Наименование издания."],
        ["publication.issn", "ISSN или ISBN", "string", "Идентификатор издания."],
        [
          "publication.bibliography",
          "Библиографическое описание",
          "text",
          "Полное библиографическое описание публикации."
        ],
        ["publication.status", "Статус публикации", "enum", "Состояние подготовки и выхода."]
      ] as const;
      for (const [key, label, valueType, description] of publicationProperties) {
        this.ensureProperty(
          connection,
          {
            key,
            label,
            valueType,
            description,
            appliesTo: "scientific-publication",
            validation:
              key === "publication.status"
                ? {
                    enum: ["Подготовка", "Принята", "Опубликована"],
                    allowCustom: true,
                    uiGroup: "unassigned"
                  }
                : { uiGroup: "unassigned" }
          },
          contextInput
        );
      }
      this.ensureProperty(
        connection,
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
    });
    return this.configure(
      spaceIdentity,
      {
        publicationEntityTypeKey: "scientific-publication",
        teacherEntityTypeKey: "person",
        publicationYearPropertyKey: "publication.year",
        publicationDatePropertyKey: "publication.date",
        teacherDepartmentPropertyKey: "person.department",
        doiPropertyKey: "publication.doi",
        journalPropertyKey: "publication.journal",
        bibliographyPropertyKey: "publication.bibliography",
        statusPropertyKey: "publication.status"
      },
      contextInput
    );
  }

  listAuthors(
    spaceIdentity: string,
    publicationEntityIdValue: string
  ): PublicationAuthorRecord[] {
    return this.store.execute((connection) => {
      const space = this.requireSpace(connection, spaceIdentity);
      const configuration = this.requireConfiguration(connection, space.id);
      const publication = this.requirePublication(
        connection,
        space.id,
        publicationEntityIdValue,
        configuration
      );
      return this.readAuthors(connection, configuration, publication.id);
    });
  }

  replaceAuthors(
    spaceIdentity: string,
    publicationEntityIdValue: string,
    values: readonly ReplacePublicationAuthorInput[],
    contextInput: MutationContext
  ): PublicationAuthorRecord[] {
    if (!Array.isArray(values) || values.length > 200) {
      throw new PublicationValidationError("Для одной публикации допускается не более 200 авторов.");
    }
    const normalized = values.map((value, index) => ({
      authorEntityId: requiredText(value.authorEntityId, `authors[${index}].authorEntityId`, 160),
      role: authorRole(value.role ?? "author"),
      position: value.position ?? index
    }));
    if (new Set(normalized.map((value) => value.authorEntityId)).size !== normalized.length) {
      throw new PublicationValidationError("Один автор не должен повторяться в публикации.");
    }
    if (
      normalized.some(
        (value) => !Number.isInteger(value.position) || value.position < 0 || value.position > 10_000
      ) ||
      new Set(normalized.map((value) => value.position)).size !== normalized.length
    ) {
      throw new PublicationValidationError("Порядок авторов заполнен некорректно.");
    }
    normalized.sort((left, right) => left.position - right.position);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const space = this.requireSpace(connection, spaceIdentity);
      const configuration = this.requireConfiguration(connection, space.id);
      const publication = this.requirePublication(
        connection,
        space.id,
        publicationEntityIdValue,
        configuration
      );
      for (const author of normalized) {
        const authorEntity = this.requireEntityInSpace(
          connection,
          space.id,
          author.authorEntityId
        );
        if (
          authorEntity.id === publication.id ||
          authorEntity.entity_type_key === configuration.publicationEntityTypeKey
        ) {
          throw new PublicationValidationError(
            "Публикация не может быть указана как автор другой публикации."
          );
        }
      }
      connection
        .prepare("DELETE FROM publication_authorships WHERE publication_entity_id = ?")
        .run(publication.id);
      const insert = connection.prepare(`
        INSERT INTO publication_authorships(
          id, space_id, publication_entity_id, author_entity_id,
          role, position, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      normalized.forEach((author, index) => {
        insert.run(
          randomUUID(),
          space.id,
          publication.id,
          author.authorEntityId,
          author.role,
          index,
          context.actorId,
          context.now,
          context.now
        );
      });
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "replace_authors",
          objectType: "publication",
          objectId: publication.id,
          correlationId: context.correlationId,
          details: {
            spaceId: space.id,
            authorCount: normalized.length,
            authorEntityIds: normalized.map((author) => author.authorEntityId)
          }
        },
        connection
      );
      const authorDigest = createHash("sha256")
        .update(
          stringifyJson(
            toJsonValue(
              normalized.map((author) => ({
                authorEntityId: author.authorEntityId,
                role: author.role,
                position: author.position
              }))
            )
          )
        )
        .digest("hex");
      this.outbox.append(
        {
          eventType: "publication.authors_replaced",
          schemaVersion: 1,
          source: "publication-registry",
          occurredAt: context.now,
          entityId: publication.id,
          payload: {
            publicationEntityId: publication.id,
            spaceId: space.id,
            authorCount: normalized.length,
            authors: normalized.map((author) => ({
              authorEntityId: author.authorEntityId,
              role: author.role,
              position: author.position
            }))
          },
          dedupeKey: `publication.authors_replaced:${publication.id}:${context.correlationId}:${authorDigest}`,
          now: context.now
        },
        connection
      );
      this.syncDerivedProperties(connection, configuration, publication.id, contextInput);
      return this.readAuthors(connection, configuration, publication.id);
    });
  }

  listClassifications(
    spaceIdentity: string,
    publicationEntityIdValue: string
  ): PublicationClassificationRecord[] {
    return this.store.execute((connection) => {
      const space = this.requireSpace(connection, spaceIdentity);
      const configuration = this.requireConfiguration(connection, space.id);
      const publication = this.requirePublication(
        connection,
        space.id,
        publicationEntityIdValue,
        configuration
      );
      return this.readClassifications(connection, publication.id);
    });
  }

  setClassification(
    spaceIdentity: string,
    publicationEntityIdValue: string,
    codeValue: string,
    input: SetPublicationClassificationInput,
    contextInput: MutationContext
  ): PublicationClassificationRecord {
    const code = classificationCode(codeValue);
    const state = classificationState(input.state);
    const source = optionalText(input.source, "source", 1_000);
    const checkedAt = normalizeDate(input.checkedAt, "checkedAt");
    const note = optionalText(input.note, "note", 4_000);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const space = this.requireSpace(connection, spaceIdentity);
      const configuration = this.requireConfiguration(connection, space.id);
      const publication = this.requirePublication(
        connection,
        space.id,
        publicationEntityIdValue,
        configuration
      );
      const existing = connection
        .prepare(`
          SELECT * FROM publication_classifications
          WHERE publication_entity_id = ? AND code = ?
        `)
        .get(publication.id, code) as ClassificationRow | undefined;
      if (existing === undefined) {
        connection
          .prepare(`
            INSERT INTO publication_classifications(
              publication_entity_id, space_id, code, state, source,
              checked_at, note, version, updated_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
          `)
          .run(
            publication.id,
            space.id,
            code,
            state,
            source,
            checkedAt,
            note,
            context.actorId,
            context.now,
            context.now
          );
      } else {
        connection
          .prepare(`
            UPDATE publication_classifications
            SET state = ?, source = ?, checked_at = ?, note = ?,
                version = version + 1, updated_by = ?, updated_at = ?
            WHERE publication_entity_id = ? AND code = ?
          `)
          .run(
            state,
            source,
            checkedAt,
            note,
            context.actorId,
            context.now,
            publication.id,
            code
          );
      }
      const row = connection
        .prepare(`
          SELECT * FROM publication_classifications
          WHERE publication_entity_id = ? AND code = ?
        `)
        .get(publication.id, code) as ClassificationRow | undefined;
      if (row === undefined) throw new Error("Publication classification was not persisted");
      const record = mapClassification(row);
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "set_classification",
          objectType: "publication",
          objectId: publication.id,
          correlationId: context.correlationId,
          details: { code, state, version: record.version }
        },
        connection
      );
      this.outbox.append(
        {
          eventType: "publication.classification_changed",
          schemaVersion: 1,
          source: "publication-registry",
          occurredAt: context.now,
          entityId: publication.id,
          payload: {
            publicationEntityId: publication.id,
            code,
            state,
            version: record.version
          },
          dedupeKey: `publication.classification_changed:${publication.id}:${code}:v${record.version}`,
          now: context.now
        },
        connection
      );
      this.syncDerivedProperties(connection, configuration, publication.id, contextInput);
      return record;
    });
  }

  removeClassification(
    spaceIdentity: string,
    publicationEntityIdValue: string,
    codeValue: string,
    contextInput: MutationContext
  ): void {
    const code = classificationCode(codeValue);
    const context = contextValue(contextInput);
    this.store.transaction((connection) => {
      const space = this.requireSpace(connection, spaceIdentity);
      const configuration = this.requireConfiguration(connection, space.id);
      const publication = this.requirePublication(
        connection,
        space.id,
        publicationEntityIdValue,
        configuration
      );
      const existing = connection
        .prepare(`
          SELECT * FROM publication_classifications
          WHERE publication_entity_id = ? AND code = ?
        `)
        .get(publication.id, code) as ClassificationRow | undefined;
      if (existing === undefined) {
        throw new PublicationNotFoundError("Классификация публикации не найдена.");
      }
      connection
        .prepare(`
          DELETE FROM publication_classifications
          WHERE publication_entity_id = ? AND code = ?
        `)
        .run(publication.id, code);
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "remove_classification",
          objectType: "publication",
          objectId: publication.id,
          correlationId: context.correlationId,
          details: { code, previousVersion: existing.version }
        },
        connection
      );
      this.outbox.append(
        {
          eventType: "publication.classification_removed",
          schemaVersion: 1,
          source: "publication-registry",
          occurredAt: context.now,
          entityId: publication.id,
          payload: {
            publicationEntityId: publication.id,
            code,
            previousVersion: existing.version
          },
          dedupeKey: `publication.classification_removed:${publication.id}:${code}:v${existing.version + 1}`,
          now: context.now
        },
        connection
      );
      this.syncDerivedProperties(connection, configuration, publication.id, contextInput);
    });
  }

  buildReport(
    spaceIdentity: string,
    input: PublicationReportCriteriaInput = {}
  ): PublicationReport {
    const criteria = normalizeCriteria(input);
    return this.store.execute((connection) => {
      const space = this.requireSpace(connection, spaceIdentity);
      const configuration = this.requireConfiguration(connection, space.id);
      return this.buildReportWithConnection(connection, space.id, configuration, criteria);
    });
  }

  createReportSnapshot(
    spaceIdentity: string,
    input: PublicationReportCriteriaInput,
    contextInput: MutationContext
  ): PublicationReportSnapshot {
    const criteria = normalizeCriteria({
      ...input,
      limit: input.limit ?? 1_000
    });
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const space = this.requireSpace(connection, spaceIdentity);
      const configuration = this.requireConfiguration(connection, space.id);
      const report = this.buildReportWithConnection(
        connection,
        space.id,
        configuration,
        criteria,
        context.now
      );
      if (report.rows.length === 0) {
        throw new PublicationValidationError("Нельзя зафиксировать пустой отчёт.");
      }
      if (report.totals.truncated) {
        throw new PublicationValidationError(
          "В отчёте больше 1000 публикаций. Уточните условия перед фиксацией снимка."
        );
      }
      const id = randomUUID();
      connection
        .prepare(`
          INSERT INTO publication_report_snapshots(
            id, space_id, criteria_json, totals_json, row_count,
            created_by, correlation_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          space.id,
          stringifyJson(toJsonValue(report.criteria)),
          stringifyJson(toJsonValue(report.totals)),
          report.rows.length,
          context.actorId,
          context.correlationId,
          context.now
        );
      const insert = connection.prepare(`
        INSERT INTO publication_report_rows(
          snapshot_id, position, publication_entity_id, row_json
        ) VALUES (?, ?, ?, ?)
      `);
      report.rows.forEach((row, position) => {
        insert.run(id, position, row.publicationEntityId, stringifyJson(toJsonValue(row)));
      });
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "create_report_snapshot",
          objectType: "publication_report_snapshot",
          objectId: id,
          correlationId: context.correlationId,
          details: {
            spaceId: space.id,
            rowCount: report.rows.length,
            matchedRowCount: report.totals.matchedRowCount
          }
        },
        connection
      );
      this.outbox.append(
        {
          eventType: "publication.report_snapshot_created",
          schemaVersion: 1,
          source: "publication-registry",
          occurredAt: context.now,
          payload: toJsonValue({
            id,
            spaceId: space.id,
            rowCount: report.rows.length,
            criteria: report.criteria,
            totals: report.totals
          }),
          dedupeKey: `publication.report_snapshot_created:${id}`,
          now: context.now
        },
        connection
      );
      return {
        id,
        spaceId: space.id,
        criteria: report.criteria,
        totals: report.totals,
        rowCount: report.rows.length,
        createdBy: context.actorId,
        correlationId: context.correlationId,
        createdAt: context.now,
        rows: report.rows
      };
    });
  }

  listReportSnapshots(
    spaceIdentity: string,
    limitValue = 50
  ): PublicationReportSnapshotSummary[] {
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 200) {
      throw new PublicationValidationError("Количество снимков должно быть от 1 до 200.");
    }
    return this.store.execute((connection) => {
      const space = this.requireSpace(connection, spaceIdentity);
      const rows = connection
        .prepare(`
          SELECT *
          FROM publication_report_snapshots
          WHERE space_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `)
        .all(space.id, limitValue) as unknown as SnapshotRow[];
      return rows.map((row) => this.mapSnapshotSummary(row));
    });
  }

  getReportSnapshot(
    spaceIdentity: string,
    snapshotIdValue: string
  ): PublicationReportSnapshot {
    const snapshotId = requiredText(snapshotIdValue, "snapshotId", 160);
    return this.store.execute((connection) => {
      const space = this.requireSpace(connection, spaceIdentity);
      const row = connection
        .prepare(`
          SELECT *
          FROM publication_report_snapshots
          WHERE id = ? AND space_id = ?
        `)
        .get(snapshotId, space.id) as SnapshotRow | undefined;
      if (row === undefined) {
        throw new PublicationNotFoundError("Снимок отчёта не найден.");
      }
      const values = connection
        .prepare(`
          SELECT position, row_json
          FROM publication_report_rows
          WHERE snapshot_id = ?
          ORDER BY position ASC
        `)
        .all(snapshotId) as unknown as SnapshotValueRow[];
      return {
        ...this.mapSnapshotSummary(row),
        rows: values.map((value) =>
          this.parseReportRow(parseJson(value.row_json), "publication report row")
        )
      };
    });
  }

  createAudienceSnapshot(
    spaceIdentity: string,
    input: PublicationReportCriteriaInput,
    contextInput: MutationContext
  ): PublicationAudienceSnapshotResult {
    const criteria = normalizeCriteria({ ...input, limit: 1_000 });
    const report = this.buildReport(spaceIdentity, criteria);
    if (report.rows.length === 0) {
      throw new PublicationValidationError("По условиям отчёта не найдено публикаций.");
    }
    if (report.totals.truncated) {
      throw new PublicationValidationError(
        "В отчёте больше 1000 публикаций. Уточните год, кафедру или классификацию."
      );
    }
    const audience = this.spaces.createAudienceSnapshot(
      spaceIdentity,
      {
        source: {
          kind: "selected",
          entityIds: report.rows.map((row) => row.publicationEntityId)
        },
        targetMode: "aggregate",
        includeInactive: criteria.includeInactive
      },
      contextInput
    );
    return { report, audience };
  }

  createAudienceSnapshotFromReportSnapshot(
    spaceIdentity: string,
    snapshotIdValue: string,
    contextInput: MutationContext
  ): PublicationAudienceSnapshotResult {
    const snapshot = this.getReportSnapshot(spaceIdentity, snapshotIdValue);
    if (snapshot.rows.length === 0) {
      throw new PublicationValidationError("Зафиксированный отчёт не содержит публикаций.");
    }
    const audience = this.spaces.createAudienceSnapshot(
      spaceIdentity,
      {
        source: {
          kind: "selected",
          entityIds: snapshot.rows.map((row) => row.publicationEntityId)
        },
        targetMode: "aggregate",
        includeInactive: snapshot.criteria.includeInactive
      },
      contextInput
    );
    return {
      report: {
        spaceId: snapshot.spaceId,
        criteria: snapshot.criteria,
        generatedAt: snapshot.createdAt,
        rows: snapshot.rows,
        totals: snapshot.totals
      },
      audience
    };
  }

  private requireSpace(connection: SqliteExecutor, identityValue: string): SpaceRow {
    const identity = requiredText(identityValue, "spaceId", 160);
    const row = connection
      .prepare("SELECT id, key FROM spaces WHERE id = ? OR key = ?")
      .get(identity, identity.toLowerCase()) as SpaceRow | undefined;
    if (row === undefined) throw new PublicationNotFoundError("Пространство не найдено.");
    return row;
  }

  private requireEntityType(connection: SqliteExecutor, keyValue: string): void {
    const key = stableKey(keyValue, "entityTypeKey");
    const row = connection.prepare("SELECT 1 AS found FROM entity_types WHERE key = ?").get(key);
    if (row === undefined) {
      throw new PublicationNotFoundError(`Тип объектов «${key}» не найден.`);
    }
  }

  private ensureEntityType(
    connection: SqliteExecutor,
    key: string,
    label: string,
    description: string,
    context: MutationContext
  ): void {
    if (connection.prepare("SELECT 1 AS found FROM entity_types WHERE key = ?").get(key)) return;
    this.knowledge.createEntityType({ key, label, description }, context);
  }

  private ensureProperty(
    connection: SqliteExecutor,
    specification: {
      key: string;
      label: string;
      valueType: string;
      description: string;
      appliesTo: string;
      validation: JsonValue;
    },
    context: MutationContext
  ): void {
    const existing = connection
      .prepare("SELECT id, key, value_type, applies_to_json, validation_json, version FROM property_definitions WHERE key = ?")
      .get(specification.key) as PropertyDefinitionRow | undefined;
    if (existing === undefined) {
      this.knowledge.createPropertyDefinition(
        {
          key: specification.key,
          label: specification.label,
          valueType: specification.valueType,
          description: specification.description,
          sensitivity: "internal",
          appliesTo: [specification.appliesTo],
          validation: specification.validation
        },
        context
      );
      return;
    }
    const appliesTo = parseJson(existing.applies_to_json);
    if (
      existing.value_type !== specification.valueType ||
      !Array.isArray(appliesTo) ||
      !appliesTo.every((value) => typeof value === "string")
    ) {
      throw new PublicationConflictError(
        `Системное поле «${specification.key}» уже существует с несовместимым определением.`
      );
    }
    const expectedValidation = asJsonObject(
      specification.validation,
      `validation for ${specification.key}`
    );
    const existingValidation = asJsonObject(
      parseJson(existing.validation_json),
      `stored validation for ${specification.key}`
    );
    if (
      expectedValidation.systemManaged === true &&
      existingValidation.systemManaged !== true
    ) {
      throw new PublicationConflictError(
        `Системное поле «${specification.key}» уже занято пользовательским определением.`
      );
    }
    if (appliesTo.length > 0 && !appliesTo.includes(specification.appliesTo)) {
      const contextValueNormalized = contextValue(context);
      connection
        .prepare(`
          UPDATE property_definitions
          SET applies_to_json = ?, version = version + 1, updated_at = ?
          WHERE id = ?
        `)
        .run(
          stringifyJson([...appliesTo, specification.appliesTo].sort()),
          contextValueNormalized.now,
          existing.id
        );
    }
  }

  private ensureSystemProperties(
    connection: SqliteExecutor,
    publicationEntityTypeKey: string,
    context: MutationContext
  ): void {
    for (const specification of systemPropertySpecs) {
      this.ensureProperty(
        connection,
        {
          ...specification,
          appliesTo: publicationEntityTypeKey,
          validation: { uiGroup: "unassigned", systemManaged: true }
        },
        context
      );
    }
  }

  private propertyDefinition(
    connection: SqliteExecutor,
    key: string
  ): PropertyDefinitionRow {
    const row = connection
      .prepare("SELECT id, key, value_type, applies_to_json, validation_json FROM property_definitions WHERE key = ?")
      .get(key) as PropertyDefinitionRow | undefined;
    if (row === undefined) {
      throw new PublicationNotFoundError(`Поле «${key}» не найдено.`);
    }
    return row;
  }

  private validateProperty(
    connection: SqliteExecutor,
    key: string | null,
    targetEntityTypeKey: string,
    allowedValueTypes: readonly string[],
    label: string
  ): void {
    if (key === null) return;
    const property = this.propertyDefinition(connection, key);
    if (!allowedValueTypes.includes(property.value_type)) {
      throw new PublicationValidationError(
        `Поле «${label}» имеет неподходящий тип значения.`
      );
    }
    const appliesTo = parseJson(property.applies_to_json);
    if (
      !Array.isArray(appliesTo) ||
      !appliesTo.every((value) => typeof value === "string") ||
      (appliesTo.length > 0 && !appliesTo.includes(targetEntityTypeKey))
    ) {
      throw new PublicationValidationError(
        `Поле «${label}» не применяется к выбранному типу объектов.`
      );
    }
  }

  private validateConfiguredProperties(
    connection: SqliteExecutor,
    configuration: Omit<PublicationRegistryConfiguration, "spaceId" | "version" | "createdAt" | "updatedAt">
  ): void {
    this.validateProperty(
      connection,
      configuration.publicationYearPropertyKey,
      configuration.publicationEntityTypeKey,
      ["integer", "number", "string"],
      "Год публикации"
    );
    this.validateProperty(
      connection,
      configuration.publicationDatePropertyKey,
      configuration.publicationEntityTypeKey,
      ["date", "date-time", "string"],
      "Дата публикации"
    );
    this.validateProperty(
      connection,
      configuration.teacherDepartmentPropertyKey,
      configuration.teacherEntityTypeKey,
      ["string", "text", "enum"],
      "Кафедра преподавателя"
    );
    for (const [key, label] of [
      [configuration.doiPropertyKey, "DOI"],
      [configuration.journalPropertyKey, "Журнал"],
      [configuration.bibliographyPropertyKey, "Библиографическое описание"],
      [configuration.statusPropertyKey, "Статус публикации"]
    ] as const) {
      this.validateProperty(
        connection,
        key,
        configuration.publicationEntityTypeKey,
        ["string", "text", "enum"],
        label
      );
    }
  }

  private requireConfiguration(
    connection: SqliteExecutor,
    spaceId: string
  ): PublicationRegistryConfiguration {
    const row = connection
      .prepare("SELECT * FROM publication_registry_settings WHERE space_id = ?")
      .get(spaceId) as ConfigurationRow | undefined;
    if (row === undefined) {
      throw new PublicationConflictError(
        "Учёт публикаций ещё не настроен для этого пространства."
      );
    }
    return mapConfiguration(row);
  }

  private requireEntityInSpace(
    connection: SqliteExecutor,
    spaceId: string,
    entityIdValue: string
  ): EntityRow {
    const entityId = requiredText(entityIdValue, "entityId", 160);
    const row = connection
      .prepare(`
        SELECT e.id, e.display_name, e.status, et.key AS entity_type_key
        FROM entities e
        JOIN entity_types et ON et.id = e.entity_type_id
        JOIN space_entity_ownership ownership ON ownership.entity_id = e.id
        WHERE e.id = ? AND ownership.space_id = ?
      `)
      .get(entityId, spaceId) as EntityRow | undefined;
    if (row === undefined) {
      throw new PublicationNotFoundError("Объект не найден в выбранном пространстве.");
    }
    return row;
  }

  private requirePublication(
    connection: SqliteExecutor,
    spaceId: string,
    publicationEntityIdValue: string,
    configuration: PublicationRegistryConfiguration
  ): EntityRow {
    const row = this.requireEntityInSpace(connection, spaceId, publicationEntityIdValue);
    if (row.entity_type_key !== configuration.publicationEntityTypeKey) {
      throw new PublicationValidationError("Выбранный объект не является публикацией.");
    }
    return row;
  }

  private readAuthors(
    connection: SqliteExecutor,
    configuration: PublicationRegistryConfiguration,
    publicationEntityId: string
  ): PublicationAuthorRecord[] {
    const departmentKey = configuration.teacherDepartmentPropertyKey;
    const rows = connection
      .prepare(`
        SELECT
          authorship.id,
          authorship.publication_entity_id,
          authorship.author_entity_id,
          author.display_name,
          author_type.key AS entity_type_key,
          authorship.role,
          authorship.position,
          (
            SELECT value.value_json
            FROM entity_property_values value
            JOIN property_definitions definition
              ON definition.id = value.property_definition_id
            WHERE value.entity_id = author.id
              AND (? IS NOT NULL AND definition.key = ?)
            ORDER BY value.version DESC, value.created_at DESC, value.id DESC
            LIMIT 1
          ) AS department_json,
          authorship.created_at,
          authorship.updated_at
        FROM publication_authorships authorship
        JOIN entities author ON author.id = authorship.author_entity_id
        JOIN entity_types author_type ON author_type.id = author.entity_type_id
        WHERE authorship.publication_entity_id = ?
        ORDER BY authorship.position ASC, authorship.id ASC
      `)
      .all(departmentKey, departmentKey, publicationEntityId) as unknown as AuthorRow[];
    return rows.map((row) => ({
      id: row.id,
      publicationEntityId: row.publication_entity_id,
      authorEntityId: row.author_entity_id,
      displayName: row.display_name,
      entityTypeKey: row.entity_type_key,
      role: authorRole(row.role),
      position: Number(row.position),
      internal: row.entity_type_key === configuration.teacherEntityTypeKey,
      department:
        row.department_json === null
          ? null
          : jsonScalarText(parseJson(row.department_json)),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private readClassifications(
    connection: SqliteExecutor,
    publicationEntityId: string
  ): PublicationClassificationRecord[] {
    const rows = connection
      .prepare(`
        SELECT *
        FROM publication_classifications
        WHERE publication_entity_id = ?
        ORDER BY code ASC
      `)
      .all(publicationEntityId) as unknown as ClassificationRow[];
    return rows.map(mapClassification);
  }

  private latestPropertyJson(
    connection: SqliteExecutor,
    entityId: string,
    propertyKey: string
  ): string | undefined {
    const row = connection
      .prepare(`
        SELECT value.value_json
        FROM entity_property_values value
        JOIN property_definitions definition
          ON definition.id = value.property_definition_id
        WHERE value.entity_id = ? AND definition.key = ?
        ORDER BY value.version DESC, value.created_at DESC, value.id DESC
        LIMIT 1
      `)
      .get(entityId, propertyKey) as { value_json: string } | undefined;
    return row?.value_json;
  }

  private appendDerivedValue(
    connection: SqliteExecutor,
    publicationEntityId: string,
    propertyKey: string,
    value: JsonValue,
    contextInput: MutationContext
  ): void {
    const existing = this.latestPropertyJson(connection, publicationEntityId, propertyKey);
    const next = stringifyJson(value);
    if (existing === next) return;
    const context = contextValue(contextInput);
    this.knowledge.appendPropertyValue(
      {
        entityId: publicationEntityId,
        propertyKey,
        value,
        sourceType: "publication-registry",
        sourceId: publicationEntityId,
        ...(context.actorId === null ? {} : { confirmedBy: context.actorId })
      },
      contextInput
    );
  }

  private syncDerivedProperties(
    connection: SqliteExecutor,
    configuration: PublicationRegistryConfiguration,
    publicationEntityId: string,
    contextInput: MutationContext
  ): void {
    const authors = this.readAuthors(connection, configuration, publicationEntityId);
    const classifications = this.readClassifications(connection, publicationEntityId);
    const internalAuthors = authors.filter((author) => author.internal);
    const departments = [
      ...new Set(
        internalAuthors
          .map((author) => author.department)
          .filter((value): value is string => value !== null)
      )
    ].sort((left, right) => left.localeCompare(right, "ru-RU"));
    const classificationText = classifications
      .filter((item) => item.state !== "excluded")
      .map((item) =>
        item.state === "review" ? `${item.label} (требует проверки)` : item.label
      )
      .join(", ");
    this.appendDerivedValue(
      connection,
      publicationEntityId,
      PUBLICATION_DERIVED_PROPERTY_KEYS.authors,
      authors.map((author) => author.displayName).join("; "),
      contextInput
    );
    this.appendDerivedValue(
      connection,
      publicationEntityId,
      PUBLICATION_DERIVED_PROPERTY_KEYS.internalAuthors,
      internalAuthors.map((author) => author.displayName).join("; "),
      contextInput
    );
    this.appendDerivedValue(
      connection,
      publicationEntityId,
      PUBLICATION_DERIVED_PROPERTY_KEYS.departments,
      departments.join("; "),
      contextInput
    );
    this.appendDerivedValue(
      connection,
      publicationEntityId,
      PUBLICATION_DERIVED_PROPERTY_KEYS.classifications,
      classificationText,
      contextInput
    );
    const confirmed = new Set(
      classifications
        .filter((item) => item.state === "confirmed")
        .map((item) => item.code)
    );
    const booleanProperties: Array<
      readonly [PublicationClassificationCode, string]
    > = [
      ["vak", PUBLICATION_DERIVED_PROPERTY_KEYS.vak],
      ["rinc", PUBLICATION_DERIVED_PROPERTY_KEYS.rinc],
      ["mbd", PUBLICATION_DERIVED_PROPERTY_KEYS.mbd],
      ["scopus", PUBLICATION_DERIVED_PROPERTY_KEYS.scopus],
      ["web_of_science", PUBLICATION_DERIVED_PROPERTY_KEYS.webOfScience],
      ["rinc_core", PUBLICATION_DERIVED_PROPERTY_KEYS.rincCore]
    ];
    for (const [code, propertyKey] of booleanProperties) {
      this.appendDerivedValue(
        connection,
        publicationEntityId,
        propertyKey,
        confirmed.has(code),
        contextInput
      );
    }
  }

  private loadLatestProperties(
    connection: SqliteExecutor,
    entityIds: readonly string[]
  ): Map<string, JsonValue> {
    const values = new Map<string, JsonValue>();
    for (let offset = 0; offset < entityIds.length; offset += 200) {
      const chunk = entityIds.slice(offset, offset + 200);
      if (chunk.length === 0) continue;
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = connection
        .prepare(`
          SELECT value.entity_id, definition.key AS property_key, value.value_json
          FROM entity_property_values value
          JOIN property_definitions definition
            ON definition.id = value.property_definition_id
          JOIN (
            SELECT entity_id, property_definition_id, MAX(version) AS max_version
            FROM entity_property_values
            WHERE entity_id IN (${placeholders})
            GROUP BY entity_id, property_definition_id
          ) latest
            ON latest.entity_id = value.entity_id
           AND latest.property_definition_id = value.property_definition_id
           AND latest.max_version = value.version
          ORDER BY value.entity_id, definition.key
        `)
        .all(...chunk) as unknown as PropertyValueRow[];
      for (const row of rows) {
        values.set(propertyValueMapKey(row.entity_id, row.property_key), parseJson(row.value_json));
      }
    }
    return values;
  }

  private buildReportWithConnection(
    connection: SqliteExecutor,
    spaceId: string,
    configuration: PublicationRegistryConfiguration,
    criteria: PublicationReportCriteria,
    generatedAtValue?: string
  ): PublicationReport {
    const publicationRows = connection
      .prepare(`
        SELECT e.id, e.display_name, e.status, type.key AS entity_type_key
        FROM entities e
        JOIN entity_types type ON type.id = e.entity_type_id
        JOIN space_entity_ownership ownership ON ownership.entity_id = e.id
        WHERE ownership.space_id = ? AND type.key = ?
        ORDER BY e.display_name ASC, e.id ASC
      `)
      .all(spaceId, configuration.publicationEntityTypeKey) as unknown as EntityRow[];
    const publicationIds = publicationRows.map((row) => row.id);
    const propertyValues = this.loadLatestProperties(connection, publicationIds);
    const authorRows = publicationIds.flatMap((publicationEntityId) =>
      this.readAuthors(connection, configuration, publicationEntityId)
    );
    const classifications = publicationIds.flatMap((publicationEntityId) =>
      this.readClassifications(connection, publicationEntityId)
    );
    const authorsByPublication = new Map<string, PublicationAuthorRecord[]>();
    for (const author of authorRows) {
      const items = authorsByPublication.get(author.publicationEntityId) ?? [];
      items.push(author);
      authorsByPublication.set(author.publicationEntityId, items);
    }
    const classificationsByPublication = new Map<
      string,
      PublicationClassificationRecord[]
    >();
    for (const item of classifications) {
      const items = classificationsByPublication.get(item.publicationEntityId) ?? [];
      items.push(item);
      classificationsByPublication.set(item.publicationEntityId, items);
    }
    const valueFor = (entityId: string, propertyKey: string | null): JsonValue | undefined =>
      propertyKey === null
        ? undefined
        : propertyValues.get(propertyValueMapKey(entityId, propertyKey));

    const allRows: PublicationReportRow[] = publicationRows.map((publication) => {
      const dateText = jsonScalarDate(
        valueFor(publication.id, configuration.publicationDatePropertyKey)
      );
      const year =
        jsonScalarYear(valueFor(publication.id, configuration.publicationYearPropertyKey)) ??
        (dateText === null ? null : jsonScalarYear(dateText));
      const authors = (authorsByPublication.get(publication.id) ?? []).map((author) => ({
        entityId: author.authorEntityId,
        displayName: author.displayName,
        role: author.role,
        position: author.position,
        internal: author.internal,
        department: author.department
      }));
      const internalAuthors = authors.filter((author) => author.internal);
      const departments = [
        ...new Set(
          internalAuthors
            .map((author) => author.department)
            .filter((department): department is string => department !== null)
        )
      ].sort((left, right) => left.localeCompare(right, "ru-RU"));
      const rowClassifications = (classificationsByPublication.get(publication.id) ?? []).map(
        (item) => ({
          code: item.code,
          label: item.label,
          state: item.state,
          source: item.source,
          checkedAt: item.checkedAt,
          note: item.note
        })
      );
      return {
        publicationEntityId: publication.id,
        title: publication.display_name,
        entityStatus: publication.status,
        year,
        publicationDate: dateText,
        doi: jsonScalarText(valueFor(publication.id, configuration.doiPropertyKey)),
        journal: jsonScalarText(valueFor(publication.id, configuration.journalPropertyKey)),
        bibliography: jsonScalarText(
          valueFor(publication.id, configuration.bibliographyPropertyKey)
        ),
        publicationStatus: jsonScalarText(
          valueFor(publication.id, configuration.statusPropertyKey)
        ),
        authors,
        internalAuthors,
        departments,
        classifications: rowClassifications,
        classificationCodes: rowClassifications
          .filter(
            (item) =>
              item.state === "confirmed" ||
              (criteria.includeReview && item.state === "review")
          )
          .map((item) => item.code)
      };
    });

    const department = criteria.department === null
      ? null
      : normalizeComparable(criteria.department);
    const status = criteria.status === null ? null : normalizeComparable(criteria.status);
    const filtered = allRows.filter((row) => {
      if (!criteria.includeInactive && row.entityStatus !== "active") return false;
      if (criteria.year !== null && row.year !== criteria.year) return false;
      if (criteria.dateFrom !== null) {
        if (row.publicationDate === null) return false;
        if (new Date(row.publicationDate).getTime() < new Date(criteria.dateFrom).getTime()) {
          return false;
        }
      }
      if (criteria.dateTo !== null) {
        if (row.publicationDate === null) return false;
        const upper = new Date(
          criteria.dateTo.length === 10
            ? `${criteria.dateTo}T23:59:59.999Z`
            : criteria.dateTo
        ).getTime();
        if (new Date(row.publicationDate).getTime() > upper) return false;
      }
      if (
        criteria.teacherEntityId !== null &&
        !row.internalAuthors.some(
          (author) => author.entityId === criteria.teacherEntityId
        )
      ) {
        return false;
      }
      if (
        department !== null &&
        !row.departments.some(
          (candidate) => normalizeComparable(candidate) === department
        )
      ) {
        return false;
      }
      if (
        status !== null &&
        (row.publicationStatus === null ||
          normalizeComparable(row.publicationStatus) !== status)
      ) {
        return false;
      }
      if (criteria.classifications.length > 0) {
        const codes = new Set(row.classificationCodes);
        const accepted =
          criteria.classificationMatch === "all"
            ? criteria.classifications.every((code) => codes.has(code))
            : criteria.classifications.some((code) => codes.has(code));
        if (!accepted) return false;
      }
      return true;
    });
    filtered.sort((left, right) => {
      const leftDate = left.publicationDate ?? `${left.year ?? 0}-01-01`;
      const rightDate = right.publicationDate ?? `${right.year ?? 0}-01-01`;
      return (
        rightDate.localeCompare(leftDate) ||
        left.title.localeCompare(right.title, "ru-RU") ||
        left.publicationEntityId.localeCompare(right.publicationEntityId)
      );
    });

    const byClassification = emptyClassificationTotals();
    for (const row of filtered) {
      for (const code of new Set(row.classificationCodes)) byClassification[code] += 1;
    }
    const internalAuthors = filtered.flatMap((row) => row.internalAuthors);
    const totals: PublicationReportTotals = {
      matchedRowCount: filtered.length,
      returnedRowCount: Math.min(filtered.length, criteria.limit),
      uniquePublications: filtered.length,
      authorships: filtered.reduce((sum, row) => sum + row.authors.length, 0),
      internalAuthorships: internalAuthors.length,
      uniqueInternalAuthors: new Set(internalAuthors.map((author) => author.entityId)).size,
      withoutDoi: filtered.filter((row) => row.doi === null).length,
      withoutInternalAuthors: filtered.filter((row) => row.internalAuthors.length === 0).length,
      byClassification,
      truncated: filtered.length > criteria.limit
    };
    return {
      spaceId,
      criteria,
      generatedAt: generatedAtValue ?? new Date().toISOString(),
      rows: filtered.slice(0, criteria.limit),
      totals
    };
  }

  private mapSnapshotSummary(row: SnapshotRow): PublicationReportSnapshotSummary {
    const criteriaObject = asJsonObject(parseJson(row.criteria_json), "publication criteria");
    const totalsObject = asJsonObject(parseJson(row.totals_json), "publication totals");
    return {
      id: row.id,
      spaceId: row.space_id,
      criteria: normalizeCriteria({
        year: typeof criteriaObject.year === "number" ? criteriaObject.year : null,
        dateFrom: typeof criteriaObject.dateFrom === "string" ? criteriaObject.dateFrom : null,
        dateTo: typeof criteriaObject.dateTo === "string" ? criteriaObject.dateTo : null,
        classifications: Array.isArray(criteriaObject.classifications)
          ? criteriaObject.classifications
              .filter((value): value is string => typeof value === "string")
              .map(classificationCode)
          : [],
        classificationMatch:
          criteriaObject.classificationMatch === "all" ? "all" : "any",
        includeReview: criteriaObject.includeReview === true,
        teacherEntityId:
          typeof criteriaObject.teacherEntityId === "string"
            ? criteriaObject.teacherEntityId
            : null,
        department:
          typeof criteriaObject.department === "string" ? criteriaObject.department : null,
        status: typeof criteriaObject.status === "string" ? criteriaObject.status : null,
        includeInactive: criteriaObject.includeInactive === true,
        limit: typeof criteriaObject.limit === "number" ? criteriaObject.limit : row.row_count
      }),
      totals: this.parseReportTotals(totalsObject),
      rowCount: Number(row.row_count),
      createdBy: row.created_by,
      correlationId: row.correlation_id,
      createdAt: row.created_at
    };
  }

  private parseReportTotals(value: Record<string, JsonValue>): PublicationReportTotals {
    const classificationValue = value.byClassification;
    const classificationObject =
      classificationValue !== null &&
      !Array.isArray(classificationValue) &&
      typeof classificationValue === "object"
        ? classificationValue
        : {};
    const number = (key: string): number =>
      typeof value[key] === "number" ? Number(value[key]) : 0;
    return {
      matchedRowCount: number("matchedRowCount"),
      returnedRowCount: number("returnedRowCount"),
      uniquePublications: number("uniquePublications"),
      authorships: number("authorships"),
      internalAuthorships: number("internalAuthorships"),
      uniqueInternalAuthors: number("uniqueInternalAuthors"),
      withoutDoi: number("withoutDoi"),
      withoutInternalAuthors: number("withoutInternalAuthors"),
      byClassification: {
        vak: typeof classificationObject.vak === "number" ? classificationObject.vak : 0,
        rinc: typeof classificationObject.rinc === "number" ? classificationObject.rinc : 0,
        mbd: typeof classificationObject.mbd === "number" ? classificationObject.mbd : 0,
        scopus:
          typeof classificationObject.scopus === "number" ? classificationObject.scopus : 0,
        web_of_science:
          typeof classificationObject.web_of_science === "number"
            ? classificationObject.web_of_science
            : 0,
        rinc_core:
          typeof classificationObject.rinc_core === "number"
            ? classificationObject.rinc_core
            : 0
      },
      truncated: value.truncated === true
    };
  }

  private parseReportRow(value: JsonValue, name: string): PublicationReportRow {
    const row = asJsonObject(value, name);
    const authorValues = Array.isArray(row.authors) ? row.authors : [];
    const classificationValues = Array.isArray(row.classifications)
      ? row.classifications
      : [];
    const authors: PublicationReportAuthor[] = authorValues.map((item) => {
      const author = asJsonObject(item, "publication author");
      return {
        entityId: requiredText(String(author.entityId ?? ""), "entityId", 160),
        displayName: requiredText(String(author.displayName ?? ""), "displayName", 500),
        role: authorRole(String(author.role ?? "author")),
        position: typeof author.position === "number" ? author.position : 0,
        internal: author.internal === true,
        department: typeof author.department === "string" ? author.department : null
      };
    });
    const classifications: PublicationReportClassification[] = classificationValues.map(
      (item) => {
        const classification = asJsonObject(item, "publication classification");
        const code = classificationCode(String(classification.code ?? ""));
        return {
          code,
          label:
            typeof classification.label === "string"
              ? classification.label
              : PUBLICATION_CLASSIFICATION_LABELS[code],
          state: classificationState(String(classification.state ?? "confirmed")),
          source: typeof classification.source === "string" ? classification.source : null,
          checkedAt:
            typeof classification.checkedAt === "string"
              ? classification.checkedAt
              : null,
          note: typeof classification.note === "string" ? classification.note : null
        };
      }
    );
    return {
      publicationEntityId: requiredText(
        String(row.publicationEntityId ?? ""),
        "publicationEntityId",
        160
      ),
      title: requiredText(String(row.title ?? ""), "title", 500),
      entityStatus: typeof row.entityStatus === "string" ? row.entityStatus : "active",
      year: typeof row.year === "number" ? row.year : null,
      publicationDate:
        typeof row.publicationDate === "string" ? row.publicationDate : null,
      doi: typeof row.doi === "string" ? row.doi : null,
      journal: typeof row.journal === "string" ? row.journal : null,
      bibliography:
        typeof row.bibliography === "string" ? row.bibliography : null,
      publicationStatus:
        typeof row.publicationStatus === "string" ? row.publicationStatus : null,
      authors,
      internalAuthors: authors.filter((author) => author.internal),
      departments: Array.isArray(row.departments)
        ? row.departments.filter((value): value is string => typeof value === "string")
        : [],
      classifications,
      classificationCodes: Array.isArray(row.classificationCodes)
        ? row.classificationCodes
            .filter((value): value is string => typeof value === "string")
            .map(classificationCode)
        : []
    };
  }
}
