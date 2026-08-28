import type {
  DocumentStructureReport,
  DocxParagraphElement,
  XlsxCellElement
} from "@docomator/document-intake";

import type { ExtractionOutputType } from "./data-extraction-service.js";

export interface ExtractionProposalField {
  label: string;
  elementId: string;
  outputType: ExtractionOutputType;
  confidence: number;
  reason: "key_value";
}

export interface ExtractionProposalRepeatColumn {
  label: string;
  elementId: string;
  outputType: ExtractionOutputType;
  confidence: number;
}

export interface ExtractionProposalRepeat {
  label: string;
  columns: ExtractionProposalRepeatColumn[];
  confidence: number;
  reason: "tabular_header";
}

export interface DataExtractionProposal {
  version: 1;
  format: "docx" | "xlsx";
  fields: ExtractionProposalField[];
  repeat: ExtractionProposalRepeat | null;
  confidence: number;
  warnings: string[];
}

interface CandidateCell {
  elementId: string;
  text: string;
  column: number;
  formula: boolean;
}

interface CandidateRow {
  row: number;
  cells: Map<number, CandidateCell>;
}

interface CandidateGroup {
  key: string;
  label: string;
  rows: CandidateRow[];
}

interface RepeatCandidate {
  groupKey: string;
  headerRow: CandidateRow;
  sampleRow: CandidateRow;
  columns: number[];
  dataRows: CandidateRow[];
  score: number;
}

const HEADER_WORDS = new Set([
  "№", "номер", "код", "фио", "ф.и.о.", "фамилия", "имя", "отчество",
  "наименование", "название", "дата", "срок", "группа", "должность",
  "подразделение", "значение", "описание", "отчетность", "отчётность",
  "количество", "сумма", "адрес", "телефон", "email", "e-mail"
]);

