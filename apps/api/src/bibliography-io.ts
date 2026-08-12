import { createHash } from "node:crypto";

export type BibliographyFormat = "bibtex" | "csl-json";
export type BibliographySeverity = "blocking" | "warning";

export interface BibliographyIssue {
  code:
    | "input_too_large"
    | "too_many_records"
    | "malformed_entry"
    | "missing_title"
    | "invalid_json"
    | "invalid_record"
    | "duplicate_record"
    | "unsupported_value"
    | "empty_input"
    | "catalog_too_large"
    | "ambiguous_author";
  severity: BibliographySeverity;
  entryIndex: number | null;
  entryKey: string | null;
  field: string | null;
  rawValue: string | null;
  suggestedAction:
    | "reduce_file_size"
    | "split_file"
    | "fix_source_entry"
    | "fill_title"
    | "review_duplicate"
    | "replace_unsupported_value"
    | "review_match";
}

export interface BibliographicName {
  family: string | null;
  given: string | null;
  literal: string | null;
  orcid: string | null;
}

export interface BibliographicRecord {
  sourceKey: string;
  sourceFormat: BibliographyFormat;
  type: string;
  title: string;
  authors: BibliographicName[];
  editors: BibliographicName[];
  issuedYear: number | null;
  issuedDate: string | null;
  containerTitle: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publisher: string | null;
  doi: string | null;
  isbn: string | null;
  issn: string | null;
  url: string | null;
  abstract: string | null;
  language: string | null;
  note: string | null;
  keywords: string[];
}

export interface BibliographyParseResult {
  format: BibliographyFormat;
  records: BibliographicRecord[];
  issues: BibliographyIssue[];
  digest: string;
}

export class BibliographyInputError extends Error {
  override readonly name = "BibliographyInputError";
  constructor(readonly code: BibliographyIssue["code"], message: string) {
    super(message);
  }
}

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_RECORDS = 10_000;
const MAX_FIELD_CHARACTERS = 100_000;
const MAX_NESTING = 64;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function canonicalDoi(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().replace(/^doi\s*:\s*/iu, "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "").replace(/[\s.]+$/u, "").toLocaleLowerCase("en-US");
  return normalized.length === 0 ? null : normalized;
}

export function canonicalBibliographyText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function nullable(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeWhitespace(value);
  return normalized.length === 0 ? null : normalized;
}
function yearValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= 9999) return value;
  if (typeof value !== "string") return null;
  const match = /(?:^|\D)((?:19|20|21)\d{2})(?:\D|$)/u.exec(value);
  return match?.[1] ? Number(match[1]) : null;
}
function issue(code: BibliographyIssue["code"], severity: BibliographySeverity, entryIndex: number | null, entryKey: string | null, field: string | null, rawValue: string | null, suggestedAction: BibliographyIssue["suggestedAction"]): BibliographyIssue {
  return { code, severity, entryIndex, entryKey, field, rawValue, suggestedAction };
}
function checkSource(source: string): void {
  if (Buffer.byteLength(source, "utf8") > MAX_BYTES) throw new BibliographyInputError("input_too_large", "Файл библиографии превышает 10 МБ.");
}
function splitNames(value: string): BibliographicName[] {
  return value.split(/\s+and\s+/iu).map((part) => normalizeWhitespace(part.replace(/[{}]/gu, ""))).filter(Boolean).map((part) => {
    const comma = part.indexOf(",");
    if (comma >= 0) return { family: nullable(part.slice(0, comma)), given: nullable(part.slice(comma + 1)), literal: null, orcid: null };
    const tokens = part.split(/\s+/u);
    if (tokens.length === 1) return { family: tokens[0] ?? null, given: null, literal: null, orcid: null };
    return { family: tokens.at(-1) ?? null, given: nullable(tokens.slice(0, -1).join(" ")), literal: null, orcid: null };
  });
}

function readDelimited(source: string, start: number): { body: string; end: number } | null {
  const open = source[start];
  if (open !== "{" && open !== "(") return null;
  const close = open === "{" ? "}" : ")";
  let depth = 1, braceDepth = 0, quoted = false, escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (open === "(" && char === "{") { braceDepth += 1; if (braceDepth + depth > MAX_NESTING) throw new BibliographyInputError("malformed_entry", "Слишком глубокая вложенность BibTeX."); continue; }
    if (open === "(" && char === "}" && braceDepth > 0) { braceDepth -= 1; continue; }
    if (braceDepth > 0) continue;
    if (char === open) { depth += 1; if (depth > MAX_NESTING) throw new BibliographyInputError("malformed_entry", "Слишком глубокая вложенность BibTeX."); }
    else if (char === close) { depth -= 1; if (depth === 0) return { body: source.slice(start + 1, index), end: index + 1 }; }
  }
  return null;
}

