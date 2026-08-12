import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  KnowledgeNotFoundError,
  SpaceScopedKnowledgeRegistry,
  SpaceScopedPublicationRegistry,
  stringifyJson,
  toJsonValue,
  type JsonValue,
  type MutationContext,
  type SqliteStore
} from "@docomator/storage";

import {
  BibliographyInputError,
  canonicalBibliographyText,
  canonicalDoi,
  exportBibTeX,
  exportCslJson,
  parseBibliography,
  type BibliographicName,
  type BibliographicRecord,
  type BibliographyFormat,
  type BibliographyIssue
} from "./bibliography-io.js";
import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface SpaceParams { spaceId: string }
interface FormatQuery { format: BibliographyFormat }

const identifierSchema = { type: "string", minLength: 1, maxLength: 160 } as const;
const formatSchema = { type: "string", enum: ["bibtex", "csl-json"] } as const;
const bodyLimit = 10 * 1024 * 1024;
const binaryTypes = ["application/octet-stream", "text/plain", "application/x-bibtex"];
const EXTERNAL_AUTHOR_TYPE = "bibliographic-person";

function envelope<T>(request: FastifyRequest, data: T) { return { data, correlationId: correlationId(request) }; }
function errorReply(request: FastifyRequest, reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).header("cache-control", "no-store").send({ error: { code, message }, correlationId: correlationId(request) });
}
function sourceText(body: Buffer): string {
  const source = body.toString("utf8").replace(/^\uFEFF/u, "");
  if (source.trim().length === 0) throw new BibliographyInputError("empty_input", "Файл библиографии пуст.");
  return source;
}
function displayName(name: BibliographicName): string { return name.literal ?? [name.family, name.given].filter(Boolean).join(" ").trim(); }