function cleanText(value: string): string {
  return String(value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
}

function identity(value: string): string {
  return cleanText(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/[.:;!?]+$/gu, "")
    .trim();
}

function meaningfulLabel(value: string): boolean {
  const text = cleanText(value);
  return text.length > 0 && text.length <= 120 && /[\p{L}№]/u.test(text) && text.split(/\s+/u).length <= 12;
}

function knownHeader(value: string): boolean {
  const valueIdentity = identity(value);
  if (HEADER_WORDS.has(valueIdentity)) return true;
  return [...HEADER_WORDS].some(
    (word) => valueIdentity.startsWith(`${word} `) || valueIdentity.endsWith(` ${word}`)
  );
}

function safeLabel(value: string, fallback: string): string {
  const text = cleanText(value).replace(/[:;]+$/gu, "").trim();
  return text.length > 0 && text.length <= 120 ? text : fallback;
}

function xlsxCoordinate(address: string): { row: number; column: number } | null {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(String(address || "").toUpperCase());
  if (match === null) return null;
  let column = 0;
  for (const character of match[1] ?? "") column = column * 26 + character.charCodeAt(0) - 64;
  return { row: Number(match[2]), column };
}

function docxGroups(structure: DocumentStructureReport): CandidateGroup[] {
  const tables = new Map<string, Map<number, Map<number, DocxParagraphElement[]>>>();
  for (const element of structure.elements) {
    if (element.kind !== "paragraph" || element.tableLocation === null) continue;
    const location = element.tableLocation;
    const key = `${element.part}\u0000${location.tableIndex}`;
    const rows = tables.get(key) ?? new Map<number, Map<number, DocxParagraphElement[]>>();
    const columns = rows.get(location.rowIndex) ?? new Map<number, DocxParagraphElement[]>();
    const paragraphs = columns.get(location.columnIndex) ?? [];
    paragraphs.push(element);
    columns.set(location.columnIndex, paragraphs);
    rows.set(location.rowIndex, columns);
    tables.set(key, rows);
  }
  return [...tables.entries()].map(([key, rows]) => {
    const [part = "word/document.xml", tableValue = "0"] = key.split("\u0000");
    return {
      key,
      label: `${part}, таблица ${Number(tableValue) + 1}`,
      rows: [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([row, columns]) => ({
        row,
        cells: new Map([...columns.entries()].map(([column, paragraphs]) => {
          const ordered = [...paragraphs].sort((a, b) => a.index - b.index);
          return [column, {
            elementId: ordered[0]!.id,
            text: cleanText(ordered.map((paragraph) => paragraph.text).join(" ")),
            column,
            formula: false
          } satisfies CandidateCell];
        }))
      }))
    } satisfies CandidateGroup;
  });
}

function xlsxGroups(structure: DocumentStructureReport): CandidateGroup[] {
  const sheets = new Map<string, { name: string; rows: Map<number, Map<number, XlsxCellElement>> }>();
  for (const element of structure.elements) {
    if (element.kind !== "cell") continue;
    const coordinate = xlsxCoordinate(element.address);
    if (coordinate === null) continue;
    const key = `${element.sheetPath}\u0000${element.sheetName}`;
    const sheet = sheets.get(key) ?? { name: element.sheetName, rows: new Map() };
    const row = sheet.rows.get(coordinate.row) ?? new Map<number, XlsxCellElement>();
    row.set(coordinate.column, element);
    sheet.rows.set(coordinate.row, row);
    sheets.set(key, sheet);
  }
  return [...sheets.entries()].map(([key, sheet]) => ({
    key,
    label: `Лист «${sheet.name}»`,
    rows: [...sheet.rows.entries()].sort((a, b) => a[0] - b[0]).map(([row, columns]) => ({
      row,
      cells: new Map([...columns.entries()].map(([column, cell]) => [column, {
        elementId: cell.id,
        text: cleanText(cell.value),
        column,
        formula: cell.formula !== null || cell.valueKind === "formula"
      } satisfies CandidateCell]))
    }))
  }));
}

function nonBlank(row: CandidateRow): CandidateCell[] {
  return [...row.cells.values()].filter((cell) => cell.text.length > 0 && !cell.formula);
}

function valueCount(row: CandidateRow, columns: readonly number[]): number {
  return columns.filter((column) => {
    const cell = row.cells.get(column);
    return cell !== undefined && cell.text.length > 0 && !cell.formula;
  }).length;
}

function looksLikeKeyValue(group: CandidateGroup): boolean {
  if (group.rows.length < 2 || group.rows.length > 40) return false;
  const rows = group.rows
    .map((row) => nonBlank(row).sort((a, b) => a.column - b.column))
    .filter((cells) => cells.length === 2);
  if (rows.length < 2 || rows.length / group.rows.length < 0.7) return false;
  const firstColumns = [rows[0]![0]!.column, rows[0]![1]!.column];
  if (!rows.every((cells) => cells[0]!.column === firstColumns[0] && cells[1]!.column === firstColumns[1])) return false;
  const labelRate = rows.filter((cells) => meaningfulLabel(cells[0]!.text)).length / rows.length;
  const firstRowLooksLikeHeader = rows[0]!.every((cell) => knownHeader(cell.text));
  return labelRate >= 0.8 && !firstRowLooksLikeHeader;
}

function findRepeat(group: CandidateGroup): RepeatCandidate | null {
  if (group.rows.length < 2 || looksLikeKeyValue(group)) return null;
  let best: RepeatCandidate | null = null;
  for (const headerRow of group.rows.slice(0, Math.min(group.rows.length - 1, 8))) {
    const headers = nonBlank(headerRow)
      .filter((cell) => meaningfulLabel(cell.text))
      .sort((a, b) => a.column - b.column);
    if (headers.length < 2) continue;
    const columns = headers.map((cell) => cell.column);
    const following = group.rows.filter((row) => row.row > headerRow.row).slice(0, 50);
    const dataRows = following.filter(
      (row) => valueCount(row, columns) >= Math.max(1, Math.ceil(columns.length / 2))
    );
    if (dataRows.length === 0) continue;
    const sampleRow = dataRows[0]!;
    const available = columns.filter((column) => {
      const cell = sampleRow.cells.get(column);
      return cell !== undefined && cell.text.length > 0 && !cell.formula;
    });
    if (available.length < 2) continue;
    const headerSignal = headers.filter((cell) => knownHeader(cell.text)).length;
    const score = available.length * 4 + Math.min(dataRows.length, 10) * 2 + headerSignal * 3 - headerRow.row * 0.01;
    const candidate: RepeatCandidate = {
      groupKey: group.key,
      headerRow,
      sampleRow,
      columns: available,
      dataRows,
      score
    };
    if (best === null || candidate.score > best.score) best = candidate;
  }
  return best;
}

function inferType(values: readonly string[]): ExtractionOutputType {
  const source = values.map(cleanText).filter(Boolean).slice(0, 20);
  if (source.length === 0) return "text";
  if (source.every((value) => /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})$/u.test(value))) return "date";
  if (source.every((value) => /^[-+]?\d+$/u.test(value.replace(/[\s\u00a0]/gu, "")))) return "integer";
  if (source.every((value) => /^[-+]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u.test(value.replace(/[\s\u00a0]/gu, "")))) return "number";
  return "text";
}