function topLevelComma(value: string): number {
  let depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === "{") depth += 1;
    else if (!quoted && char === "}") depth = Math.max(0, depth - 1);
    else if (!quoted && depth === 0 && char === ",") return index;
  }
  return -1;
}

function parseBibFields(source: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let cursor = 0;
  while (cursor < source.length) {
    while (cursor < source.length && /[\s,]/u.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) break;
    const nameMatch = /^[A-Za-z][A-Za-z0-9_:-]*/u.exec(source.slice(cursor));
    if (!nameMatch) break;
    const field = nameMatch[0].toLocaleLowerCase("en-US");
    cursor += nameMatch[0].length;
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "=") break;
    cursor += 1;
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    let value = "";
    const first = source[cursor] ?? "";
    if (first === "{") {
      const read = readDelimited(source, cursor); if (!read) break; value = read.body; cursor = read.end;
    } else if (first === '"') {
      cursor += 1; let escaped = false, depth = 0; const start = cursor;
      for (; cursor < source.length; cursor += 1) {
        const char = source[cursor] ?? "";
        if (escaped) { escaped = false; continue; }
        if (char === "\\") { escaped = true; continue; }
        if (char === "{") depth += 1; else if (char === "}") depth = Math.max(0, depth - 1); else if (char === '"' && depth === 0) break;
      }
      value = source.slice(start, cursor); if (source[cursor] === '"') cursor += 1;
    } else {
      const end = source.slice(cursor).search(/\s*,/u); const raw = end < 0 ? source.slice(cursor) : source.slice(cursor, cursor + end); value = raw; cursor = end < 0 ? source.length : cursor + end;
    }
    const normalized = normalizeWhitespace(value.replace(/[{}]/gu, ""));
    if (normalized.length > MAX_FIELD_CHARACTERS) throw new BibliographyInputError("malformed_entry", `Поле BibTeX «${field}» слишком большое.`);
    fields[field] = normalized;
  }
  return fields;
}

function bibType(type: string): string {
  const normalized = type.toLocaleLowerCase("en-US");
  if (normalized === "article") return "article-journal";
  if (["inproceedings", "conference"].includes(normalized)) return "paper-conference";
  if (["book", "inbook", "incollection"].includes(normalized)) return "book";
  if (["phdthesis", "mastersthesis"].includes(normalized)) return "thesis";
  return normalized || "article";
}

function parseBibTeX(source: string): BibliographyParseResult {
  checkSource(source);
  const records: BibliographicRecord[] = [], issues: BibliographyIssue[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const at = source.indexOf("@", cursor); if (at < 0) break;
    const typeMatch = /^@([A-Za-z]+)\s*/u.exec(source.slice(at)); if (!typeMatch?.[1]) { cursor = at + 1; continue; }
    const type = typeMatch[1]; const read = readDelimited(source, at + typeMatch[0].length);
    if (!read) { issues.push(issue("malformed_entry", "blocking", records.length, null, null, source.slice(at, Math.min(source.length, at + 160)), "fix_source_entry")); break; }
    cursor = read.end;
    if (["comment", "preamble", "string"].includes(type.toLocaleLowerCase("en-US"))) continue;
    if (records.length >= MAX_RECORDS) throw new BibliographyInputError("too_many_records", "В одном импорте допускается не более 10000 записей.");
    const comma = topLevelComma(read.body);
    if (comma < 0) { issues.push(issue("malformed_entry", "blocking", records.length, null, null, read.body.slice(0, 160), "fix_source_entry")); continue; }
    const sourceKey = normalizeWhitespace(read.body.slice(0, comma)); const fields = parseBibFields(read.body.slice(comma + 1)); const title = normalizeWhitespace(fields.title ?? ""); const index = records.length;
    if (!title) issues.push(issue("missing_title", "blocking", index, sourceKey || null, "title", null, "fill_title"));
    const date = nullable(fields.date); const year = yearValue(fields.year) ?? yearValue(date);
    records.push({
      sourceKey: sourceKey || `item-${index + 1}`, sourceFormat: "bibtex", type: bibType(type), title,
      authors: splitNames(fields.author ?? ""), editors: splitNames(fields.editor ?? ""), issuedYear: year, issuedDate: date,
      containerTitle: nullable(fields.journaltitle ?? fields.journal ?? fields.booktitle), volume: nullable(fields.volume), issue: nullable(fields.number ?? fields.issue), pages: nullable(fields.pages), publisher: nullable(fields.publisher),
      doi: canonicalDoi(nullable(fields.doi)), isbn: nullable(fields.isbn), issn: nullable(fields.issn), url: nullable(fields.url), abstract: nullable(fields.abstract), language: nullable(fields.language), note: nullable(fields.note),
      keywords: (fields.keywords ?? "").split(/[,;]/u).map(normalizeWhitespace).filter(Boolean)
    });
  }
  appendDuplicateIssues(records, issues);
  return { format: "bibtex", records, issues, digest: digest(JSON.stringify(records)) };
}