function publicationRecord(row: ReturnType<SpaceScopedPublicationRegistry["buildReport"]>["rows"][number]): BibliographicRecord {
  return {
    sourceKey: row.publicationEntityId, sourceFormat: "csl-json", type: "article-journal", title: row.title,
    authors: row.authors.map((author) => ({ family: null, given: null, literal: author.displayName, orcid: null })), editors: [],
    issuedYear: row.year, issuedDate: row.publicationDate, containerTitle: row.journal, volume: null, issue: null, pages: null,
    publisher: null, doi: canonicalDoi(row.doi), url: null, isbn: null, issn: null, abstract: null, language: null,
    note: row.bibliography, keywords: []
  };
}
function duplicateKey(record: BibliographicRecord): string | null {
  const doi = canonicalDoi(record.doi); if (doi) return `doi:${doi}`;
  const title = canonicalBibliographyText(record.title); if (!title) return null;
  const first = record.authors[0] ? canonicalBibliographyText(displayName(record.authors[0])) : "";
  return `fallback:${title}|${record.issuedYear ?? ""}|${first}`;
}
function bibliographyText(record: BibliographicRecord): string {
  const authors = record.authors.map(displayName).filter(Boolean).join(", ");
  const issue = [record.volume ? `т. ${record.volume}` : null, record.issue ? `№ ${record.issue}` : null, record.pages ? `с. ${record.pages}` : null].filter(Boolean).join(", ");
  const identifiers = [record.doi ? `DOI: ${record.doi}` : null, record.issn ? `ISSN: ${record.issn}` : null, record.isbn ? `ISBN: ${record.isbn}` : null].filter(Boolean).join(", ");
  return [authors, record.title, record.containerTitle, issue || null, record.publisher, record.issuedYear ? String(record.issuedYear) : null, identifiers || null, record.url].filter(Boolean).join(". ");
}
function sourceDuplicateDecisions(records: readonly BibliographicRecord[]) {
  const seen = new Map<string, number>();
  return records.map((record, index) => {
    const key = duplicateKey(record), count = key ? (seen.get(key) ?? 0) : 0; if (key) seen.set(key, count + 1);
    return { index, sourceKey: record.sourceKey, key, sourceDuplicate: count > 0 };
  });
}
function previewDuplicates(registry: SpaceScopedPublicationRegistry, spaceId: string, records: readonly BibliographicRecord[]) {
  const source = sourceDuplicateDecisions(records);
  if (registry.getConfiguration(spaceId) === null) return source.map((item) => ({ ...item, existingPublicationIds: [] as string[], decision: item.sourceDuplicate ? "skip_source_duplicate" : "create" }));
  const report = registry.buildReport(spaceId, { limit: 1_000, includeInactive: true });
  if (report.totals.truncated) throw new BibliographyInputError("catalog_too_large", "В пространстве больше 1000 публикаций. Автоматическое сравнение дублей остановлено, чтобы не создать повторные записи.");
  const existing = new Map<string, string[]>();
  for (const row of report.rows) {
    const key = duplicateKey(publicationRecord(row)); if (!key) continue;
    const ids = existing.get(key) ?? []; ids.push(row.publicationEntityId); existing.set(key, ids);
  }
  return source.map((item) => {
    const existingIds = item.key ? existing.get(item.key) ?? [] : [];
    return { ...item, existingPublicationIds: existingIds, decision: item.sourceDuplicate ? "skip_source_duplicate" : existingIds.length === 1 ? "skip_existing" : existingIds.length > 1 ? "review" : "create" };
  });
}
function importIssue(recordIndex: number, sourceKey: string, field: string, value: string): BibliographyIssue {
  return { code: "ambiguous_author", severity: "warning", entryIndex: recordIndex, entryKey: sourceKey, field, rawValue: value, suggestedAction: "review_match" };
}
function ensureExternalAuthorType(knowledge: SpaceScopedKnowledgeRegistry, context: MutationContext): void {
  try { knowledge.getEntityType(EXTERNAL_AUTHOR_TYPE); }
  catch (error) {
    if (!(error instanceof KnowledgeNotFoundError)) throw error;
    knowledge.createEntityType({ key: EXTERNAL_AUTHOR_TYPE, label: "Внешний автор", description: "Автор библиографической записи, который не подтверждён как сотрудник текущего пространства." }, context);
  }
}
function saveImportedSource(store: SqliteStore, spaceId: string, publicationEntityId: string, format: BibliographyFormat, digest: string, record: BibliographicRecord, context: MutationContext): void {
  const actorId = context.actorId ?? null; const now = context.now instanceof Date ? context.now.toISOString() : context.now ?? new Date().toISOString();
  store.execute((connection) => connection.prepare(`
    INSERT INTO publication_bibliography_sources(publication_entity_id, space_id, source_format, source_key, source_digest, record_json, imported_by, correlation_id, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(publication_entity_id) DO UPDATE SET source_format=excluded.source_format, source_key=excluded.source_key, source_digest=excluded.source_digest, record_json=excluded.record_json, imported_by=excluded.imported_by, correlation_id=excluded.correlation_id, imported_at=excluded.imported_at
    WHERE publication_bibliography_sources.space_id=excluded.space_id
  `).run(publicationEntityId, spaceId, format, record.sourceKey, digest, stringifyJson(toJsonValue(record)), actorId, context.correlationId, now));
}
function storedSources(store: SqliteStore, spaceId: string, publicationIds: readonly string[]): Map<string, BibliographicRecord> {
  if (publicationIds.length === 0) return new Map();
  return store.execute((connection) => {
    const result = new Map<string, BibliographicRecord>();
    for (let offset = 0; offset < publicationIds.length; offset += 200) {
      const chunk = publicationIds.slice(offset, offset + 200), placeholders = chunk.map(() => "?").join(", ");
      const rows = connection.prepare(`SELECT publication_entity_id, record_json FROM publication_bibliography_sources WHERE space_id = ? AND publication_entity_id IN (${placeholders})`).all(spaceId, ...chunk) as unknown as Array<{ publication_entity_id: string; record_json: string }>;
      for (const row of rows) try {
        const value = JSON.parse(row.record_json) as Partial<BibliographicRecord>;
        if (typeof value.title === "string" && Array.isArray(value.authors)) result.set(row.publication_entity_id, value as BibliographicRecord);
      } catch { /* Вспомогательная запись не должна блокировать экспорт основных полей. */ }
    }
    return result;
  });
}
function mergeStoredRecord(stored: BibliographicRecord | undefined, current: BibliographicRecord): BibliographicRecord {
  if (!stored) return current;
  return { ...stored, sourceKey: current.sourceKey, title: current.title, authors: current.authors, issuedYear: current.issuedYear, issuedDate: current.issuedDate, containerTitle: current.containerTitle, doi: current.doi, note: current.note };
}