function uniqueLabel(value: string, fallback: string, used: Set<string>): string {
  const base = safeLabel(value, fallback);
  let result = base;
  let suffix = 2;
  while (used.has(identity(result))) {
    result = `${base} ${suffix}`;
    suffix += 1;
  }
  used.add(identity(result));
  return result;
}

function scalarFields(
  groups: readonly CandidateGroup[],
  excludedKey: string | null,
  used: Set<string>
): ExtractionProposalField[] {
  const result: ExtractionProposalField[] = [];
  for (const group of groups) {
    if (group.key === excludedKey || !looksLikeKeyValue(group)) continue;
    for (const row of group.rows) {
      const cells = nonBlank(row).sort((a, b) => a.column - b.column);
      if (cells.length !== 2 || !meaningfulLabel(cells[0]!.text)) continue;
      result.push({
        label: uniqueLabel(cells[0]!.text, `Поле ${result.length + 1}`, used),
        elementId: cells[1]!.elementId,
        outputType: inferType([cells[1]!.text]),
        confidence: 0.86,
        reason: "key_value"
      });
      if (result.length >= 30) return result;
    }
  }
  return result;
}

export function proposeDataExtraction(structure: DocumentStructureReport): DataExtractionProposal {
  if (structure.truncated) {
    return {
      version: 1,
      format: structure.format,
      fields: [],
      repeat: null,
      confidence: 0,
      warnings: ["Структура документа показана не полностью. Автоматическое предложение отключено, чтобы не закрепить неполную схему."]
    };
  }

  const warnings: string[] = [];
  const groups = structure.format === "docx" ? docxGroups(structure) : xlsxGroups(structure);
  const repeats = groups
    .map(findRepeat)
    .filter((candidate): candidate is RepeatCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score);
  const selected = repeats[0] ?? null;
  const used = new Set<string>();
  const fields = scalarFields(groups, selected?.groupKey ?? null, used);

  let repeat: ExtractionProposalRepeat | null = null;
  if (selected !== null) {
    const group = groups.find((candidate) => candidate.key === selected.groupKey)!;
    const columnConfidence = selected.dataRows.length >= 3 ? 0.92 : 0.82;
    repeat = {
      label: group.label,
      confidence: columnConfidence,
      reason: "tabular_header",
      columns: selected.columns.map((column, index) => {
        const header = selected.headerRow.cells.get(column);
        const sample = selected.sampleRow.cells.get(column)!;
        return {
          label: uniqueLabel(header?.text ?? "", `Колонка ${index + 1}`, used),
          elementId: sample.elementId,
          outputType: inferType(selected.dataRows.map((row) => row.cells.get(column)?.text ?? "")),
          confidence: columnConfidence
        };
      })
    };
    if (repeats.length > 1 && Math.abs(repeats[0]!.score - repeats[1]!.score) < 4) {
      warnings.push("В документе найдено несколько похожих таблиц. Автоматически выбрана наиболее выраженная; проверьте предложенные колонки.");
    }
  }

  if (fields.length === 0 && repeat === null) {
    warnings.push("Надёжную повторяемую таблицу или блок «поле — значение» определить не удалось. Отметьте нужные места вручную.");
  }

  const confidenceValues = [...fields.map((field) => field.confidence), ...(repeat === null ? [] : [repeat.confidence])];
  const confidence = confidenceValues.length === 0
    ? 0
    : confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length;
  return {
    version: 1,
    format: structure.format,
    fields,
    repeat,
    confidence: Number(confidence.toFixed(2)),
    warnings
  };
}