function cslName(value: unknown): BibliographicName | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>; const literal = nullable(row.literal); const family = nullable(row.family); const given = nullable(row.given);
  if (literal === null && family === null && given === null) return null;
  return { family, given, literal, orcid: nullable(row.ORCID ?? row.orcid) };
}
function cslDate(value: unknown): { issuedDate: string | null; issuedYear: number | null } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { issuedDate: null, issuedYear: null };
  const row = value as Record<string, unknown>;
  if (typeof row.literal === "string") { const issuedDate = normalizeWhitespace(row.literal); return { issuedDate: issuedDate || null, issuedYear: yearValue(issuedDate) }; }
  const parts = row["date-parts"]; if (!Array.isArray(parts) || !Array.isArray(parts[0])) return { issuedDate: null, issuedYear: null };
  const values = parts[0].filter((part): part is number => typeof part === "number" && Number.isInteger(part)); const year = values[0] ?? null;
  if (year === null) return { issuedDate: null, issuedYear: null };
  return { issuedDate: values.slice(0, 3).map((part, index) => index === 0 ? String(part).padStart(4, "0") : String(part).padStart(2, "0")).join("-"), issuedYear: year };
}

function parseCslJson(source: string): BibliographyParseResult {
  checkSource(source);
  let parsed: unknown;
  try { parsed = JSON.parse(source) as unknown; } catch { throw new BibliographyInputError("invalid_json", "CSL JSON содержит синтаксическую ошибку."); }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (list.length > MAX_RECORDS) throw new BibliographyInputError("too_many_records", "В одном импорте допускается не более 10000 записей.");
  const records: BibliographicRecord[] = [], issues: BibliographyIssue[] = [];
  list.forEach((value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) { issues.push(issue("invalid_record", "blocking", index, null, null, null, "fix_source_entry")); return; }
    const row = value as Record<string, unknown>; const title = nullable(row.title) ?? ""; const sourceKey = nullable(row.id) ?? `item-${index + 1}`;
    if (!title) issues.push(issue("missing_title", "blocking", index, sourceKey, "title", null, "fill_title"));
    const date = cslDate(row.issued); const authors = Array.isArray(row.author) ? row.author.map(cslName).filter((name): name is BibliographicName => name !== null) : []; const editors = Array.isArray(row.editor) ? row.editor.map(cslName).filter((name): name is BibliographicName => name !== null) : []; const keyword = nullable(row.keyword);
    records.push({
      sourceKey, sourceFormat: "csl-json", type: nullable(row.type) ?? "article", title, authors, editors, issuedYear: date.issuedYear, issuedDate: date.issuedDate,
      containerTitle: nullable(row["container-title"]), volume: nullable(row.volume), issue: nullable(row.issue), pages: nullable(row.page), publisher: nullable(row.publisher), doi: canonicalDoi(nullable(row.DOI ?? row.doi)),
      isbn: nullable(row.ISBN ?? row.isbn), issn: nullable(row.ISSN ?? row.issn), url: nullable(row.URL ?? row.url), abstract: nullable(row.abstract), language: nullable(row.language), note: nullable(row.note), keywords: keyword === null ? [] : keyword.split(/[,;]/u).map(normalizeWhitespace).filter(Boolean)
    });
  });
  appendDuplicateIssues(records, issues);
  return { format: "csl-json", records, issues, digest: digest(JSON.stringify(records)) };
}