export function registerBibliographyRoutes(app: FastifyInstance, store: SqliteStore, publications: SpaceScopedPublicationRegistry): void {
  for (const type of binaryTypes) if (!app.hasContentTypeParser(type)) app.addContentTypeParser(type, { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  const routeSchema = {
    params: { type: "object", additionalProperties: false, required: ["spaceId"], properties: { spaceId: identifierSchema } },
    querystring: { type: "object", additionalProperties: false, required: ["format"], properties: { format: formatSchema } }
  } as const;

  app.post<{ Params: SpaceParams; Querystring: FormatQuery; Body: Buffer }>("/api/v1/spaces/:spaceId/publications/bibliography/preview", { bodyLimit, schema: routeSchema }, async (request, reply) => {
    try {
      const parsed = parseBibliography(request.query.format, sourceText(request.body));
      const duplicates = previewDuplicates(publications, request.params.spaceId, parsed.records);
      reply.header("cache-control", "no-store"); return envelope(request, { ...parsed, duplicates });
    } catch (error) { if (error instanceof BibliographyInputError) return errorReply(request, reply, 400, error.code, error.message); throw error; }
  });

  app.post<{ Params: SpaceParams; Querystring: FormatQuery; Body: Buffer }>("/api/v1/spaces/:spaceId/publications/bibliography/import", { bodyLimit, schema: routeSchema }, async (request, reply) => {
    let parsed;
    try { parsed = parseBibliography(request.query.format, sourceText(request.body)); }
    catch (error) { if (error instanceof BibliographyInputError) return errorReply(request, reply, 400, error.code, error.message); throw error; }
    if (parsed.issues.some((item) => item.severity === "blocking")) return reply.code(422).header("cache-control", "no-store").send({ error: { code: "bibliography_preview_has_blockers", message: "Импорт не выполнен: исправьте блокирующие ошибки, показанные в предпросмотре." }, data: parsed, correlationId: correlationId(request) });
    const context = mutationContextFromRequest(request);
    const config = publications.ensureDefaultConfiguration(request.params.spaceId, context);
    const knowledge = new SpaceScopedKnowledgeRegistry(store, request.params.spaceId);
    ensureExternalAuthorType(knowledge, context);
    let duplicates;
    try { duplicates = previewDuplicates(publications, request.params.spaceId, parsed.records); }
    catch (error) { if (error instanceof BibliographyInputError) return errorReply(request, reply, 409, error.code, error.message); throw error; }
    const internalPeople = knowledge.listEntities({ entityTypeKey: config.teacherEntityTypeKey, status: "active", limit: 500 });
    const externalPeople = knowledge.listEntities({ entityTypeKey: EXTERNAL_AUTHOR_TYPE, status: "active", limit: 500 });
    const byName = (items: typeof internalPeople) => {
      const result = new Map<string, typeof items>();
      for (const person of items) { const key = canonicalBibliographyText(person.displayName); result.set(key, [...(result.get(key) ?? []), person]); }
      return result;
    };
    const internalByName = byName(internalPeople), externalByName = byName(externalPeople), issues = [...parsed.issues];
    let created = 0, skippedExisting = 0, skippedSourceDuplicates = 0, reviewRequired = 0;
    for (let index = 0; index < parsed.records.length; index += 1) {
      const record = parsed.records[index]!, decision = duplicates[index]?.decision;
      if (decision === "skip_source_duplicate") { skippedSourceDuplicates += 1; continue; }
      if (decision === "skip_existing") { skippedExisting += 1; continue; }
      if (decision === "review") { reviewRequired += 1; continue; }
      const entity = knowledge.createEntity({ entityTypeKey: config.publicationEntityTypeKey, displayName: record.title, status: "active" }, context);
      const append = (propertyKey: string | null, value: JsonValue) => { if (propertyKey) knowledge.appendPropertyValue({ entityId: entity.id, propertyKey, value, sourceType: "bibliography-import", sourceId: `${parsed.digest}:${record.sourceKey}` }, context); };
      if (record.issuedYear !== null) append(config.publicationYearPropertyKey, record.issuedYear);
      if (record.issuedDate && /^\d{4}-\d{2}-\d{2}$/u.test(record.issuedDate)) append(config.publicationDatePropertyKey, record.issuedDate);
      if (record.doi) append(config.doiPropertyKey, record.doi);
      if (record.containerTitle) append(config.journalPropertyKey, record.containerTitle);
      append(config.bibliographyPropertyKey, bibliographyText(record));
      append(config.statusPropertyKey, record.issuedYear !== null || record.issuedDate !== null ? "Опубликована" : "Подготовка");
      saveImportedSource(store, config.spaceId, entity.id, request.query.format, parsed.digest, record, context);
      const links: Array<{ authorEntityId: string; role: "author"; position: number }> = [];
      for (let position = 0; position < record.authors.length; position += 1) {
        const author = record.authors[position]!, name = displayName(author); if (!name) continue; const key = canonicalBibliographyText(name);
        const internalMatches = internalByName.get(key) ?? [];
        if (internalMatches.length > 1) { issues.push(importIssue(index, record.sourceKey, "author", name)); continue; }
        if (internalMatches.length === 1) { links.push({ authorEntityId: internalMatches[0]!.id, role: "author", position }); continue; }
        let externalMatches = externalByName.get(key) ?? [];
        if (externalMatches.length > 1) { issues.push(importIssue(index, record.sourceKey, "author", name)); continue; }
        if (externalMatches.length === 0) {
          const createdPerson = knowledge.createEntity({ entityTypeKey: EXTERNAL_AUTHOR_TYPE, displayName: name, status: "active" }, context); externalMatches = [createdPerson]; externalByName.set(key, externalMatches);
        }
        links.push({ authorEntityId: externalMatches[0]!.id, role: "author", position });
      }
      publications.replaceAuthors(request.params.spaceId, entity.id, links, context); created += 1;
    }
    reply.code(created > 0 ? 201 : 200).header("cache-control", "no-store");
    return envelope(request, { digest: parsed.digest, created, skippedExisting, skippedSourceDuplicates, reviewRequired, issues });
  });

  app.get<{ Params: SpaceParams; Querystring: FormatQuery }>("/api/v1/spaces/:spaceId/publications/bibliography/export", { schema: routeSchema }, async (request, reply) => {
    const configuration = publications.getConfiguration(request.params.spaceId);
    if (configuration === null) return errorReply(request, reply, 409, "publication_registry_not_configured", "В выбранном пространстве реестр публикаций ещё не настроен.");
    const report = publications.buildReport(request.params.spaceId, { limit: 1_000, includeInactive: true });
    if (report.totals.truncated) return errorReply(request, reply, 422, "bibliography_export_too_large", "В пространстве больше 1000 публикаций. Уточните выборку перед экспортом.");
    const preserved = storedSources(store, configuration.spaceId, report.rows.map((row) => row.publicationEntityId));
    const records = report.rows.map((row) => mergeStoredRecord(preserved.get(row.publicationEntityId), publicationRecord(row)));
    const bibtex = request.query.format === "bibtex"; const content = bibtex ? exportBibTeX(records) : exportCslJson(records); const fileName = bibtex ? "publications.bib" : "publications.csl.json";
    return reply.type(bibtex ? "application/x-bibtex; charset=utf-8" : "application/json; charset=utf-8").header("cache-control", "no-store").header("content-disposition", `attachment; filename="${fileName}"`).send(content);
  });
}