function duplicateKey(record: BibliographicRecord): string | null {
  if (record.doi) return `doi:${record.doi}`;
  const title = canonicalBibliographyText(record.title); if (!title) return null;
  const first = record.authors[0]; const author = canonicalBibliographyText(first?.family ?? first?.literal ?? first?.given ?? "");
  return `title:${title}\u0000${record.issuedYear ?? ""}\u0000${author}`;
}
function appendDuplicateIssues(records: BibliographicRecord[], issues: BibliographyIssue[]): void {
  const seen = new Map<string, number>();
  records.forEach((record, index) => {
    const key = duplicateKey(record); if (key === null) return;
    const previous = seen.get(key); if (previous === undefined) { seen.set(key, index); return; }
    issues.push(issue("duplicate_record", "warning", index, record.sourceKey, record.doi ? "doi" : "title", key, "review_duplicate"));
  });
}

export function parseBibliography(format: BibliographyFormat, source: string): BibliographyParseResult {
  if (!source.trim()) throw new BibliographyInputError("empty_input", "Файл библиографии пуст.");
  if (format !== "bibtex" && format !== "csl-json") throw new BibliographyInputError("unsupported_value", "Поддерживаются только BibTeX и CSL JSON.");
  return format === "bibtex" ? parseBibTeX(source) : parseCslJson(source);
}

function exportName(name: BibliographicName): string { return name.literal ?? [name.family, name.given].filter(Boolean).join(", "); }
function escapeBib(value: string): string { return normalizeWhitespace(value).replace(/\\/gu, "\\textbackslash{}").replace(/([{}])/gu, "\\$1"); }
function bibEntryType(type: string): string { if (type === "article-journal") return "article"; if (type === "paper-conference") return "inproceedings"; return type === "article" ? "article" : "misc"; }

export function exportBibTeX(records: readonly BibliographicRecord[]): string {
  const used = new Set<string>();
  return records.map((record, index) => {
    let key = normalizeWhitespace(record.sourceKey).replace(/[^\p{L}\p{N}_:.-]+/gu, "-").slice(0, 80) || `item-${index + 1}`; let suffix = 2; const base = key; while (used.has(key)) key = `${base}-${suffix++}`; used.add(key);
    const fields: Array<[string, string | null]> = [
      ["title", record.title], ["author", record.authors.length ? record.authors.map(exportName).join(" and ") : null], ["editor", record.editors.length ? record.editors.map(exportName).join(" and ") : null],
      ["date", record.issuedDate], ["year", record.issuedDate === null && record.issuedYear !== null ? String(record.issuedYear) : null], ["journal", record.containerTitle], ["volume", record.volume], ["number", record.issue], ["pages", record.pages], ["publisher", record.publisher],
      ["doi", record.doi], ["isbn", record.isbn], ["issn", record.issn], ["url", record.url], ["abstract", record.abstract], ["language", record.language], ["note", record.note], ["keywords", record.keywords.length ? record.keywords.join(", ") : null]
    ];
    const body = fields.filter((entry): entry is [string, string] => Boolean(entry[1])).map(([field, value]) => `  ${field} = {${escapeBib(value)}}`).join(",\n");
    return `@${bibEntryType(record.type)}{${key},\n${body}\n}`;
  }).join("\n\n") + (records.length ? "\n" : "");
}

function cslNameOutput(name: BibliographicName): Record<string, string> {
  if (name.literal) return { literal: name.literal };
  const row: Record<string, string> = {}; if (name.family) row.family = name.family; if (name.given) row.given = name.given; if (name.orcid) row.ORCID = name.orcid; return row;
}
export function exportCslJson(records: readonly BibliographicRecord[]): string {
  const values = records.map((record) => {
    const row: Record<string, unknown> = { id: record.sourceKey, type: record.type || "article", title: record.title };
    if (record.authors.length) row.author = record.authors.map(cslNameOutput); if (record.editors.length) row.editor = record.editors.map(cslNameOutput);
    if (record.issuedDate && /^\d{4}(?:-\d{2})?(?:-\d{2})?$/u.test(record.issuedDate)) row.issued = { "date-parts": [record.issuedDate.split("-").map(Number)] }; else if (record.issuedYear !== null) row.issued = { "date-parts": [[record.issuedYear]] };
    const fields: Array<[string, string | null]> = [["container-title", record.containerTitle], ["volume", record.volume], ["issue", record.issue], ["page", record.pages], ["publisher", record.publisher], ["DOI", record.doi], ["ISBN", record.isbn], ["ISSN", record.issn], ["URL", record.url], ["abstract", record.abstract], ["language", record.language], ["note", record.note]];
    fields.forEach(([field, value]) => { if (value !== null) row[field] = value; }); if (record.keywords.length) row.keyword = record.keywords.join(", "); return row;
  });
  return `${JSON.stringify(values, null, 2)}\n`;
}
